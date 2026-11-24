// shapes.js — puts shapes into the signal chain.
//
// A shape is a distance field, and this is where it becomes luminance. Two
// routes, chosen per shape in the patcher:
//
//   scanned  written into the 512x320 source raster, so the shape is then
//            deflected by the scan processor, coloured by the colouriser and
//            smeared by the feedback loop like everything else. This is what
//            Scanimate did to its artwork, and it is the default.
//   raw      composited crisp over the finished frame, like titles over video.
//            Legible, exact, and outside the chain.
//
// WHY WRITE LUMINANCE AND NOT COLOUR. The scan processor reads two things out
// of this raster: luma for deflection height, and the red-versus-blue ratio
// for the colour key. So a shape has to encode its brightness and its chroma
// the same way a bus does -- by sitting somewhere on the cyan-to-amber axis --
// or the colouriser would treat it as a different kind of object.
//
// The field is evaluated at a fraction of the raster's resolution and read back
// bilinearly. Distance fields tolerate that: the reconstructed zero crossing
// moves by well under one raster cell (test-shapes.mjs measures it), which
// would not be true of a colour or a luminance image.

import { rasterize, sampleField, ASPECT } from '../patch/sdf.js';
import { curveAt } from '../patch/opkit.js';
import { CYAN, AMBER, SW as DEF_W, SH as DEF_H } from './source.js';

// The field space in sdf.js assumes this. If the raster is ever reshaped,
// shapes would quietly stretch, so fail loudly at load instead.
if (Math.abs(DEF_W / DEF_H - ASPECT) > 1e-9) {
  throw new Error(`shape aspect mismatch: raster is ${DEF_W}x${DEF_H} `
                + `(${(DEF_W/DEF_H).toFixed(4)}) but sdf.ASPECT is ${ASPECT}. `
                + `Update ASPECT in patch/sdf.js.`);
}

const RES = { low: [128, 80], med: [192, 120], high: [256, 160] };

export class ShapeLayer {
  // Defaults to the Computing Visualizer's raster; the Psychedelic OS passes
  // its own. Any size works as long as the aspect matches sdf.ASPECT, since
  // shapes live in an aspect-corrected field space.
  constructor(SW = DEF_W, SH = DEF_H) {
    if (Math.abs(SW / SH - ASPECT) > 1e-6) {
      throw new Error(`ShapeLayer: ${SW}x${SH} has aspect ${(SW/SH).toFixed(4)}, `
                    + `but shapes are defined for ${ASPECT}`);
    }
    this.SW = SW; this.SH = SH;
    this.pool = new Map();          // field buffers, keyed by resolution
    this.raw = document.createElement('canvas');
    this.raw.width = SW; this.raw.height = SH;
    this.rawCtx = this.raw.getContext('2d');
    this.rawImg = this.rawCtx.createImageData(SW, SH);
    this.count = 0;                 // shapes drawn last frame, for the readout
    this.ms = 0;
  }

  _field(spec, res) {
    const [w, h] = RES[res] || RES.med;
    const key = w + 'x' + h;
    let buf = this.pool.get(key);
    if (!buf) { buf = new Float32Array(w * h); this.pool.set(key, buf); }
    rasterize(spec, w, h, curveAt, buf);
    return { f: buf, w, h };
  }

  // How far from the zero level this shape can still put ink. Everything
  // beyond it is skipped after a single sample, which is what keeps the
  // composite loop cheap when a shape covers a small part of the frame.
  _reach(s) {
    return s.kind === 'contour'
      ? s.lvl + (s.rings - 1) * s.sp + s.wid
      : s.lvl + s.soft;
  }

  // Coverage of this shape at field distance d: 0 is no ink, 1 is full.
  _cov(s, d) {
    if (s.kind === 'contour') {
      let acc = 0;
      const last = Math.max(1, s.rings - 1);
      for (let r = 0; r < s.rings; r++) {
        const e = Math.abs(d - (s.lvl + r * s.sp));
        if (e >= s.wid) continue;
        acc += (1 - e / s.wid) * (1 - s.fall * (r / last));
      }
      return acc > 1 ? 1 : acc;
    }
    const t = (s.lvl + s.soft - d) / (2 * s.soft);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  // Additively write one shape's ink into an RGBA byte array.
  _composite(data, s) {
    const { f, w, h } = this._field(s.spec, s.res);
    const reach = this._reach(s);
    const warm = s.warm < 0 ? 0 : s.warm > 1 ? 1 : s.warm;
    const cr = CYAN[0] + (AMBER[0] - CYAN[0]) * warm;
    const cg = CYAN[1] + (AMBER[1] - CYAN[1]) * warm;
    const cb = CYAN[2] + (AMBER[2] - CYAN[2]) * warm;
    const max = s.blend === 'max';
    let k = 0;
    for (let j = 0; j < this.SH; j++) {
      const ny = (j + 0.5) / this.SH;
      for (let i = 0; i < this.SW; i++, k += 4) {
        const d = sampleField(f, w, h, (i + 0.5) / this.SW, ny);
        if (d > reach) continue;                       // the common case
        const cov = this._cov(s, d);
        if (cov <= 0) continue;
        const g = cov * s.luma;
        const r = cr * g, gg = cg * g, b = cb * g;
        if (max) {
          if (r  > data[k])     data[k]     = r;
          if (gg > data[k + 1]) data[k + 1] = gg;
          if (b  > data[k + 2]) data[k + 2] = b;
        } else {
          const nr = data[k] + r, ng = data[k + 1] + gg, nb = data[k + 2] + b;
          data[k]     = nr > 255 ? 255 : nr;
          data[k + 1] = ng > 255 ? 255 : ng;
          data[k + 2] = nb > 255 ? 255 : nb;
        }
        data[k + 3] = 255;
      }
    }
  }

  // Scanned shapes, written into the source raster before the scan processor
  // sees it. Mutates `img` in place.
  applyToRaster(img, list) {
    const t0 = performance.now();
    this.count = 0;
    if (!list || !list.length) { this.ms = 0; return img; }
    for (const s of list) {
      if (s.route !== 'scanned') continue;
      this._composite(img.data, s);
      this.count++;
    }
    this.ms = performance.now() - t0;
    return img;
  }

  // Raw shapes, drawn crisp over the finished frame. Rasterized at raster
  // resolution and blitted up with smoothing, so this costs the same as a
  // scanned shape rather than scaling with the display.
  drawRaw(ctx, W, H, list, colorizer, key) {
    if (!list || !list.length) return 0;
    const raws = list.filter(s => s.route === 'raw');
    if (!raws.length) return 0;

    const d = this.rawImg.data;
    d.fill(0);
    for (const s of raws) this._composite(d, s);

    // Run the same colouriser over it, so a raw shape and a scanned one of the
    // same brightness come out the same colour.
    for (let k = 0; k < d.length; k += 4) {
      const r = d[k], g = d[k + 1], b = d[k + 2];
      if (!r && !g && !b) { d[k + 3] = 0; continue; }
      const luma = (r * 0.3 + g * 0.5 + b * 0.2) / 255;
      const warm = r / (r + b + 1);
      const c = colorizer.map(luma, warm, key);
      d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2];
      d[k + 3] = Math.min(255, c[3] * 255);
    }
    this.rawCtx.putImageData(this.rawImg, 0, 0);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.raw, 0, 0, W, H);
    ctx.imageSmoothingEnabled = prev;
    return raws.length;
  }
}
