// dsp.js — small DSP kit for the Scanimate-style lab. No DOM. Works in browser and node.
(function (g) {
  'use strict';
  const TAU = Math.PI * 2;

  // In-place radix-2 FFT. n must be a power of 2. inverse=true divides by n.
  const twid = {};
  function twiddles(n) {
    if (twid[n]) return twid[n];
    const c = new Float64Array(n / 2), s = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) { c[k] = Math.cos((TAU * k) / n); s[k] = Math.sin((TAU * k) / n); }
    return (twid[n] = { c, s });
  }
  function fft(re, im, inverse) {
    const n = re.length, T = twiddles(n), sg = inverse ? 1 : -1;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const cr = T.c[j * step], ci = sg * T.s[j * step];
          const a = i + j, b = a + half;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  // 2D FFT on an N x N complex image stored row-major. In place.
  const tmp = {};
  function fft2(re, im, N, inverse) {
    const tr = tmp.tr && tmp.tr.length === N ? tmp.tr : (tmp.tr = new Float64Array(N));
    const ti = tmp.ti && tmp.ti.length === N ? tmp.ti : (tmp.ti = new Float64Array(N));
    for (let y = 0; y < N; y++) {
      const o = y * N;
      for (let x = 0; x < N; x++) { tr[x] = re[o + x]; ti[x] = im[o + x]; }
      fft(tr, ti, inverse);
      for (let x = 0; x < N; x++) { re[o + x] = tr[x]; im[o + x] = ti[x]; }
    }
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) { tr[y] = re[y * N + x]; ti[y] = im[y * N + x]; }
      fft(tr, ti, inverse);
      for (let y = 0; y < N; y++) { re[y * N + x] = tr[y]; im[y * N + x] = ti[y]; }
    }
  }

  function hann(N) {
    const w = new Float64Array(N);
    for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((TAU * i) / N); // periodic
    return w;
  }

  // ---------- Spectrogram painter -> sound (iSTFT) ----------
  // grid: Uint8Array W*H, row 0 = highest frequency. Time runs along x.
  const SPEC = { W: 256, H: 96, N: 1024, hop: 256, sr: 22050, fmin: 100, fmax: 8000 };
  SPEC.dur = ((SPEC.W - 1) * SPEC.hop + SPEC.N) / SPEC.sr; // seconds

  function rowFreq(y, o = SPEC) { // frequency (Hz) of paint row y
    return o.fmin * Math.pow(o.fmax / o.fmin, 1 - y / (o.H - 1));
  }

  function paintColumn(grid, col, mags, o = SPEC) {
    const { W, H, N, sr, fmin, fmax } = o;
    const binHz = sr / N, L = Math.log(fmax / fmin);
    const yOf = (f) => (1 - Math.log(f / fmin) / L) * (H - 1);
    mags.fill(0);
    for (let k = 1; k < N / 2; k++) {
      const f = k * binHz;
      if (f < fmin * 0.92 || f > fmax * 1.04) continue;
      const y0 = yOf((k + 0.5) * binHz), y1 = yOf((k - 0.5) * binHz);
      let v = 0;
      if (y1 - y0 > 1) {
        const a = Math.max(0, Math.ceil(y0)), b = Math.min(H - 1, Math.floor(y1));
        for (let r = a; r <= b; r++) v = Math.max(v, grid[r * W + col]);
      } else {
        const y = Math.min(H - 1, Math.max(0, yOf(f)));
        const r0 = Math.floor(y), r1 = Math.min(H - 1, r0 + 1), fr = y - r0;
        v = grid[r0 * W + col] * (1 - fr) + grid[r1 * W + col] * fr;
      }
      mags[k] = v / 255;
    }
  }

  // Build audio: each column -> spectrum with coherent phase -> iFFT -> Hann -> overlap-add.
  function synthSpectrogram(grid, o = SPEC, peak = 0.6) {
    const { W, N, hop } = o;
    const total = (W - 1) * hop + N;
    const out = new Float64Array(total);
    const win = hann(N);
    const phase = new Float64Array(N / 2 + 1);
    const re = new Float64Array(N), im = new Float64Array(N);
    const mags = new Float64Array(N / 2 + 1);
    for (let t = 0; t < W; t++) {
      paintColumn(grid, t, mags, o);
      re.fill(0); im.fill(0);
      for (let k = 1; k < N / 2; k++) {
        const a = mags[k] * (N / 2);
        if (a > 0) {
          re[k] = a * Math.cos(phase[k]); im[k] = a * Math.sin(phase[k]);
          re[N - k] = re[k]; im[N - k] = -im[k];
        }
        phase[k] = (phase[k] + (TAU * k * hop) / N) % TAU;
      }
      fft(re, im, true);
      const base = t * hop;
      for (let n = 0; n < N; n++) out[base + n] += re[n] * win[n] * 0.5; // Hann @ 75% overlap sums to 2
    }
    let mx = 0;
    for (let i = 0; i < total; i++) mx = Math.max(mx, Math.abs(out[i]));
    const s = mx > peak ? peak / mx : 1;
    const f32 = new Float32Array(total);
    const fade = 256;
    for (let i = 0; i < total; i++) {
      let e = 1;
      if (i < fade) e = i / fade; else if (i > total - fade) e = (total - i) / fade;
      f32[i] = out[i] * s * e;
    }
    return f32;
  }

  // ---------- 2D mask filter ----------
  // mask: Float32Array N*N, DC at (N/2, N/2) (fft-shifted layout), values 0..1.
  function maskPreset(N, kind, a, b) {
    const m = new Float32Array(N * N), c = N / 2;
    const soft = (d, edge, w) => { const t = Math.min(1, Math.max(0, (edge - d) / w + 0.5)); return t; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x - c, v = y - c, r = Math.hypot(u, v);
      let val = 1;
      if (kind === 'low') val = soft(r, a, 3);
      else if (kind === 'high') val = 1 - soft(r, a, 3);
      else if (kind === 'ring') val = soft(r, b, 3) * (1 - soft(r, a, 3));
      else if (kind === 'wedge') { // keep directions within +-b degrees of angle a (symmetric)
        let d = Math.abs(((Math.atan2(v, u) * 180) / Math.PI - a) % 180);
        if (d > 90) d = 180 - d;
        val = r < 2 ? 1 : soft(d, b, 4);
      } else if (kind === 'none') val = 0;
      m[y * N + x] = val;
    }
    return m;
  }

  // Paint a soft round brush on the mask. val = 1 keeps, 0 removes. symmetric keeps output real.
  function paintMask(mask, N, x, y, rad, val, symmetric = true, strength = 1) {
    const stamp = (cx, cy) => {
      const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(N - 1, Math.ceil(cx + rad));
      const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(N - 1, Math.ceil(cy + rad));
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        const d = Math.hypot(xx - cx, yy - cy);
        if (d > rad) continue;
        const k = strength * (1 - d / rad);
        const i = yy * N + xx;
        mask[i] += (val - mask[i]) * Math.min(1, k * 1.5);
      }
    };
    stamp(x, y);
    if (symmetric) stamp((N - x) % N, (N - y) % N);
  }

  const buf = {};
  // gray: Float64Array/Uint8 N*N (0..255). Returns {out, spec} ; out is Float64Array (not clamped).
  function applyMask(gray, mask, N, mix = 1) {
    const key = N;
    const b = buf[key] || (buf[key] = { re: new Float64Array(N * N), im: new Float64Array(N * N), out: new Float64Array(N * N), spec: new Float32Array(N * N) });
    const { re, im, out, spec } = b;
    for (let i = 0; i < N * N; i++) { re[i] = gray[i]; im[i] = 0; }
    fft2(re, im, N, false);
    const h = N / 2;
    let maxMag = 1e-9;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const si = ((j + h) % N) * N + ((i + h) % N); // shifted display position of fft bin (i,j)
      const mag = Math.log1p(Math.hypot(re[j * N + i], im[j * N + i]));
      spec[si] = mag; if (mag > maxMag) maxMag = mag;
      const mv = (i === 0 && j === 0) ? 1 : mask[si]; // DC always kept
      re[j * N + i] *= mv; im[j * N + i] *= mv;
    }
    for (let i = 0; i < N * N; i++) spec[i] /= maxMag;
    fft2(re, im, N, true);
    for (let i = 0; i < N * N; i++) out[i] = gray[i] * (1 - mix) + re[i] * mix;
    return { out, spec };
  }

  const api = { fft, fft2, hann, SPEC, rowFreq, paintColumn, synthSpectrogram, maskPreset, paintMask, applyMask };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.DSP = api;
})(typeof window !== 'undefined' ? window : globalThis);
