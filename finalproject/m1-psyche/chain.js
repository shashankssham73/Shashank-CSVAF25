// chain.js — the image pipeline, pointed at a desktop.
//
// Every stage here was built and tested for the Computing Visualizer. None of
// it is new; what is new is what it is pointed at. The machine map becomes a
// desktop, and the same scan processor, chemistry, feedback loop and
// colouriser run on it.
//
//   desktop (chrome + glyphs)
//        |            drawn into a raster at CHAIN_W x CHAIN_H
//        +  shapes    SDF fields written in as luminance
//        |
//   SCAN PROC  ...and/or...  REACTION-DIFFUSION
//        |                   crossfaded by rd.mix
//   FEEDBACK   iterated affine warp at gain < 1
//        |
//   COLOURISER luminance bands or a gradient ramp
//        |
//      SCREEN
//
// THE DRY PATH MATTERS. `chain.mix` crossfades the whole pipeline against the
// crisp, untouched desktop — and the dry side is drawn directly, not through
// the raster, so at mix 0 the text is exactly as sharp as it would be with
// none of this code present. That is the micro-dosing control: the usable
// desktop is one end of a continuous knob, not a separate mode.

import { Feedback }          from '../m0-telemetry/viz/feedback.js';
import { ScanProcessor }     from '../m0-telemetry/viz/scanproc.js';
import { ShapeLayer }        from '../m0-telemetry/viz/shapes.js';
import { ReactionDiffusion } from '../m0-telemetry/viz/rd.js';
import { P }                 from '../m0-telemetry/viz/palette.js';

// 1.6 aspect, matching sdf.ASPECT, so SDF shapes land un-stretched. Bigger
// than the visualizer's 512x320 because this raster carries text, and the
// scan processor is the thing that destroys detail here, not the resolution.
export const CHAIN_W = 1024, CHAIN_H = 640;

export class ImageChain {
  constructor(w = CHAIN_W, h = CHAIN_H) {
    this.w = w; this.h = h;
    this.raster = document.createElement('canvas');
    this.raster.width = w; this.raster.height = h;
    this.rctx = this.raster.getContext('2d', { willReadFrequently: true });

    this.fb     = new Feedback();
    this.scan   = new ScanProcessor();
    this.shapes = new ShapeLayer(w, h);
    this.rd     = new ReactionDiffusion(w, h);

    // The scan processor's defaults are tuned for a 512-wide machine map.
    // At 1024 the same steps would cost four times as much for no more
    // apparent detail, so the sampling is coarsened to match.
    this.scan.rowStep = 4;
    this.scan.colStep = 5;

    this.W = 0; this.H = 0;
    this.ms = 0;
  }

  resize(W, H) {
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.fb.resize(W, H);
  }

  // draw(ctx, w, h) renders the desktop into the raster.
  // G is the graph's output. Returns nothing; paints into outCtx.
  render(draw, G, outCtx, W, H, wet, t) {
    const t0 = performance.now();
    this.resize(W, H);

    // --- the source raster -------------------------------------------------
    const r = this.rctx;
    r.setTransform(1, 0, 0, 1, 0, 0);
    r.clearRect(0, 0, this.w, this.h);
    draw(r, this.w, this.h);
    const img = r.getImageData(0, 0, this.w, this.h);

    // shapes go in BEFORE the scan processor reads it, so they deflect and
    // feed back exactly like the desktop does
    this.shapes.applyToRaster(img, G.$shapes);

    this.scan.col.configure(G.$color);

    // --- apply the scalar sinks -------------------------------------------
    const set = (k, f) => { const v = G[k]; if (Number.isFinite(v)) f(v); };
    set('scan.amp',     v => this.scan.amp     = v);
    set('scan.persp',   v => this.scan.persp   = v);
    set('scan.key',     v => this.scan.key     = v);
    set('scan.gainR',   v => this.scan.gainR   = v);
    set('scan.floor',   v => this.scan.floor   = v);
    set('scan.rowStep', v => this.scan.rowStep = Math.max(1, Math.min(10, Math.round(v))));
    set('scan.density', v => this.scan.refDensity = v);
    set('fb.gain',      v => this.fb.gain      = v);
    set('fb.zoom',      v => this.fb.zoom      = v);
    set('fb.rot',       v => this.fb.rot       = v);
    this.scan.skew = Number.isFinite(G['scan.skew'])
      ? G['scan.skew'] * (Math.random() - 0.5) * 2 : 0;

    const RD = this.rdp || (this.rdp = { F:0.0545, k:0.0620, Du:1, Dv:0.5, dt:1,
                                         iters:14, inject:0.8, decay:0, gain:2.6,
                                         bias:0, floor:0.03, mix:0 });
    set('rd.mix',    v => RD.mix    = Math.min(1, Math.max(0, v)));
    set('rd.feed',   v => RD.F      = v);
    set('rd.kill',   v => RD.k      = v);
    set('rd.inject', v => RD.inject = v);
    set('rd.iters',  v => RD.iters  = v);
    set('rd.decay',  v => RD.decay  = v);
    set('rd.gain',   v => RD.gain   = v);
    set('rd.floor',  v => RD.floor  = v);
    set('rd.diffV',  v => RD.Dv     = v);

    // --- chemistry ---------------------------------------------------------
    const chem = this.rd.ok ? RD.mix : 0;
    if (chem > 0.002) {
      this.rd.seed(img);
      this.rd.step(RD);
      this.rd.render(this.scan.col, RD.gain, RD.bias, this.scan.key, RD.floor);
    }

    // --- deflection, chemistry, feedback -----------------------------------
    const pctx = this.fb.begin();
    if (chem < 0.998) {
      pctx.globalAlpha = 1 - chem;
      this.scan.render(pctx, img, W, H, P);
      pctx.globalAlpha = 1;
    }
    if (chem > 0.002) {
      pctx.globalAlpha = chem;
      pctx.drawImage(this.rd.canvas, 0, 0, W, H);
      pctx.globalAlpha = 1;
    }

    outCtx.save();
    outCtx.setTransform(1, 0, 0, 1, 0, 0);
    outCtx.globalAlpha = wet;
    this.fb.end(outCtx);
    this.shapes.drawRaw(outCtx, W, H, G.$shapes, this.scan.col, this.scan.key);
    outCtx.restore();

    this.ms = performance.now() - t0;
    this.chem = chem;
  }
}
