// modulate.js — what a signal does to a letter.
//
// Every glyph is walked through the modulator stack the patch produced, once
// per frame, and comes out with a transform. Pure arithmetic: no DOM, no
// canvas, no state. That is deliberate — it is the part most likely to be
// wrong, so it is the part that has to be testable in isolation.
//
// THE PHASE IDEA. Each modulator reads one coordinate off the glyph and uses
// it as the phase of its effect. Choosing that coordinate is what turns one
// operator into a dozen different behaviours, and it is the only concept you
// need to hold to use the whole typography family.

import { curveAt } from '../m0-telemetry/patch/opkit.js';
import { matches } from '../m0-telemetry/patch/selection.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Stable per-glyph pseudorandom. Hashed from the glyph's identity rather than
// drawn fresh each frame, so scattered text STAYS scattered instead of boiling.
export function hash01(n, seed = 1) {
  let x = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) | 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// The coordinate a modulator rides on.
//
// Units deliberately differ: index/char/word/line are counts, so a phase scale
// of 1 means one radian per letter (a visible wave over about six of them),
// while x/y are 0..1 across the screen, so a scale of 6 is one full cycle.
export function coordOf(g, from, W, H) {
  switch (from) {
    case 'index': return g.i;
    case 'char':  return g.ci;
    case 'word':  return g.wi;
    case 'line':  return g.li;
    case 'x':     return g.x / Math.max(1, W);
    case 'y':     return g.y / Math.max(1, H);
    case 'rand':  return hash01(g.ci) * 10;

    // Semantic sources. These are the whole point of the analysis: once a
    // measure is a phase source, "letters jitter in proportion to the
    // entropy of their sentence" is one operator rather than a special case
    // somewhere in the renderer.
    case 'entropy': return g.sem ? g.sem.entropy : 0;        // 0..~6 bits/char
    case 'depth':   return g.sem ? g.sem.depth : 0;          // how deep in the UI tree
    case 'digits':  return g.sem ? g.sem.digits : 0;         // 0..1
    case 'caps':    return g.sem ? g.sem.caps : 0;           // 0..1
    case 'ttr':     return g.sem ? g.sem.ttr : 1;            // lexical diversity
    case 'words':   return g.sem ? g.sem.words : 0;

    default:      return 0;                     // 'none'
  }
}

function osc(shape, ph) {
  switch (shape) {
    case 'tri':    { const u = ((ph / TAU) % 1 + 1) % 1; return 1 - 4 * Math.abs(u - 0.5); }
    case 'square': return Math.sin(ph) >= 0 ? 1 : -1;
    case 'bounce': return Math.abs(Math.sin(ph));
    default:       return Math.sin(ph);
  }
}

// A modulator with no phase source and no rate is a CONSTANT, not a zero.
// Without this, `from: none` plus `rate: 0` would silently do nothing, which
// is the single most confusing thing a patcher can do.
const steady = (from, f) => from === 'none' && f === 0;

export function identity() {
  return { dx:0, dy:0, rot:0, sx:1, sy:1, weight:0, slant:0,
           alpha:1, hue:0, colour:null };
}

// g: a laid-out glyph. stack: the modulators from the patch, in order.
// Returns a fresh transform; pass `out` to reuse one and allocate nothing.
export function applyStack(g, stack, t, W, H, out) {
  const o = out || identity();
  if (out) {
    o.dx = 0; o.dy = 0; o.rot = 0; o.sx = 1; o.sy = 1;
    o.weight = 0; o.slant = 0; o.alpha = 1; o.hue = 0; o.colour = null;
  }
  if (!stack || !stack.length) return o;

  let tl = t;                        // local time, shifted by cascade
  for (const m of stack) {
    // A wired selection wins outright. Without one, the effect falls back to
    // its own dropdown, which matches either the element's ROLE kind (menu,
    // title, body...) or its SEMANTIC class (path, number, url, sentence...).
    if (m.match) { if (!matches(m.match, g)) continue; }
    else if (m.target && m.target !== 'all' && m.target !== g.kind
             && !(g.sem && m.target === g.sem.kind)) continue;
    const coord = coordOf(g, m.from, W, H);

    switch (m.op) {

      case 'cascade':
        tl = t + m.d * coord * m.scale;
        break;

      case 'wave': {
        const ph = coord * m.scale + tl * m.f * TAU;
        const v = osc(m.shape, ph) * m.amp;
        if (m.axis === 'y' || m.axis === 'both') o.dy += v;
        if (m.axis === 'x' || m.axis === 'both') o.dx += v;
        break;
      }

      case 'jitter': {
        // Re-seeding on a clock lets jitter step rather than sit still, while
        // staying stable between steps.
        const bucket = m.rate > 0 ? Math.floor(tl * m.rate) : 0;
        const s = (g.ci * 7919 + bucket * 104729) | 0;
        o.dx  += (hash01(s,     m.seed) - 0.5) * 2 * m.amt;
        o.dy  += (hash01(s + 1, m.seed) - 0.5) * 2 * m.amt;
        o.rot += (hash01(s + 2, m.seed) - 0.5) * 2 * m.rot * DEG;
        break;
      }

      case 'rotate': {
        const ph = coord * m.scale + tl * m.f * TAU;
        let v;
        if (m.mode === 'uniform')        v = m.a;
        else if (m.mode === 'alternate') v = (g.ci % 2 ? 1 : -1) * m.a;
        else if (m.mode === 'ramp')      v = m.a * coord * m.scale;
        else                             v = m.a * Math.sin(ph);
        o.rot += v * DEG;
        break;
      }

      case 'scale': {
        const ph = coord * m.scale + tl * m.f * TAU;
        let k = m.base + m.s * (steady(m.from, m.f) ? 1 : Math.sin(ph));
        // Legibility floor. Clamped on the glyph's OWN size, so the same
        // setting keeps an 11pt label and a 28pt heading both readable
        // while still letting either grow without limit.
        if (m.minpx > 0 && g.size > 0) k = Math.max(k, m.minpx / g.size);
        if (m.axis === 'x') o.sx *= k;
        else if (m.axis === 'y') o.sy *= k;
        else { o.sx *= k; o.sy *= k; }
        break;
      }

      case 'axes': {
        const ph = coord * m.scale + tl * m.f * TAU;
        const k = steady(m.from, m.f) ? 1 : Math.sin(ph);
        o.weight += m.w * k;
        o.sx     *= 1 + m.d * k;
        o.slant  += m.sl * k * DEG;
        break;
      }

      case 'baseline': {
        const span = m.span === 'word'   ? { a: g.wx, l: g.ww }
                   : m.span === 'screen' ? { a: 0,    l: W }
                   :                       { a: g.lx, l: g.lw };
        let u = span.l > 1e-6 ? (g.x - span.a) / span.l : 0;
        u = Math.min(1, Math.max(0, u + m.sh));
        // centred on 0.5, and negative because screen y grows downward: a
        // drawn hump should read as a rise.
        o.dy -= (curveAt(m.cv, u) - 0.5) * m.amt;
        break;
      }

      case 'scatter': {
        if (m.amt === 0) break;
        const ox = m.origin === 'word'   ? g.wx + g.ww * 0.5
                 : m.origin === 'line'   ? g.lx + g.lw * 0.5
                 : m.origin === 'point'  ? m.px * W
                 :                         W * 0.5;
        const oy = m.origin === 'word'   ? g.wy
                 : m.origin === 'line'   ? g.ly
                 : m.origin === 'point'  ? m.py * H
                 :                         H * 0.5;
        const vx = g.x - ox, vy = g.y - oy;
        const ang = m.swirl * DEG * m.amt;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const rx = vx * ca - vy * sa, ry = vx * sa + vy * ca;
        o.dx += rx * (1 + m.amt) - vx;
        o.dy += ry * (1 + m.amt) - vy;
        break;
      }

      case 'colour': {
        const ph = coord * m.scale + tl * m.f * TAU;
        o.hue   += m.h * (steady(m.from, m.f) ? 1 : Math.sin(ph));
        o.alpha *= m.a;
        if (m.base) o.colour = m.base;
        break;
      }
    }
  }
  return o;
}

// Tracking and leading change LAYOUT, not the post-transform, so the layout
// pass pulls them out of the stack before anything is positioned.
export function spacingFor(stack, kind) {
  let track = 0, lead = 1, grow = 'none';
  if (!stack) return { track, lead, grow };
  for (const m of stack) {
    if (m.op !== 'spacing') continue;
    if (m.target && m.target !== 'all' && m.target !== kind) continue;
    track += m.t;
    lead  *= m.l;
    if (m.grow !== 'none') grow = m.grow;
  }
  return { track, lead, grow };
}

// ---------------------------------------------------------------- surfaces
//
// The same stack idea applied to windows, icons and the menu bar. A surface
// transform wraps everything tagged with that surface, so a rotated window
// carries its title and its text, and the typography stack then runs inside
// that rotated space.

export function surfCoord(s, from, W, H) {
  switch (from) {
    case 'index': return s.kindIndex;
    case 'x':     return s.cx / Math.max(1, W);
    case 'y':     return s.cy / Math.max(1, H);
    case 'rand':  return hash01(s.i * 7919) * 10;
    default:      return 0;                     // 'none'
  }
}

export function surfIdentity() {
  return { dx:0, dy:0, rot:0, sx:1, sy:1, kx:0, ky:0 };
}

export function applySurfaceStack(s, stack, t, W, H, out) {
  const o = out || surfIdentity();
  o.dx = 0; o.dy = 0; o.rot = 0; o.sx = 1; o.sy = 1; o.kx = 0; o.ky = 0;
  if (!stack || !stack.length) return o;

  // Position moves accumulate here first: spiral, ring and gravity all act on
  // where a surface IS, and composing them as displacements keeps them
  // commutative and keeps the pivot honest.
  let px = s.cx, py = s.cy;

  for (const m of stack) {
    if (m.match) { if (!matches(m.match, s)) continue; }
    else if (m.target && m.target !== 'all' && m.target !== s.kind) continue;
    const coord = surfCoord(s, m.from, W, H);

    switch (m.op) {
      case 'move': {
        const ph = coord * m.scale + t * m.f * TAU;
        const v = osc(m.shape, ph) * m.amp;
        if (m.axis === 'y' || m.axis === 'both') o.dy += v;
        if (m.axis === 'x' || m.axis === 'both') o.dx += v;
        break;
      }

      case 'rotate': {
        const ph = coord * m.scale + t * m.f * TAU;
        let v;
        if (m.mode === 'uniform')        v = m.a;
        else if (m.mode === 'alternate') v = (s.i % 2 ? 1 : -1) * m.a;
        else if (m.mode === 'ramp')      v = m.a * coord * m.scale;
        else                             v = m.a * Math.sin(ph);
        o.rot += v * DEG;
        break;
      }

      case 'scale': {
        const ph = coord * m.scale + t * m.f * TAU;
        const k = m.base + m.s * (steady(m.from, m.f) ? 1 : Math.sin(ph));
        if (m.axis === 'x') o.sx *= k;
        else if (m.axis === 'y') o.sy *= k;
        else { o.sx *= k; o.sy *= k; }
        break;
      }

      case 'tilt': {
        const ph = coord * m.scale + t * m.f * TAU;
        const k = steady(m.from, m.f) ? 1 : Math.sin(ph);
        o.kx += m.kx * k;
        o.ky += m.ky * k;
        break;
      }

      // Rotates a surface's POSITION about a point by an amount proportional
      // to its distance from it: the desktop winds up. Distinct from rotate,
      // which turns each surface where it stands.
      case 'spiral': {
        const ox = m.px * W, oy = m.py * H;
        const vx = px - ox, vy = py - oy;
        const r = Math.hypot(vx, vy);
        const maxR = Math.hypot(W, H) * 0.5 || 1;
        const a = m.k * TAU * (r / maxR);
        const ca = Math.cos(a), sa = Math.sin(a);
        const k = 1 - m.pull * (r / maxR);
        px = ox + (vx * ca - vy * sa) * k;
        py = oy + (vx * sa + vy * ca) * k;
        break;
      }

      // Lerps toward a position on a circle. At 0 the desktop is exactly as
      // laid out; at 1 it is a dial; between is a real arrangement.
      case 'ring': {
        const amt = Math.min(1, Math.max(0, m.amt));
        if (amt <= 0) break;
        const ox = m.px * W, oy = m.py * H;
        const n = Math.max(1, s.ofKind);
        const a = (s.kindIndex / n) * TAU + m.a * TAU;
        const rad = m.r * Math.min(W, H);
        px += (ox + Math.cos(a) * rad - px) * amt;
        py += (oy + Math.sin(a) * rad - py) * amt;
        break;
      }

      case 'drift': {
        const bucket = m.rate > 0 ? Math.floor(t * m.rate) : 0;
        const q = (s.i * 7919 + bucket * 104729) | 0;
        o.dx  += (hash01(q,     m.seed) - 0.5) * 2 * m.amt;
        o.dy  += (hash01(q + 1, m.seed) - 0.5) * 2 * m.amt;
        o.rot += (hash01(q + 2, m.seed) - 0.5) * 2 * m.rot * DEG;
        break;
      }

      case 'gravity': {
        if (m.g === 0) break;
        const ox = m.px * W, oy = m.py * H;
        const vx = ox - px, vy = oy - py;
        const r = Math.hypot(vx, vy) || 1;
        const maxR = Math.hypot(W, H) * 0.5 || 1;
        const fall = m.falloff === 'inverse'  ? maxR / (r + maxR * 0.25)
                   : m.falloff === 'constant' ? 1
                   :                            r / maxR;
        px += (vx / r) * m.g * fall * maxR * 0.5;
        py += (vy / r) * m.g * fall * maxR * 0.5;
        break;
      }
    }
  }
  o.dx += px - s.cx;
  o.dy += py - s.cy;
  return o;
}
