// dsp.js — the actual signal processing. No framework, no dependencies.
//
// Everything here operates on a Ring: a fixed-length circular buffer of samples
// taken at a known rate. Control signals in this project arrive at 30 Hz and are
// read at 60 Hz, so every analysis op states the rate it assumes rather than
// guessing from timestamps.
//
// Correctness notes that matter:
//   - autocorrelation is normalised and mean-removed, otherwise a DC offset
//     swamps the peak and every signal looks perfectly periodic at lag 0
//   - the FFT is radix-2 and requires a power-of-two window
//   - cross-correlation returns the lag of its peak, which is the only part
//     anyone actually wants: which of two subsystems moves first

export class Ring {
  constructor(n) { this.n = n; this.b = new Float32Array(n); this.i = 0; this.filled = 0; }
  push(v) {
    this.b[this.i] = Number.isFinite(v) ? v : 0;
    this.i = (this.i + 1) % this.n;
    if (this.filled < this.n) this.filled++;
  }
  // oldest-first copy, so index 0 is the furthest back in time
  toArray(out) {
    const a = out && out.length === this.n ? out : new Float32Array(this.n);
    for (let k = 0; k < this.n; k++) a[k] = this.b[(this.i + k) % this.n];
    return a;
  }
  last() { return this.b[(this.i - 1 + this.n) % this.n]; }
}

export function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

export function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  return w;
}

// ---------------------------------------------------------------- FFT
// In-place iterative radix-2 Cooley-Tukey. re/im are Float32Array of length N,
// N a power of two. Inverse transform via conjugation, scaled by 1/N.

export function fft(re, im, inverse = false) {
  const n = re.length;
  if (n & (n - 1)) throw new Error('fft: length must be a power of two, got ' + n);
  for (let i = 1, j = 0; i < n; i++) {                 // bit-reversal permutation
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k],          ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;           im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;  ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

// ---------------------------------------------------------------- spectrum
// Returns centroid (Hz), spectral flatness (0..1), peak frequency and the
// energy inside [bandLo, bandHi]. Hann-windowed, mean-removed.

export function spectrum(sig, rate, bandLo = 0, bandHi = Infinity) {
  const n = sig.length, w = hann(n);
  const re = new Float32Array(n), im = new Float32Array(n);
  const mu = mean(sig);
  for (let i = 0; i < n; i++) re[i] = (sig[i] - mu) * w[i];
  fft(re, im);
  const half = n >> 1;
  let num = 0, den = 0, logSum = 0, lin = 0, band = 0, peakM = 0, peakF = 0, nz = 0;
  for (let k = 1; k < half; k++) {
    const m = Math.hypot(re[k], im[k]);
    const f = k * rate / n;
    num += f * m; den += m;
    if (m > 0) { logSum += Math.log(m); nz++; }
    lin += m;
    if (f >= bandLo && f <= bandHi) band += m;
    if (m > peakM) { peakM = m; peakF = f; }
  }
  const flat = nz > 0 && lin > 0 ? Math.exp(logSum / nz) / (lin / (half - 1)) : 0;
  return {
    centroid: den > 0 ? num / den : 0,
    flatness: Math.min(1, flat),
    peakFreq: peakF,
    peakMag: peakM,
    band: band,
    bandNorm: lin > 0 ? band / lin : 0,
  };
}

// ---------------------------------------------------------------- STFT -> iSTFT
// Genuine analysis/resynthesis: window, FFT, zero the bins outside the band,
// inverse FFT, overlap-add with a Hann window at 4x overlap (COLA-satisfying).
// Used for the slow "breathing" envelope: keep 0.1-0.3 Hz and nothing else.

export class BandResynth {
  // Window length sets the lowest frequency you can resolve at all. A 0.1-0.3 Hz
  // band needs a window of ~20 s; at 60 Hz that is a 2048-point FFT, so for slow
  // bands feed this a decimated stream (set `rate` to match) instead.
  constructor(n = 1024, rate = 60) {
    this.n = n; this.rate = rate; this.hop = n >> 2;
    this.inBuf = new Float32Array(n); this.inPos = 0;
    this.outAcc = new Float32Array(n);
    this.w = hann(n);
    this.re = new Float32Array(n); this.im = new Float32Array(n);
    this.emit = 0; this.ready = false;
  }
  // `mask`, when given, is a per-bin gain for bins 0..n/2 and replaces the
  // lo/hi band limits entirely. That is how a hand-painted spectral filter
  // gets applied: the drawing IS the frequency response.
  process(x, lo, hi, mask) {
    this.inBuf[this.inPos++] = x;

    // One transform per hop, and only once the window is genuinely full.
    if (this.inPos >= this.n) {
      // retire the hop we just finished emitting
      this.outAcc.copyWithin(0, this.hop);
      this.outAcc.fill(0, this.n - this.hop);
      this.emit = 0;

      const { n, re, im, w, rate } = this;
      const mu = mean(this.inBuf);
      for (let i = 0; i < n; i++) { re[i] = (this.inBuf[i] - mu) * w[i]; im[i] = 0; }
      fft(re, im);
      const half = n >> 1;
      for (let k = 0; k <= half; k++) {
        const f = k * rate / n;
        // No mask: a brick wall at lo/hi, exactly as before. With a mask: that
        // bin's drawn gain. g === 0 reproduces the old hard zeroing precisely.
        const g = mask ? (k < mask.length ? mask[k] : 0)
                       : ((f < lo || f > hi) ? 0 : 1);
        if (g !== 1) {
          re[k] *= g; im[k] *= g;
          if (k > 0 && k < half) { re[n - k] *= g; im[n - k] *= g; }  // keep it Hermitian
        }
      }
      fft(re, im, true);
      // Hann analysis + Hann synthesis at 75% overlap sums to 1.5, so scale by 2/3.
      for (let i = 0; i < n; i++) this.outAcc[i] += re[i] * w[i] * (2 / 3);

      this.inBuf.copyWithin(0, this.hop);
      this.inPos = this.n - this.hop;
      this.ready = true;
    }

    if (!this.ready) return 0;
    return this.outAcc[Math.min(this.emit++, this.n - 1)];
  }
}

// ---------------------------------------------------------------- autocorrelation
// Normalised, mean-removed. Searches lags between minLag and maxLag samples and
// returns the strongest peak. strength is r in -1..1 at that lag, so a value
// near 1 means genuinely periodic and near 0 means there is no period to find.

export function autocorrPeak(sig, rate, minPeriod = 0.2, maxPeriod = 20) {
  const n = sig.length, mu = mean(sig);
  const x = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) { x[i] = sig[i] - mu; energy += x[i] * x[i]; }
  if (energy <= 1e-12) return { period: 0, strength: 0, lag: 0 };

  const minLag = Math.max(1, Math.floor(minPeriod * rate));
  const maxLag = Math.min(n - 2, Math.floor(maxPeriod * rate));
  let bestR = 0, bestLag = 0;
  let prev = 0, prevPrev = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    const r = s / energy;
    // keep only local maxima, so we find a true period rather than the shoulder
    if (lag > minLag + 1 && prev > prevPrev && prev >= r && prev > bestR) { bestR = prev; bestLag = lag - 1; }
    prevPrev = prev; prev = r;
  }
  return { period: bestLag > 0 ? bestLag / rate : 0, strength: Math.max(0, bestR), lag: bestLag };
}

// ---------------------------------------------------------------- cross-correlation
// Which signal leads. Positive lag means a leads b by that many seconds.

export function xcorrLag(a, b, rate, maxLagS = 5) {
  const n = Math.min(a.length, b.length);
  const ma = mean(a), mb = mean(b);
  const x = new Float32Array(n), y = new Float32Array(n);
  let ea = 0, eb = 0;
  for (let i = 0; i < n; i++) { x[i] = a[i] - ma; y[i] = b[i] - mb; ea += x[i] * x[i]; eb += y[i] * y[i]; }
  if (ea <= 1e-12 || eb <= 1e-12) return { lag: 0, r: 0 };
  const norm = Math.sqrt(ea * eb);
  const maxLag = Math.min(n - 2, Math.floor(maxLagS * rate));
  let bestR = -2, bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0;
    if (lag >= 0) for (let i = 0; i + lag < n; i++) s += x[i] * y[i + lag];
    else          for (let i = -lag; i < n; i++)    s += x[i] * y[i + lag];
    const r = s / norm;
    if (r > bestR) { bestR = r; bestLag = lag; }
  }
  return { lag: bestLag / rate, r: bestR };
}

// ---------------------------------------------------------------- convolution
// True FIR convolution of the input history with a kernel. Event channels must
// go through this before any spectral work: it turns a sparse impulse train
// into a continuous envelope.

export function makeKernel(kind, len) {
  const k = new Float32Array(Math.max(1, len));
  const n = k.length;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    k[i] = kind === 'box'   ? 1
         : kind === 'raised'? 0.5 - 0.5 * Math.cos(2 * Math.PI * (1 - t))
         : kind === 'tri'   ? 1 - t
         :                    Math.exp(-5 * t);          // exponential decay
  }
  let s = 0; for (let i = 0; i < n; i++) s += k[i];
  if (s > 0) for (let i = 0; i < n; i++) k[i] /= s;      // unity gain
  return k;
}

// ring holds oldest-first; kernel index 0 is the most recent sample
export function convolveLatest(sig, kernel) {
  const n = sig.length, m = kernel.length;
  let s = 0;
  for (let j = 0; j < m && j < n; j++) s += sig[n - 1 - j] * kernel[j];
  return s;
}

// ---------------------------------------------------------------- filters

export class OnePole {
  constructor() { this.y = null; }
  process(x, cutoffHz, dt) {
    const a = 1 - Math.exp(-2 * Math.PI * Math.max(1e-4, cutoffHz) * dt);
    this.y = this.y == null ? x : this.y + (x - this.y) * a;
    return this.y;
  }
}

export class Envelope {
  constructor() { this.y = 0; }
  process(x, attackMs, releaseMs, dt) {
    const tau = (x > this.y ? attackMs : releaseMs) / 1000;
    const a = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
    this.y += (x - this.y) * a;
    return this.y;
  }
}

// Casiez, Roussel & Vogel (2012). Low cutoff when still, high when moving.
export class OneEuro {
  constructor() { this.x = null; this.dx = 0; }
  process(x, minCut, beta, dt) {
    if (this.x == null) { this.x = x; return x; }
    const dAlpha = 1 - Math.exp(-2 * Math.PI * 1.0 * dt);
    const dxRaw = (x - this.x) / Math.max(dt, 1e-6);
    this.dx += (dxRaw - this.dx) * dAlpha;
    const cut = minCut + beta * Math.abs(this.dx);
    const a = 1 - Math.exp(-2 * Math.PI * Math.max(1e-4, cut) * dt);
    this.x += (x - this.x) * a;
    return this.x;
  }
}

export class Slew {
  constructor() { this.y = null; }
  process(x, maxRate, dt) {
    if (this.y == null) { this.y = x; return x; }
    const d = Math.max(-maxRate * dt, Math.min(maxRate * dt, x - this.y));
    this.y += d;
    return this.y;
  }
}

export class PeakHold {
  constructor() { this.y = 0; }
  process(x, decayPerSec, dt) {
    this.y = Math.max(x, this.y - decayPerSec * dt);
    return this.y;
  }
}

// Voss-McCartney pink noise: genuinely 1/f, which is what reads as organic.
// White noise reads as mechanical and a sine reads as a machine breathing.
export class Pink {
  constructor(octaves = 7) { this.rows = new Float32Array(octaves); this.counter = 0; this.sum = 0; }
  next() {
    this.counter++;
    for (let i = 0; i < this.rows.length; i++) {
      if (this.counter % (1 << i) === 0) {
        this.sum -= this.rows[i];
        this.rows[i] = Math.random() * 2 - 1;
        this.sum += this.rows[i];
      }
    }
    return this.sum / this.rows.length;
  }
}
