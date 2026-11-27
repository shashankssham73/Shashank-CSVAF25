// imagegraph.js — runs an image spec tree.
//
// The patcher produces a DESCRIPTION of a picture: plain nested objects, no
// pixels, cheap to evaluate and testable in Node. This is the other half —
// the thing that walks that description once per frame and actually makes
// the image.
//
// Every stage reuses the machinery the fixed pipeline already had, so a
// patched chain and the built-in one do exactly the same arithmetic. What is
// new is that the order, the branching and which stages run at all are now
// yours.
//
// Two stages remember things between frames — feedback and chemistry — so
// each spec node carries the id of the block that made it, and their state
// is kept under that id. Two feedback blocks therefore have two buffers
// rather than fighting over one, and rewiring a patch does not hand a block
// somebody else's history.

import { ReactionDiffusion } from '../m0-telemetry/viz/rd.js';
import { P } from '../m0-telemetry/viz/palette.js';

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

export class ImageGraph {
  constructor(chain) {
    this.chain = chain;
    this.w = chain.w; this.h = chain.h;
    this.pool = [];
    this.state = new Map();      // node id -> { fbCanvas } | { rd }
    this.seen = new Set();
    this.ms = 0;
    this.nodes = 0;
    // Safari only gained 2D-context filters recently; without it the blur
    // falls back to a downscale/upscale, which is cruder but never absent.
    const probe = document.createElement('canvas').getContext('2d');
    this.hasFilter = typeof probe.filter === 'string';
  }

  // ---- a small pool, because a branching chain allocates several canvases
  // per frame and a new one each time would churn memory for no reason.
  take() {
    const c = this.pool.pop() || document.createElement('canvas');
    if (c.width !== this.w || c.height !== this.h) { c.width = this.w; c.height = this.h; }
    const g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if (this.hasFilter) g.filter = 'none';
    g.clearRect(0, 0, this.w, this.h);
    return c;
  }
  give(c) { if (c && this.pool.length < 8) this.pool.push(c); }

  // ---- the walk ------------------------------------------------------
  // Returns a canvas the caller owns and must hand back with give().
  node(s, draw, t) {
    if (!s || typeof s !== 'object') return this.take();
    this.nodes++;
    if (s.id) this.seen.add(s.id);
    switch (s.t) {
      case 'source':   return this.nSource(draw);
      case 'black':    return this.take();
      case 'blur':     return this.nBlur(s, draw, t);
      case 'levels':   return this.nLevels(s, draw, t);
      case 'colour':   return this.nColour(s, draw, t);
      case 'blend':    return this.nBlend(s, draw, t);
      case 'scan':     return this.nScan(s, draw, t);
      case 'feedback': return this.nFeedback(s, draw, t);
      case 'rd':       return this.nRD(s, draw, t);
      default:         return this.nSource(draw);
    }
  }

  nSource(draw) {
    const c = this.take();
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.w, this.h);
    draw(g, this.w, this.h);
    return c;
  }

  nBlur(s, draw, t) {
    const a = this.node(s.a, draw, t);
    if (!(s.r > 0.2)) return a;
    const c = this.take();
    const g = c.getContext('2d');
    if (this.hasFilter) {
      g.filter = `blur(${Math.min(80, s.r)}px)`;
      g.drawImage(a, 0, 0);
      g.filter = 'none';
    } else {
      // Downscale and back up: a box blur by another name, and the only
      // blur available when the context has no filter property.
      const k = Math.max(1, Math.min(16, Math.round(s.r / 2)));
      const tw = Math.max(1, Math.round(this.w / k)), th = Math.max(1, Math.round(this.h / k));
      const tmp = this.take();
      const tg = tmp.getContext('2d');
      tg.drawImage(a, 0, 0, tw, th);
      g.imageSmoothingEnabled = true;
      g.drawImage(tmp, 0, 0, tw, th, 0, 0, this.w, this.h);
      this.give(tmp);
    }
    this.give(a);
    return c;
  }

  nLevels(s, draw, t) {
    const a = this.node(s.a, draw, t);
    const g = a.getContext('2d');
    const img = g.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    const gain = s.gain, bias = s.bias * 255, floor = s.floor * 255;
    // A lookup table, because the same curve is applied 2.6 million times
    // and pow() per channel per pixel is the one thing that would make this
    // stage too slow to use.
    const lut = new Uint8ClampedArray(256);
    const ig = 1 / Math.max(0.01, s.gamma);
    for (let v = 0; v < 256; v++) {
      let x = v * gain + bias;
      x = x < floor ? 0 : x;
      x = 255 * Math.pow(clamp01(x / 255), ig);
      lut[v] = x;
    }
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i+1] = lut[d[i+1]]; d[i+2] = lut[d[i+2]];
    }
    g.putImageData(img, 0, 0);
    return a;
  }

  nColour(s, draw, t) {
    const a = this.node(s.a, draw, t);
    if (s.amt <= 0.002) return a;
    const col = this.chain.scan.col;
    const g = a.getContext('2d');
    const img = g.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    const amt = s.amt, key = s.key;
    // map() returns [r,g,b,a] in a reused buffer. The alpha is not decoration:
    // it carries the keying, falling away as brightness does. Ignoring it
    // would paint the ramp's darkest colour across every black pixel and
    // leave a flat wash over the whole frame instead of a lit image.
    for (let i = 0; i < d.length; i += 4) {
      const luma = (d[i] * 0.3 + d[i+1] * 0.5 + d[i+2] * 0.2) / 255;
      const c = col.map(luma, 0, key);
      const a = c[3] === undefined ? 1 : c[3];
      const r = c[0] * a, gg = c[1] * a, b = c[2] * a;   // composited over black
      d[i]   = d[i]   + (r  - d[i])   * amt;
      d[i+1] = d[i+1] + (gg - d[i+1]) * amt;
      d[i+2] = d[i+2] + (b  - d[i+2]) * amt;
    }
    g.putImageData(img, 0, 0);
    return a;
  }

  nBlend(s, draw, t) {
    const a = this.node(s.a, draw, t);
    const b = this.node(s.b, draw, t);
    const g = a.getContext('2d');
    const MODE = { mix:'source-over', add:'lighter', multiply:'multiply',
                   screen:'screen', difference:'difference' };
    g.globalCompositeOperation = MODE[s.mode] || 'source-over';
    g.globalAlpha = s.mode === 'mix' ? s.k : Math.max(0, Math.min(1, s.k));
    g.drawImage(b, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    this.give(b);
    return a;
  }

  nScan(s, draw, t) {
    const a = this.node(s.a, draw, t);
    const img = a.getContext('2d').getImageData(0, 0, this.w, this.h);
    const sc = this.chain.scan;
    // Save and restore: the built-in pipeline configures the same object
    // from the scalar destinations, and a patched chain must not leave its
    // settings behind for it.
    const keep = { amp:sc.amp, persp:sc.persp, key:sc.key,
                   rowStep:sc.rowStep, refDensity:sc.refDensity };
    sc.amp = s.amp; sc.persp = s.persp; sc.key = s.key;
    sc.rowStep = Math.max(1, s.rowStep); sc.refDensity = s.density;
    const c = this.take();
    sc.render(c.getContext('2d'), img, this.w, this.h, P);
    Object.assign(sc, keep);
    this.give(a);
    return c;
  }

  nFeedback(s, draw, t) {
    const st = this.st(s.id, () => ({ buf: null }));
    if (!st.buf) {
      st.buf = document.createElement('canvas');
      st.buf.width = this.w; st.buf.height = this.h;
    }
    const a = this.node(s.a, draw, t);
    const out = this.take();
    const g = out.getContext('2d');
    // Last frame, zoomed and turned about the centre, at `gain`.
    g.save();
    g.globalAlpha = s.gain;
    g.translate(this.w / 2, this.h / 2);
    g.rotate(s.rot);
    g.scale(s.zoom, s.zoom);
    g.translate(-this.w / 2, -this.h / 2);
    g.drawImage(st.buf, 0, 0);
    g.restore();
    g.drawImage(a, 0, 0);
    this.give(a);
    const bg = st.buf.getContext('2d');
    bg.clearRect(0, 0, this.w, this.h);
    bg.drawImage(out, 0, 0);
    return out;
  }

  nRD(s, draw, t) {
    const st = this.st(s.id, () => ({ rd: new ReactionDiffusion(this.w, this.h) }));
    const a = this.node(s.a, draw, t);
    if (!st.rd.ok) return a;                 // no WebGL2: pass the picture through
    const img = a.getContext('2d').getImageData(0, 0, this.w, this.h);
    st.rd.seed(img);
    st.rd.step({ F:s.feed, k:s.kill, Du:1, Dv:s.diffV, dt:1,
                 iters:s.iters, inject:s.inject, decay:0 });
    st.rd.render(this.chain.scan.col, s.gain, 0, this.chain.scan.key, s.floor);
    const c = this.take();
    c.getContext('2d').drawImage(st.rd.canvas, 0, 0, this.w, this.h);
    this.give(a);
    return c;
  }

  st(id, make) {
    let s = this.state.get(id);
    if (!s) { s = make(); this.state.set(id, s); }
    return s;
  }

  // ---- one frame -------------------------------------------------------
  // draw(ctx, w, h) paints the source. Returns the finished canvas, or null
  // if the tree produced nothing.
  render(spec, draw, t) {
    const t0 = performance.now();
    this.nodes = 0;
    this.seen.clear();
    const out = this.node(spec, draw, t);
    // Blocks that are no longer in the tree have been deleted or rewired;
    // their buffers would otherwise be held for the life of the page.
    for (const id of [...this.state.keys()]) if (!this.seen.has(id)) this.state.delete(id);
    this.ms = performance.now() - t0;
    return out;
  }
}
