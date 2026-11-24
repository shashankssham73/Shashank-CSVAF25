// sdf.js — the shape language.
//
// A shape is not a bitmap and not a path. It is a SIGNED DISTANCE FIELD: a
// function that, for any point, returns how far that point is from the shape's
// edge — negative inside, zero exactly on the edge, positive outside.
//
// That one choice buys everything the patcher needs:
//
//   booleans are arithmetic    union = min(a,b), subtract = max(a,-b)
//   blending is continuous     a smooth-min with a modulatable radius
//   contours are free          slice the same field at d = 0.02, 0.04, 0.06
//   morphing is a lerp         mix two fields and the shape tweens between them
//   nothing ever pops          every parameter is continuous, so every
//                              parameter is a legal modulation destination
//
// A shape value on a wire is `{ $:'shape', d: spec, n: depth }` where spec is a
// plain-data tree. Plain data, so it is cheap to build fresh every frame and
// impossible to leak state through.
//
// SPACE. Shapes live in an aspect-corrected field space centred on the origin:
//
//   fx = (nx - 0.5) * ASPECT     nx in 0..1 across the raster   fx in -0.8..0.8
//   fy = (ny - 0.5)              ny in 0..1 down the raster     fy in -0.5..0.5
//
// so a circle of radius 0.3 is a circle and not an ellipse. ASPECT must match
// SW/SH in viz/source.js; viz/shapes.js asserts that it does.

export const ASPECT = 512 / 320;          // 1.6
export const toFieldX = nx => (nx - 0.5) * ASPECT;
export const toFieldY = ny => (ny - 0.5);

// A shape spec arriving back at its own input through a graph cycle would nest
// one level deeper every frame and grow without bound. Depth is carried on the
// value and operators refuse to wrap past this, which caps it.
export const MAX_DEPTH = 24;

export const isShape = v => !!(v && v.$ === 'shape' && v.d);
export const shape   = (d, n = 1) => ({ $:'shape', d, n });
export const depthOf = v => (isShape(v) ? (v.n | 0) : 0);

// The empty shape: infinitely far away, so it is the identity for union and
// vanishes under fill. Operators return this rather than null.
export const NOTHING = shape({ t:'nothing' }, 1);

// ---------------------------------------------------------------- combiners

export function smin(a, b, k) {
  if (k <= 1e-6) return Math.min(a, b);
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) {
  if (k <= 1e-6) return Math.max(a, b);
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

// ---------------------------------------------------------------- compiler
//
// A spec is compiled ONCE into a nested closure, then sampled tens of
// thousands of times. Compiling hoists every parameter read and every
// trig constant out of the inner loop, which is where all the time goes.
//
// This is the only implementation of the shape semantics. `evalSpec` below is
// a one-shot wrapper over it, so the readable path and the fast path cannot
// drift apart — test-shapes.mjs asserts they agree anyway.

const len = (x, y) => Math.sqrt(x * x + y * y);     // Math.hypot is ~3x slower
const FAR = 1e9;

export function compileSpec(s, curveAt) {
  if (!s || typeof s.t !== 'string') return () => FAR;
  switch (s.t) {

    case 'nothing': return () => FAR;

    case 'circle': {
      const x = s.x, y = s.y, r = Math.max(1e-5, s.r);
      return (px, py) => len(px - x, py - y) - r;
    }

    case 'box': {
      const x = s.x, y = s.y;
      const w = Math.max(1e-5, s.w), h = Math.max(1e-5, s.h);
      const rad = Math.min(s.r, Math.min(w, h) * 0.999);
      const bw = w - rad, bh = h - rad;
      return (px, py) => {
        const qx = Math.abs(px - x) - bw, qy = Math.abs(py - y) - bh;
        return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
      };
    }

    // Regular n-gon of apothem `a`, exact: fold the plane into one wedge, then
    // measure to that wedge's single edge segment.
    case 'ngon': {
      const x = s.x, y = s.y, a = Math.max(1e-5, s.r);
      const n = Math.max(3, Math.round(s.n));
      const an = Math.PI / n, he = a * Math.tan(an), two = 2 * an;
      const c0 = Math.cos(-s.a), s0 = Math.sin(-s.a);
      return (px, py) => {
        const dx = px - x, dy = py - y;
        const ux = c0 * dx - s0 * dy, uy = s0 * dx + c0 * dy;
        const bn = two * Math.floor((Math.atan2(uy, ux) + an) / two);
        const c = Math.cos(bn), si = Math.sin(bn);
        const qx =  c * ux + si * uy;
        const qy = -si * ux + c * uy;
        const cy = qy < -he ? -he : qy > he ? he : qy;
        const d = len(qx - a, qy - cy);
        return qx < a ? -d : d;
      };
    }

    // Star of outer radius r with n points. `m` is the inner-angle parameter:
    // m = 2 is spikiest, m = n degenerates to the n-gon. (I. Quilez, sdStar.)
    case 'star': {
      const x = s.x, y = s.y, r = Math.max(1e-5, s.r);
      const n = Math.max(3, Math.round(s.n));
      const m = Math.min(n, Math.max(2, s.m));
      const an = Math.PI / n, en = Math.PI / m, two = 2 * an;
      const acsx = Math.cos(an), acsy = Math.sin(an);
      const ecsx = Math.cos(en), ecsy = Math.sin(en);
      const lim = r * acsy / ecsy;
      const c0 = Math.cos(-s.a), s0 = Math.sin(-s.a);
      return (px, py) => {
        const dx = px - x, dy = py - y;
        const ux = c0 * dx - s0 * dy, uy = s0 * dx + c0 * dy;
        let bn = Math.atan2(ux, uy) % two;
        if (bn < 0) bn += two;
        bn -= an;
        const L = len(ux, uy);
        let qx = L * Math.cos(bn) - r * acsx;
        let qy = L * Math.abs(Math.sin(bn)) - r * acsy;
        const dot = -(qx * ecsx + qy * ecsy);
        const t = dot < 0 ? 0 : dot > lim ? lim : dot;
        qx += ecsx * t; qy += ecsy * t;
        const d = len(qx, qy);
        return qx < 0 ? -d : d;
      };
    }

    case 'ring': {
      const x = s.x, y = s.y, r = Math.max(1e-5, s.r), ht = Math.max(1e-5, s.th) * 0.5;
      return (px, py) => Math.abs(len(px - x, py - y) - r) - ht;
    }

    // Capsule: distance to a line segment, minus half the thickness.
    case 'seg': {
      const x1 = s.x1, y1 = s.y1;
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const l2 = dx * dx + dy * dy, ht = Math.max(1e-5, s.th) * 0.5;
      return (px, py) => {
        const ax = px - x1, ay = py - y1;
        let t = l2 < 1e-12 ? 0 : (ax * dx + ay * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return len(ax - t * dx, ay - t * dy) - ht;
      };
    }

    case 'arc': {
      const x = s.x, y = s.y, r = Math.max(1e-5, s.r), ht = Math.max(1e-5, s.th) * 0.5;
      const sc = Math.sin(s.ap), cc = Math.cos(s.ap);
      const c0 = Math.cos(-s.a), s0 = Math.sin(-s.a);
      return (px, py) => {
        const dx = px - x, dy = py - y;
        const ux = Math.abs(c0 * dx - s0 * dy), uy = s0 * dx + c0 * dy;
        return (sc * ux > cc * uy ? len(ux - sc * r, uy - cc * r)
                                  : Math.abs(len(ux, uy) - r)) - ht;
      };
    }

    // A drawn curve as a radial profile: the radius at each angle comes from
    // the curve. NOT a true distance field (the gradient is wrong on steep
    // slopes), so it is for fills and single contours, not deep onioning.
    // This is where a drawing becomes geometry.
    case 'pcurve': {
      const x = s.x, y = s.y, r0 = s.r0, dr = s.r1 - s.r0, rot = s.a, cv = s.cv;
      const TAU = Math.PI * 2;
      return (px, py) => {
        const dx = px - x, dy = py - y;
        let t = ((Math.atan2(dy, dx) - rot) / TAU) % 1;
        if (t < 0) t += 1;
        const rad = r0 + dr * curveAt(cv, t);
        return len(dx, dy) - (rad > 1e-4 ? rad : 1e-4);
      };
    }

    // ---- domain transforms: move the SAMPLE POINT by the inverse ----------
    case 'xform': {
      const c = compileSpec(s.c, curveAt);
      const tx = s.tx, ty = s.ty;
      const co = Math.cos(-s.rot), si = Math.sin(-s.rot);
      const sx = Math.abs(s.sx) < 1e-5 ? 1e-5 : s.sx;
      const sy = Math.abs(s.sy) < 1e-5 ? 1e-5 : s.sy;
      const det = 1 - s.kx * s.ky, kx = s.kx, ky = s.ky;
      const flat = Math.abs(det) < 1e-6;
      // Scaling by the SMALLER factor keeps the result a conservative distance
      // (never an overestimate), which is what stops contours from tearing.
      const k = Math.min(Math.abs(sx), Math.abs(sy));
      return (px, py) => {
        const X = px - tx, Y = py - ty;
        const rx = (co * X - si * Y) / sx, ry = (si * X + co * Y) / sy;
        const ux = flat ? rx : ( rx - kx * ry) / det;
        const uy = flat ? ry : (-ky * rx + ry) / det;
        return c(ux, uy) * k;
      };
    }

    // Scanimate's signature move: an x-scale that varies along the other axis.
    case 'squeeze': {
      const c = compileSpec(s.c, curveAt);
      const x = s.x, y = s.y, q = s.q, byY = s.ax === 'y';
      return (px, py) => {
        const X = px - x, Y = py - y;
        const k = 1 + q * (byY ? Y : X);
        const d = Math.abs(k) < 0.05 ? 0.05 : Math.abs(k);
        return byY ? c(X / d, Y) * d : c(X, Y / d) * d;
      };
    }

    case 'repeat': {
      const c = compileSpec(s.c, curveAt);
      const spx = s.px, spy = s.py, nx = s.nx, ny = s.ny;
      const dox = spx >= 1e-4 && nx >= 1, doy = spy >= 1e-4 && ny >= 1;
      return (px, py) => {
        let x = px, y = py;
        if (dox) { const q = Math.round(x / spx); x -= spx * (q < -nx ? -nx : q > nx ? nx : q); }
        if (doy) { const q = Math.round(y / spy); y -= spy * (q < -ny ? -ny : q > ny ? ny : q); }
        return c(x, y);
      };
    }

    case 'mirror': {
      const c = compileSpec(s.c, curveAt);
      const mx = !!s.mx, my = !!s.my;
      return (px, py) => c(mx ? Math.abs(px) : px, my ? Math.abs(py) : py);
    }

    case 'polar': {
      const c = compileSpec(s.c, curveAt);
      const n = Math.max(1, Math.round(s.n)), rot = s.a;
      const step = (Math.PI * 2) / n;
      return (px, py) => {
        const r = len(px, py);
        let a = Math.atan2(py, px) - rot;
        a -= step * Math.round(a / step);
        return c(r * Math.cos(a), r * Math.sin(a));
      };
    }

    case 'twist': {
      const c = compileSpec(s.c, curveAt);
      const k = s.k;
      return (px, py) => {
        const a = -k * len(px, py);
        const co = Math.cos(a), si = Math.sin(a);
        return c(co * px - si * py, si * px + co * py) * 0.9;
      };
    }

    // ---- field arithmetic -------------------------------------------------
    case 'round': {
      const c = compileSpec(s.c, curveAt), r = s.r;
      return (px, py) => c(px, py) - r;
    }
    case 'onion': {
      const c = compileSpec(s.c, curveAt), ht = Math.max(1e-5, s.th) * 0.5;
      return (px, py) => Math.abs(c(px, py)) - ht;
    }

    case 'union': {
      const a = compileSpec(s.a, curveAt), b = compileSpec(s.b, curveAt);
      return (px, py) => Math.min(a(px, py), b(px, py));
    }
    case 'inter': {
      const a = compileSpec(s.a, curveAt), b = compileSpec(s.b, curveAt);
      return (px, py) => Math.max(a(px, py), b(px, py));
    }
    case 'sub': {
      const a = compileSpec(s.a, curveAt), b = compileSpec(s.b, curveAt);
      return (px, py) => Math.max(a(px, py), -b(px, py));
    }
    case 'blend': {
      const a = compileSpec(s.a, curveAt), b = compileSpec(s.b, curveAt), k = s.k;
      return (px, py) => smin(a(px, py), b(px, py), k);
    }
    case 'sblend': {
      const a = compileSpec(s.a, curveAt), b = compileSpec(s.b, curveAt), k = s.k;
      return (px, py) => smax(a(px, py), -b(px, py), k);
    }

    // Lerping two fields tweens the SHAPES, not the pixels. A circle morphs
    // into a star through intermediate forms that belong to neither.
    case 'morph': {
      const a = compileSpec(s.a, curveAt), b = compileSpec(s.b, curveAt);
      const t = Math.min(1, Math.max(0, s.t2));
      return (px, py) => {
        const da = a(px, py), db = b(px, py);
        if (da > 1e8) return db;
        if (db > 1e8) return da;
        return da * (1 - t) + db * t;
      };
    }

    default: return () => FAR;
  }
}

// One-shot evaluation. Compiles, samples once, throws the closure away — so
// this is for tests and single probes, never for a raster loop.
export function evalSpec(s, px, py, curveAt) { return compileSpec(s, curveAt)(px, py); }

// ---------------------------------------------------------------- raster
//
// Evaluate a field over a grid. Half resolution by default: distance fields
// interpolate cleanly, so sampling at 256x160 and bilinearly reading back at
// 512x320 costs a quarter of the work and still gives clean contours. That is
// a property of distance fields specifically — it would band badly on colour.

export function rasterize(spec, W, H, curveAt, buf) {
  const out = buf && buf.length === W * H ? buf : new Float32Array(W * H);
  const f = compileSpec(spec, curveAt);
  let k = 0;
  for (let j = 0; j < H; j++) {
    const fy = ((j + 0.5) / H - 0.5);
    for (let i = 0; i < W; i++, k++) out[k] = f(((i + 0.5) / W - 0.5) * ASPECT, fy);
  }
  return out;
}

// Bilinear read of a rasterized field at normalised raster coords.
export function sampleField(f, W, H, nx, ny) {
  const x = Math.min(W - 1, Math.max(0, nx * W - 0.5));
  const y = Math.min(H - 1, Math.max(0, ny * H - 0.5));
  const i0 = Math.floor(x), j0 = Math.floor(y);
  const i1 = Math.min(W - 1, i0 + 1), j1 = Math.min(H - 1, j0 + 1);
  const fx = x - i0, fy = y - j0;
  const a = f[j0 * W + i0], b = f[j0 * W + i1], c = f[j1 * W + i0], d = f[j1 * W + i1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
