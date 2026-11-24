// opkit.js — the small shared vocabulary every operator file uses.
//
// Split out of ops.js so the shape and drawing operator files can use the same
// parameter constructors without importing each other in a circle.

// Parameter constructors. `type` is what the editor switches on to build a row.
export const num   = (k, label, def, min, max, step = 0.01) => ({ k, label, type:'num', def, min, max, step });
export const sel   = (k, label, def, options)               => ({ k, label, type:'sel', def, options });
export const col   = (k, label, def)                        => ({ k, label, type:'col', def });
export const curve = (k, label, def)                        => ({ k, label, type:'curve', def });
// A free-text parameter. Used by the selector blocks, whose values are
// filled in by clicking an element in the inspector rather than typed.
export const txt   = (k, label, def = '')                   => ({ k, label, type:'txt', def });

export const fin = v => (Number.isFinite(v) ? v : 0);

// How many analysis samples to take this frame, at the operator's own rate.
// Analysis operators decimate rather than running at the page's frame rate, so
// a period measured on a 60 fps machine reads the same on a 30 fps one.
export function tick(s, c, rate) {
  s.acc = (s.acc || 0) + c.dt;
  const step = 1 / Math.max(0.5, rate);
  let n = 0;
  while (s.acc >= step && n < 8) { s.acc -= step; n++; }
  return n;
}

// ---------------------------------------------------------------- curves
// A drawn curve is N samples in 0..1, oldest-to-newest left-to-right. Plain
// numbers, so it survives JSON and can be scrubbed, saved and diffed.
export const CURVE_N = 32;

export function makeCurve(shape = 'ramp', n = CURVE_N) {
  const a = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    a[i] = shape === 'ramp'  ? t
         : shape === 'fall'  ? 1 - t
         : shape === 'hump'  ? Math.sin(Math.PI * t)
         : shape === 'decay' ? Math.exp(-3 * t)
         : shape === 'flat'  ? 0.5
         : t;
  }
  return a;
}

// Linear interpolation into a curve at t in 0..1. Out-of-range clamps, so a
// curve used as a transfer function is defined everywhere.
export function curveAt(cv, t) {
  if (!cv || !cv.length) return 0;
  const n = cv.length;
  const x = Math.min(1, Math.max(0, t)) * (n - 1);
  const i = Math.floor(x), f = x - i;
  const a = fin(cv[i]), b = fin(cv[Math.min(n - 1, i + 1)]);
  return a + (b - a) * f;
}

// Resample a curve to m points — how a 32-point drawing becomes a 64-tap FIR
// kernel or a 257-bin spectral mask.
export function curveResample(cv, m) {
  const out = new Float32Array(m);
  for (let i = 0; i < m; i++) out[i] = curveAt(cv, m === 1 ? 0 : i / (m - 1));
  return out;
}

// ---------------------------------------------------------------- colour
// Colours are stored as hex strings so they survive JSON, diff readably in
// patch.json, and can be pasted straight out of a reference image.

export function hexToRgb(h) {
  if (typeof h !== 'string') return [255, 255, 255];
  let s = h.trim().replace(/^#/, '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return [255, 255, 255];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export const rgbToHex = c =>
  '#' + c.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// Rotate a colour's hue, keeping its value and saturation. Used by the ramp
// colouriser so one signal can sweep an entire palette.
export function hueRotate(rgb, turns) {
  if (!turns) return rgb;
  const [r, g, b] = rgb.map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  const s = mx <= 0 ? 0 : d / mx, v = mx;
  h = (h + turns) % 1; if (h < 0) h += 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [R, G, B] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6];
  return [R * 255, G * 255, B * 255];
}

// Turns are friendlier than radians on a scrubbable parameter, and they are
// what the operators of the analogue machines actually counted in.
export const TURN = Math.PI * 2;
