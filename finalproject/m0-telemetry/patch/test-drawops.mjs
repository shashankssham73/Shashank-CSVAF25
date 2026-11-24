// Tests for the operators where a DRAWING is the computation. Each one checks
// a property the drawing is supposed to give the signal, not merely that the
// code runs.

import { DRAW_OPS } from './drawops.js';
import { makeCurve, curveResample, CURVE_N } from './opkit.js';
import { fft, hann } from './dsp.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}${got !== undefined ? ' -> ' + got : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' -> ' + got : ''}`); }
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// Run an operator over a signal, one eval per step, like the graph does.
function run(type, params, inputs, steps, dt) {
  const op = DRAW_OPS[type];
  const p = {}; for (const q of op.params) p[q.k] = q.def;
  Object.assign(p, params);
  const s = op.init();
  const outs = [];
  for (let k = 0; k < steps; k++) {
    const ins = inputs(k).map(v => (v === undefined ? null : v));
    outs.push(op.eval(p, ins, s, { dt, t: k * dt, raw:{}, labels:{}, out:{} }));
  }
  return outs;
}
// peak-frequency / band-share analysis of a real signal, for the mask test
function spec(sig, rate) {
  const n = 1 << Math.floor(Math.log2(sig.length));
  const w = hann(n);
  const re = new Float32Array(n), im = new Float32Array(n);
  let mu = 0; for (let i = 0; i < n; i++) mu += sig[sig.length - n + i];
  mu /= n;
  for (let i = 0; i < n; i++) { re[i] = (sig[sig.length - n + i] - mu) * w[i]; im[i] = 0; }
  fft(re, im);
  const half = n >> 1, mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) mag[k] = Math.hypot(re[k], im[k]);
  let best = 1, tot = 0;
  for (let k = 1; k <= half; k++) { if (mag[k] > mag[best]) best = k; tot += mag[k]; }
  return { peak: best * rate / n, mag, tot, binHz: rate / n, half };
}

// ============================================================ drawn transfer
{
  // A straight diagonal must be the identity, or nothing downstream is trustworthy.
  const o = run('draw.transfer', { cv: makeCurve('ramp'), il:0, ih:1, ol:0, oh:1 },
                k => [k / 99], 100, 1/60);
  let worst = 0;
  for (let k = 0; k < 100; k++) worst = Math.max(worst, Math.abs(o[k][0] - k / 99));
  ok('drawn transfer: a diagonal is the identity', worst < 1e-6, 'worst ' + worst.toExponential(1));
}
{
  const o = run('draw.transfer', { cv: makeCurve('flat'), il:0, ih:1, ol:0, oh:1 },
                k => [k / 99], 100, 1/60);
  ok('drawn transfer: a flat drawing ignores its input',
     o.every(v => near(v[0], 0.5, 1e-9)), 'all ' + o[0][0].toFixed(3));
}
{
  // out lo/hi must rescale, so a drawing in 0..1 can drive any destination
  const o = run('draw.transfer', { cv: makeCurve('ramp'), il:0, ih:100, ol:26, oh:116 },
                () => [50], 3, 1/60);
  ok('drawn transfer: input and output ranges map', near(o[0][0], 71, 1e-6), o[0][0].toFixed(3));
}
{
  const o = run('draw.transfer', { cv: makeCurve('ramp'), il:0, ih:1, ol:0, oh:1 },
                k => [k === 0 ? -5 : 5], 2, 1/60);
  ok('drawn transfer: out-of-range input clamps', o[0][0] === 0 && o[1][0] === 1,
     `${o[0][0]} ${o[1][0]}`);
}

// ============================================================== drawn kernel
{
  // A single drawn spike is a PURE DELAY. This is the test that proves the tap
  // ordering: tap 0 is the newest sample, so a spike drawn at the left edge is
  // no delay and a spike at the right edge is the full kernel length.
  const n = CURVE_N;
  for (const [where, label] of [[0,'left edge = no delay'], [n-1,'right edge = full length']]) {
    const cv = new Array(n).fill(0); cv[where] = 1;
    // 32 taps at 32 Hz over 1 s => tap index == curve index, no resampling blur
    const o = run('draw.kernel', { cv, len:1, rate:32, norm:'raw', gain:1 },
                  k => [k === 5 ? 1 : 0], 60, 1/32);
    const fired = o.map(v => v[0]).findIndex(v => v > 0.5);
    const expect = 5 + Math.round(where * (32 - 1) / (n - 1));
    ok(`drawn kernel: a spike is a pure delay (${label})`, fired === expect,
       `impulse at 5, output at ${fired}, expected ${expect}`);
  }
}
{
  // A flat normalised drawing is a boxcar moving average: a step response that
  // climbs linearly and settles at exactly 1.
  const o = run('draw.kernel', { cv: makeCurve('flat'), len:1, rate:20, norm:'unity', gain:1 },
                () => [1], 80, 1/20);
  const y = o.map(v => v[0]);
  ok('drawn kernel: taps sum to 1 when normalised', near(y[60], 1, 1e-6), y[60].toFixed(6));
  ok('drawn kernel: boxcar step response is half way at half the window',
     near(y[10], 0.5, 0.06), y[10].toFixed(4));
  let mono = true; for (let k = 1; k <= 20; k++) if (y[k] < y[k-1] - 1e-9) mono = false;
  ok('drawn kernel: step response rises monotonically', mono);
}
{
  // It must actually FILTER. A 2 s flat kernel is a boxcar with nulls at every
  // multiple of 0.5 Hz, so a 3 Hz tone should be crushed and 0.05 Hz should pass.
  const rate = 20, N = 1200;
  const slow = k => Math.sin(2*Math.PI*0.05*k/rate);
  const fast = k => Math.sin(2*Math.PI*3.0*k/rate);
  const a = run('draw.kernel', { cv: makeCurve('flat'), len:2, rate, norm:'unity', gain:1 },
                k => [slow(k)], N, 1/rate).map(v=>v[0]).slice(600);
  const b = run('draw.kernel', { cv: makeCurve('flat'), len:2, rate, norm:'unity', gain:1 },
                k => [fast(k)], N, 1/rate).map(v=>v[0]).slice(600);
  const amp = s => (Math.max(...s) - Math.min(...s)) / 2;
  ok('drawn kernel: passes 0.05 Hz', amp(a) > 0.9, amp(a).toFixed(4));
  ok('drawn kernel: rejects 3 Hz (a boxcar null)', amp(b) < 0.02, amp(b).toFixed(5));
  ok('drawn kernel: that is >33 dB of separation',
     20*Math.log10(amp(a)/Math.max(1e-9,amp(b))) > 33,
     (20*Math.log10(amp(a)/Math.max(1e-9,amp(b)))).toFixed(1) + ' dB');
}
{
  // The reported tap sum is the drawing's own gain before normalising, which is
  // what tells you whether a raw kernel will amplify.
  const o = run('draw.kernel', { cv: makeCurve('flat'), len:1, rate:20, norm:'raw', gain:1 },
                () => [0], 5, 1/20);
  ok('drawn kernel: reports its raw tap sum', near(o[4][1], 10, 1e-4), o[4][1].toFixed(4));
}
{
  // Editing the drawing must take effect; editing only the gain must NOT throw
  // away the accumulated history.
  const op = DRAW_OPS['draw.kernel'];
  const p = {}; for (const q of op.params) p[q.k] = q.def;
  Object.assign(p, { cv: makeCurve('flat'), len:1, rate:20, norm:'unity', gain:1 });
  const s = op.init();
  const ctx = { dt:1/20, t:0, raw:{}, labels:{}, out:{} };
  for (let k = 0; k < 60; k++) op.eval(p, [1], s, ctx);
  const before = op.eval(p, [1], s, ctx)[0];
  p.gain = 2;
  const after = op.eval(p, [1], s, ctx)[0];
  ok('drawn kernel: a gain change does not reset the history', near(after, before*2, 1e-6),
     `${before.toFixed(4)} -> ${after.toFixed(4)}`);
}

// ================================================================ drawn mask
{
  // A hand-painted frequency response: 1 at DC falling to 0 at fmax. With
  // fmax = 1 Hz, a 0.2 Hz tone sits at gain 0.8 and an 8 Hz tone is far past
  // the right edge of the drawing, so it reads 0.
  const rate = 10, N = 2600;
  const sig = k => Math.sin(2*Math.PI*0.2*k/rate) + Math.sin(2*Math.PI*4.0*k/rate);
  const o = run('draw.mask', { cv: makeCurve('fall'), n:'256', rate, fmax:1, gain:1 },
                k => [sig(k)], N, 1/rate).map(v => v[0]);
  const tail = o.slice(1200);
  ok('drawn mask: produces output once its window fills',
     Math.max(...tail.map(Math.abs)) > 0.1, 'peak ' + Math.max(...tail.map(Math.abs)).toFixed(3));
  const S = spec(tail, rate);
  ok('drawn mask: output peaks at the drawn passband (0.2 Hz)', near(S.peak, 0.2, S.binHz * 1.5),
     S.peak.toFixed(4) + ' Hz');
  // share of energy above 1 Hz, where the drawing reads zero
  let stop = 0;
  for (let k = 1; k <= S.half; k++) if (k * S.binHz > 1.2) stop += S.mag[k];
  ok('drawn mask: rejects everything past the right edge of the drawing',
     stop / S.tot < 0.02, (100*stop/S.tot).toFixed(3) + '% of energy');
}
{
  // An all-ones drawing must be transparent: a flat mask at 1.0 should pass the
  // signal, which separates "the mask works" from "the mask kills everything".
  const rate = 10, N = 2200;
  const cv = new Array(CURVE_N).fill(1);
  const o = run('draw.mask', { cv, n:'256', rate, fmax:5, gain:1 },
                k => [Math.sin(2*Math.PI*0.3*k/rate)], N, 1/rate).map(v=>v[0]).slice(1200);
  const amp = (Math.max(...o) - Math.min(...o)) / 2;
  ok('drawn mask: an all-ones drawing passes the signal through', amp > 0.85 && amp < 1.15,
     'amplitude ' + amp.toFixed(4));
}
{
  const rate = 10, N = 1600;
  const cv = new Array(CURVE_N).fill(0);
  const o = run('draw.mask', { cv, n:'256', rate, fmax:5, gain:1 },
                k => [Math.sin(2*Math.PI*0.3*k/rate)], N, 1/rate).map(v=>v[0]).slice(900);
  ok('drawn mask: an all-zero drawing silences it',
     Math.max(...o.map(Math.abs)) < 1e-6, Math.max(...o.map(Math.abs)).toExponential(1));
}

// ================================================================ drawn ramp
{
  const o = run('gen.ramp', { cv: makeCurve('ramp'), per:1, mode:'loop', amp:1, off:0 },
                () => [undefined, undefined], 121, 1/60);
  // frame 59 is the 60th evaluation, where phase reaches exactly 1.0 and wraps
  // to exactly 0 -- in a loop those are the same point, so check frame 58.
  ok('drawn ramp: phase reaches the end of its period', near(o[58][1], 59/60, 1e-6), o[58][1].toFixed(4));
  ok('drawn ramp: loop mode wraps exactly once in one period',
     o[59][1] < 0.02 && o[61][1] < 0.1, `${o[59][1].toFixed(4)} ${o[61][1].toFixed(4)}`);
  ok('drawn ramp: a drawn diagonal gives phase as the output',
     near(o[30][0], o[30][1], 1e-6), `${o[30][0].toFixed(4)} vs ${o[30][1].toFixed(4)}`);
}
{
  const o = run('gen.ramp', { cv: makeCurve('ramp'), per:1, mode:'once', amp:1, off:0 },
                () => [undefined, undefined], 200, 1/60);
  ok('drawn ramp: once mode holds at the end', near(o[199][1], 1, 1e-9) && near(o[199][0], 1, 1e-9),
     o[199][0].toFixed(6));
}
{
  // a rising edge on the trigger restarts the sweep
  const o = run('gen.ramp', { cv: makeCurve('ramp'), per:1, mode:'once', amp:1, off:0 },
                k => [k === 100 ? 1 : 0, undefined], 160, 1/60);
  ok('drawn ramp: a rising edge retriggers it', o[99][1] > 0.95 && o[101][1] < 0.1,
     `before ${o[99][1].toFixed(3)} after ${o[101][1].toFixed(3)}`);
}
{
  // the shape really is the drawing: a hump peaks mid-sweep, not at the end
  const o = run('gen.ramp', { cv: makeCurve('hump'), per:1, mode:'loop', amp:1, off:0 },
                () => [undefined, undefined], 61, 1/60);
  const vals = o.map(v=>v[0]);
  const at = vals.indexOf(Math.max(...vals));
  ok('drawn ramp: a hump drawing peaks mid-sweep', at > 24 && at < 36, 'peak at frame ' + at);
}

// ============================================================ sample and hold
{
  const o = run('gen.sh', { thr:0.5, init:0 },
                k => [k / 10, (k === 30 || k === 31) ? 1 : 0], 60, 1/60);
  ok('sample & hold: outputs the initial value before any trigger', o[10][0] === 0, o[10][0]);
  ok('sample & hold: captures on the rising edge', near(o[31][0], 3.0, 1e-9), o[31][0].toFixed(3));
  ok('sample & hold: holds it after the trigger falls', near(o[59][0], 3.0, 1e-9), o[59][0].toFixed(3));
  ok('sample & hold: does not re-capture while held high', near(o[32][0], 3.0, 1e-9), o[32][0].toFixed(3));
  // captured at k=30 (age reset, no increment that frame), then k=31..59 add dt
  ok('sample & hold: reports age since capture', near(o[59][1], 29/60, 1e-6), o[59][1].toFixed(4));
}

// ================================================================= sequencer
{
  const o = run('gen.seq', { s0:0.2,s1:0.5,s2:0.8,s3:0.4,s4:1,s5:0.3,s6:0.6,s7:0.1,
                             n:4, rate:0, glide:'off', gt:0.15 },
                k => [k % 10 < 5 ? 1 : 0], 100, 1/60);
  ok('sequencer: starts on step 1', o[0][1] === 0, 'step ' + o[0][1]);
  ok('sequencer: advances on a rising clock edge', o[11][1] === 1 && o[21][1] === 2,
     `${o[11][1]} then ${o[21][1]}`);
  ok('sequencer: wraps at the step count', o[41][1] === 0, 'step ' + o[41][1]);
  ok('sequencer: emits the step value', near(o[11][0], 0.5, 1e-9), o[11][0].toFixed(3));
}
{
  const o = run('gen.seq', { s0:0,s1:1,s2:0,s3:0,s4:0,s5:0,s6:0,s7:0,
                             n:2, rate:2, glide:'on', gt:0.2 },
                () => [undefined], 240, 1/60);
  const vals = o.map(v=>v[0]);
  let jump = 0;
  for (let k = 60; k < 240; k++) jump = Math.max(jump, Math.abs(vals[k]-vals[k-1]));
  ok('sequencer: glide removes the step discontinuity', jump < 0.12, 'largest jump ' + jump.toFixed(4));
  ok('sequencer: free-runs without a clock', new Set(o.slice(60).map(v=>v[1])).size === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
