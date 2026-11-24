// tilelayer.js — the screen, broken into things you can address.
//
// A reader turns the screen into UNITS: tiles on a grid, or regions found by
// merging tiles that look alike. This renders them.
//
// The trick is that a unit is drawn as a PATCH OF THE SOURCE IMAGE, not as a
// coloured rectangle. Each tile knows where it came from, so moving a tile
// moves that piece of your screen. Nothing is approximated and nothing is
// redrawn — the pixels are the real ones, cut up and transported.
//
//   source frame  --> measured into units --> each unit drawn, transformed
//
// Which means the layout operators work on tiles with no changes: a unit has
// a centre, an index and a kind, which is everything applySurfaceStack asks
// for. Rotate targeting tiles shatters the screen into turning squares;
// Gravity targeting tiles collapses it into a pile. The effects already
// existed; the readers are what made the screen addressable by them.

import { gridUnits, regionUnits } from './readers.js';

export class TileLayer {
  // TWO canvases, and the split matters.
  //
  // Measuring a tile's brightness does not need resolution — a mean over a
  // few hundred samples is the same answer at 512 wide as at 4096, and
  // getImageData on a large canvas is genuinely slow. Drawing a tile DOES
  // need resolution, because it is a piece of the real screen and anything
  // less makes the untransformed image softer than it has any reason to be.
  //
  // So: measure small, draw large. Source rectangles are normalised, so a
  // unit is not pinned to the resolution it was measured at.
  constructor(w = 512, h = 320) {
    this.w = w; this.h = h;                       // measuring space
    this.cv = document.createElement('canvas');
    this.cv.width = w; this.cv.height = h;
    this.ctx = this.cv.getContext('2d', { willReadFrequently: true });

    this.src = document.createElement('canvas');  // drawing space
    this.srcCtx = this.src.getContext('2d');
    this.srcW = 0; this.srcH = 0;
    this.maxSrc = 2400;                           // cap, for very large displays

    this.units = [];
    this.img = null;
    this.ms = 0;
    this.drawn = 0;
  }

  // Render the source once, then measure it. One pass serves both the
  // measurement and the drawing, because the drawing cuts from this canvas.
  sample(draw, specs, outW = 0, outH = 0) {
    const t0 = performance.now();
    this.units = [];
    const wants = (specs || []).filter(s => s.kind === 'grid' || s.kind === 'regions');
    if (!wants.length) { this.img = null; this.ms = 0; return this.units; }

    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    draw(c, this.w, this.h);
    this.img = c.getImageData(0, 0, this.w, this.h);

    // the drawing copy, at output resolution so an untransformed tile is
    // indistinguishable from the frame it came from
    const sw = Math.min(this.maxSrc, Math.max(this.w, Math.round(outW || this.w)));
    const sh = Math.max(1, Math.round(sw * (this.h / this.w)));
    if (sw !== this.srcW || sh !== this.srcH) {
      this.src.width = this.srcW = sw;
      this.src.height = this.srcH = sh;
    }
    const s = this.srcCtx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, sw, sh);
    draw(s, sw, sh);

    for (const s of wants) {
      const got = s.kind === 'grid'
        ? gridUnits(this.img, this.w, this.h, s)
        : regionUnits(this.img, this.w, this.h, s);
      for (const u of got) this.units.push(u);
    }
    // Renumber across all readers so an operator distributing by index sees
    // one continuous run rather than restarting per reader.
    const byKind = {};
    this.units.forEach((u, k) => {
      u.i = k;
      u.kindIndex = byKind[u.kind] = (byKind[u.kind] ?? -1) + 1;
    });
    for (const u of this.units) u.ofKind = byKind[u.kind] + 1;

    this.ms = performance.now() - t0;
    return this.units;
  }

  // xf(unit) -> { dx, dy, rot, sx, sy, kx, ky } or null.
  // Units are drawn in area order, largest first, so a big region cannot
  // cover the small ones that sit on top of it.
  draw(ctx, W, H, xf, opts = {}) {
    this.drawn = 0;
    if (!this.units.length || !this.img) return 0;
    const kx = W / this.w, ky = H / this.h;
    const gap = opts.gap || 0;
    const order = this.units.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h));

    for (const u of order) {
      if (!u.src) continue;
      const o = xf ? xf(u) : null;
      const dx = (o ? o.dx : 0) * kx, dy = (o ? o.dy : 0) * ky;
      const cx = u.cx * kx, cy = u.cy * ky;
      ctx.save();
      if (o) {
        ctx.translate(cx + dx, cy + dy);
        if (o.rot) ctx.rotate(o.rot);
        if (o.kx || o.ky) ctx.transform(1, o.ky, o.kx, 1, 0, 0);
        if (o.sx !== 1 || o.sy !== 1) ctx.scale(o.sx, o.sy);
        ctx.translate(-cx, -cy);
      }
      // A half-pixel bleed, because adjacent tiles drawn at fractional
      // positions otherwise show a seam of background between them.
      const g = gap;
      ctx.drawImage(this.src,
        u.src.x * this.srcW, u.src.y * this.srcH,
        Math.max(1, u.src.w * this.srcW), Math.max(1, u.src.h * this.srcH),
        u.x * kx + g, u.y * ky + g,
        Math.max(0.5, u.w * kx - g * 2), Math.max(0.5, u.h * ky - g * 2));
      ctx.restore();
      this.drawn++;
    }
    return this.drawn;
  }

  // A quick legend for the readout: how many of each kind were found.
  get summary() {
    if (!this.units.length) return '';
    const n = {};
    for (const u of this.units) n[u.kind] = (n[u.kind] || 0) + 1;
    return Object.entries(n).map(([k, v]) => `${v} ${k}${v > 1 ? 's' : ''}`).join(' · ');
  }
}
