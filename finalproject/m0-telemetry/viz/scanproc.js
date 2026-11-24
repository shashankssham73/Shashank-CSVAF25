// Rutt/Etra scan processor.
//
// The original (Steve Rutt and Bill Etra, 1972) took a video signal and used
// its luminance to deflect the electron beam of a display vertically, turning
// a flat raster into relief. Each horizontal scanline keeps its identity and
// bends. That is all this does, in software:
//
//   screen_y(x, row) = baseline(row) - luma(x, row) * amplitude
//
// Three things make it read as a video synthesiser rather than a 3-D plot:
//   - scanlines stay visibly separate; the gaps between them are the look
//   - brightness is per-segment, so a line fades in and out along its length
//   - the colouriser is a hard key, not a gradient: a sample is on one side
//     of the threshold or the other, which is what analogue keyers did
//
// Perspective is optional and cheap: rows are spaced by a power curve and
// narrowed toward the back, so the past recedes.

import { Colorizer } from './colorizer.js';

export class ScanProcessor {
  constructor() {
    this.amp      = 46;      // deflection, px at display scale
    this.persp    = 0.55;    // 0 = flat scanlines, 1 = deep terrain
    this.rowStep  = 3;       // source rows skipped; fewer rows = more separation
    this.colStep  = 4;       // horizontal sampling
    this.segLen   = 8;       // samples per stroked segment (brightness unit)
    this.key      = 0.42;    // colouriser threshold on the warm/cool ratio
    this.floor    = 0.035;   // below this luma nothing is drawn at all
    this.skew     = 0;       // horizontal tear, driven by fault events
    this.gainR    = 1;       // colouriser drive
    this.img      = null;
    this.W = 0; this.H = 0;
    // Source raster dimensions, taken from whatever ImageData it is handed.
    // The Computing Visualizer feeds it a 512x320 machine map; the Psychedelic
    // OS feeds it a 1024x640 desktop. Nothing here should care which.
    this.sw = 0; this.sh = 0;
    // The colouriser on the end of the chain. It starts in legacy mode, which
    // reproduces the original two-colour key exactly, and main.js reconfigures
    // it from the patch each frame.
    this.col      = new Colorizer();

    // SOURCE DENSITY COMPENSATION.
    //
    // This processor was designed for a sparse source: the machine map is
    // mostly black, so only a few segments per scanline clear `floor` and
    // get stroked. Point it at a photographic source — a screen capture —
    // and every pixel has luminance, so every row strokes across the full
    // width, the additive feedback accumulates, and the frame washes out to
    // flat grey. Measured: 7.6x brighter than the sparse case.
    //
    // So the stroke opacity is scaled by how dense the source actually is,
    // normalised against the density this was tuned for. A sparse source is
    // left alone (gain ~1); a dense one is pulled back automatically. The
    // alternative — making the user find and re-tune five parameters per
    // source — is not a reasonable default.
    this.autoGain   = true;
    this.refDensity = 0.055;   // mean luma of the machine map, the design point
    this.srcMean    = 0;
    this.srcGain    = 1;
  }

  // Where a point in normalised source space lands on screen after deflection.
  // The FUI uses this so readouts ride the same field as the image.
  deflectAt(nx, ny) {
    const { W, H, sw, sh } = this;
    if (!sw || !sh) return { x: W * nx, y: H * ny, luma: 0, xs: 1 };
    const t = this._rowT(ny);
    const xs = this._xScale(ny);
    const x = W / 2 + (nx - 0.5) * W * xs + this.skew * (1 - ny) * 40;
    let luma = 0;
    if (this.img) {
      const sx = Math.max(0, Math.min(sw - 1, Math.round(nx * sw)));
      const sy = Math.max(0, Math.min(sh - 1, Math.round(ny * sh)));
      const i = (sy * sw + sx) * 4;
      const d = this.img.data;
      luma = (d[i] * 0.3 + d[i + 1] * 0.5 + d[i + 2] * 0.2) / 255;
    }
    return { x, y: this._baseY(t) - luma * this.amp * xs, luma, xs };
  }

  _rowT(ny) { return Math.pow(ny, 1 + this.persp * 0.8); }
  _baseY(t) { return this.H * (0.12 + t * 0.78); }
  _xScale(ny) { return 1 - this.persp * 0.45 * (1 - ny); }

  render(ctx, img, W, H, pal) {
    this.img = img; this.W = W; this.H = H;
    const SW = this.sw = img.width, SH = this.sh = img.height;
    const d = img.data;
    const { amp, rowStep, colStep, segLen, key, floor } = this;

    // Sampled, not exhaustive: a stride of 23 pixels over a 1024x640 raster
    // is ~28k samples, which is plenty for a mean and costs nothing.
    let sum = 0, cnt = 0;
    for (let i = 0; i < d.length; i += 4 * 23) {
      sum += d[i] * 0.3 + d[i + 1] * 0.5 + d[i + 2] * 0.2;
      cnt++;
    }
    this.srcMean = cnt ? sum / cnt / 255 : 0;
    this.srcGain = this.autoGain
      ? Math.min(1, this.refDensity / Math.max(0.004, this.srcMean))
      : 1;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let sy = 0; sy < SH; sy += rowStep) {
      const ny = sy / SH;
      const t = this._rowT(ny);
      const base = this._baseY(t);
      const xs = this._xScale(ny);
      const skewX = this.skew * (1 - ny) * 40;
      // lines further back are thinner and dimmer, like a real deflection CRT
      const depth = 0.35 + 0.65 * ny;
      const rowBase = sy * SW;

      let seg = 0, sumL = 0, sumWarm = 0, started = false;
      ctx.beginPath();

      for (let sx = 0; sx <= SW - 1; sx += colStep) {
        const i = (rowBase + sx) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const luma = (r * 0.3 + g * 0.5 + b * 0.2) / 255;
        const warm = r / (r + b + 1);

        const x = W / 2 + (sx / SW - 0.5) * W * xs + skewX;
        const y = base - luma * amp * xs;

        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        sumL += luma; sumWarm += warm; seg++;

        if (seg >= segLen) {
          this._strokeSeg(ctx, sumL / seg, sumWarm / seg, depth, key, floor, pal);
          ctx.beginPath(); ctx.moveTo(x, y);
          seg = 0; sumL = 0; sumWarm = 0;
        }
      }
      if (seg > 0) this._strokeSeg(ctx, sumL / seg, sumWarm / seg, depth, key, floor, pal);
    }
  }

  _strokeSeg(ctx, luma, warm, depth, key, floor, pal) {
    if (luma < floor) return;                       // true black stays empty
    const hot = Math.min(1, luma * this.gainR);
    // The colouriser decides colour and opacity. In legacy mode this is the
    // original hard key on the warm/cool ratio with a soft ramp on brightness;
    // a Luma keyer or Gradient ramp node in the patch replaces that mapping.
    const c = this.col.map(hot, warm, key);
    const a = c[3] * depth * this.srcGain;
    ctx.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
    ctx.lineWidth = (0.6 + hot * 2.2) * depth;
    ctx.stroke();
    if (hot > 0.62) {                               // bloom on the hottest samples
      ctx.strokeStyle = `rgba(255,255,255,${((hot - 0.62) * 0.9 * depth).toFixed(3)})`;
      ctx.lineWidth = (0.4 + hot * 0.9) * depth;
      ctx.stroke();
    }
  }
}
