const D = require('./dsp.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// 1. fft vs naive DFT, roundtrip
{
  const n = 64, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + (i % 5);
  const r0 = Array.from(re);
  let maxErr = 0;
  const R = Float64Array.from(re), I = new Float64Array(n);
  D.fft(R, I, false);
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let t = 0; t < n; t++) { const a = -2 * Math.PI * k * t / n; sr += r0[t] * Math.cos(a); si += r0[t] * Math.sin(a); }
    maxErr = Math.max(maxErr, Math.abs(sr - R[k]), Math.abs(si - I[k]));
  }
  ok(maxErr < 1e-9, 'fft matches naive DFT, max err ' + maxErr.toExponential(2));
  D.fft(R, I, true);
  let e2 = 0; for (let i = 0; i < n; i++) e2 = Math.max(e2, Math.abs(R[i] - r0[i]));
  ok(e2 < 1e-12, 'fft round trip err ' + e2.toExponential(2));
}

// 2. fft2 round trip
{
  const N = 64, re = new Float64Array(N * N), im = new Float64Array(N * N), orig = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) orig[i] = re[i] = Math.random() * 255;
  D.fft2(re, im, N, false); D.fft2(re, im, N, true);
  let e = 0; for (let i = 0; i < N * N; i++) e = Math.max(e, Math.abs(re[i] - orig[i]), Math.abs(im[i]));
  ok(e < 1e-8, 'fft2 round trip err ' + e.toExponential(2));
}

// 3. mask all-ones = identity; lowpass lowers high-frequency energy; output stays real (imag small)
{
  const N = 128, g = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) g[i] = 128 + 100 * (Math.random() - 0.5);
  const ones = D.maskPreset(N, 'low', 1000);
  const r = D.applyMask(g, ones, N, 1);
  let e = 0; for (let i = 0; i < N * N; i++) e = Math.max(e, Math.abs(r.out[i] - g[i]));
  ok(e < 1e-6, 'all-pass mask is identity, err ' + e.toExponential(2));
  const lp = D.maskPreset(N, 'low', 10);
  const r2 = D.applyMask(g, lp, N, 1);
  const hf = (a) => { let s = 0; for (let y = 0; y < N; y++) for (let x = 1; x < N; x++) s += Math.abs(a[y * N + x] - a[y * N + x - 1]); return s / (N * N); };
  ok(hf(r2.out) < hf(g) * 0.4, `lowpass reduces pixel-to-pixel change: ${hf(g).toFixed(2)} -> ${hf(r2.out).toFixed(2)}`);
  let mean0 = 0, mean1 = 0; for (let i = 0; i < N * N; i++) { mean0 += g[i]; mean1 += r2.out[i]; }
  ok(Math.abs(mean0 - mean1) / (N * N) < 1e-6, 'DC (average brightness) kept');
  // painted symmetric mask keeps image real: check imaginary leak by comparing with a re-FFT energy
  const m = new Float32Array(N * N).fill(1);
  D.paintMask(m, N, 40, 50, 8, 0, true);
  const r3 = D.applyMask(g, m, N, 1);
  // if symmetry broke, applyMask would still return real part only; test energy: Parseval check on filtered spectrum
  let eIn = 0, eOut = 0; for (let i = 0; i < N * N; i++) { eIn += g[i] * g[i]; eOut += r3.out[i] * r3.out[i]; }
  ok(eOut < eIn && eOut > 0.5 * eIn, 'painted hole removes some energy only: ' + (eOut / eIn).toFixed(3));
  // symmetry of painted mask
  let sym = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) sym = Math.max(sym, Math.abs(m[y * N + x] - m[((N - y) % N) * N + ((N - x) % N)]));
  ok(sym < 1e-6, 'painted mask is point-symmetric, max diff ' + sym);
}

// 4. wedge keeps a stripe pattern of matching direction, removes the orthogonal one
{
  const N = 128, stripes = (ang) => { const g = new Float64Array(N * N); const kx = Math.cos(ang) * 2 * Math.PI * 10 / N, ky = Math.sin(ang) * 2 * Math.PI * 10 / N; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g[y * N + x] = 128 + 100 * Math.sin(kx * x + ky * y); return g; };
  const sd = (a) => { let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / a.length); };
  const mask = D.maskPreset(N, 'wedge', 0, 20); // keep frequency direction 0 deg (horizontal u axis)
  const keep = D.applyMask(stripes(0), mask, N, 1).out.slice();
  const drop = D.applyMask(stripes(Math.PI / 2), mask, N, 1).out.slice();
  ok(sd(keep) > 60 && sd(drop) < 10, `wedge: matching stripes sd=${sd(keep).toFixed(1)}, orthogonal sd=${sd(drop).toFixed(1)}`);
}

// 5. spectrogram synth: horizontal painted line -> sine at the right frequency and amplitude
{
  const S = D.SPEC, grid = new Uint8Array(S.W * S.H);
  const row = 40;
  const f_expected = D.rowFreq(row);
  for (let x = 0; x < S.W; x++) grid[row * S.W + x] = 255;
  const a = D.synthSpectrogram(grid);
  // analyse middle 4096 samples
  const n = 4096, off = Math.floor(a.length / 2) - n / 2;
  const re = new Float64Array(n), im = new Float64Array(n), w = D.hann(n);
  for (let i = 0; i < n; i++) re[i] = a[off + i] * w[i];
  D.fft(re, im, false);
  let pk = 1, pm = 0; for (let k = 1; k < n / 2; k++) { const m = Math.hypot(re[k], im[k]); if (m > pm) { pm = m; pk = k; } }
  const f_meas = pk * S.sr / n;
  ok(Math.abs(f_meas - f_expected) < 2 * S.sr / S.N, `painted row ${row}: expected ${f_expected.toFixed(1)} Hz, measured ${f_meas.toFixed(1)} Hz`);
  let mx = 0; for (let i = off; i < off + n; i++) mx = Math.max(mx, Math.abs(a[i]));
  ok(mx <= 0.6001 && mx > 0.05, 'peak amplitude in range ' + mx.toFixed(3));
  ok(Math.abs(a.length / S.sr - S.dur) < 1e-9, 'duration ' + S.dur.toFixed(3) + ' s');
  // two rows -> two peaks; time-limited paint -> silence elsewhere
  const g2 = new Uint8Array(S.W * S.H);
  for (let x = 100; x < 140; x++) g2[20 * S.W + x] = 255;
  const b = D.synthSpectrogram(g2);
  const rms = (s, e) => { let t = 0; for (let i = s; i < e; i++) t += b[i] * b[i]; return Math.sqrt(t / (e - s)); };
  const hop = S.hop;
  ok(rms(120 * hop, 125 * hop) > 0.05 && rms(10 * hop, 40 * hop) < 1e-4 && rms(200 * hop, 240 * hop) < 1e-4, 'sound exists only where painted in time');
  // louder paint -> louder sound (before peak normalisation kicks in)
  const g3 = new Uint8Array(S.W * S.H), g4 = new Uint8Array(S.W * S.H);
  for (let x = 0; x < S.W; x++) { g3[30 * S.W + x] = 10; g4[30 * S.W + x] = 30; }
  const rr = (arr) => { let t = 0; for (let i = 10000; i < 40000; i++) t += arr[i] ** 2; return Math.sqrt(t / 30000); };
  ok(rr(D.synthSpectrogram(g4)) > 2 * rr(D.synthSpectrogram(g3)), 'brighter paint is louder');
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
