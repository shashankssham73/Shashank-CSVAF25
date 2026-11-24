// colorizer.js — the thing on the end of the chain.
//
// Scanimate's output was always monochrome. Every colour in it came from a
// COLOURISER downstream that, in Wikipedia's summary of the machine, "takes
// certain shades of grey and turns it into color as well as transparency".
// That is a luminance keyer, and it is why analogue motion graphics of that
// era have hard-edged colour bands that slide across a moving image.
//
// Three modes:
//
//   legacy  the visualizer's original two-colour warm/cool key, reproduced
//           exactly, so a patch with no colouriser node looks unchanged
//   keyer   N hard luminance bands, each with its own colour and alpha, and
//           band edges that are modulation destinations
//   ramp    a smooth four-stop gradient with gamma, offset and hue rotation
//
// TWO RULES THIS FILE KEEPS, because the project depends on them:
//
//   1. Alpha follows luminance. A band's alpha scales a luminance-derived
//      opacity rather than replacing it, so faint parts of the image stay
//      faint. Set a band's alpha to 1 for maximum opacity.
//   2. Amber still means contention. In every mode, the chroma channel pulls
//      the result toward the warning colour. Colour is never decorative here:
//      if something is amber, something is wrong -- and that has to survive
//      the user repainting the whole palette.

import { P } from './palette.js';
import { hueRotate } from '../patch/opkit.js';

const lerp3 = (a, b, t, out) => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};

export class Colorizer {
  constructor() {
    this.mode = 'legacy';
    this.cfg = null;
    this._o = [0, 0, 0, 0];        // reused, so mapping allocates nothing
    this._t = [0, 0, 0];
    this.warnPull = 0.85;          // how hard chroma drags toward the warn hue
    // Plain arrays of the two meaningful hues, so viz/rd.js can hand the same
    // legacy colours to its shader rather than hard-coding a second copy.
    this.flowRGB = [P.flow[0], P.flow[1], P.flow[2]];
    this.warnRGB = [P.warn[0], P.warn[1], P.warn[2]];
  }

  // Accepts the $color object a colouriser operator put on the graph output.
  // Passing null or undefined reverts to the original two-colour key.
  configure(cfg) {
    if (!cfg || !cfg.mode) { this.mode = 'legacy'; this.cfg = null; return; }
    this.mode = cfg.mode;
    this.cfg = cfg;
    if (cfg.mode === 'ramp') {
      // Pre-rotate the hue once per frame instead of once per sample.
      this._stops = cfg.stops.map(s => ({ c: hueRotate(s.c, cfg.hue || 0), p: s.p }))
                             .sort((a, b) => a.p - b.p);
    }
  }

  get name() { return this.mode; }

  // luma 0..1 after the scan processor's drive, warm 0..1 chroma ratio,
  // key the legacy threshold. Returns [r, g, b, alpha]; do not retain it.
  map(luma, warm, key) {
    const o = this._o;
    const L = luma < 0 ? 0 : luma > 1 ? 1 : luma;

    if (this.mode === 'keyer' && this.cfg) {
      const { stops, edges, soft } = this.cfg;
      let i = 0;
      while (i < edges.length && L >= edges[i]) i++;
      let c = stops[i] || stops[stops.length - 1];
      let a = c.a;
      let col = c.c;
      // Softness crossfades across a band edge. At soft = 0 the edge is hard,
      // which is the analogue keyer behaviour and the default.
      if (soft > 1e-6) {
        const e = i > 0 ? edges[i - 1] : null;
        if (e !== null && L - e < soft) {
          const prev = stops[i - 1];
          const t = 0.5 + (L - e) / (2 * soft);
          col = lerp3(prev.c, c.c, t, this._t);
          a = prev.a + (c.a - prev.a) * t;
        }
      }
      o[0] = col[0]; o[1] = col[1]; o[2] = col[2];
      o[3] = a * Math.min(1, 0.12 + L * 1.25);
    } else if (this.mode === 'ramp' && this.cfg) {
      const { gamma, off, alpha } = this.cfg;
      const s = this._stops;
      let t = Math.pow(L, 1 / gamma) + off;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      let i = 0;
      while (i < s.length - 1 && t > s[i + 1].p) i++;
      const a0 = s[i], a1 = s[Math.min(s.length - 1, i + 1)];
      const span = a1.p - a0.p;
      const u = span > 1e-9 ? (t - a0.p) / span : 0;
      const col = lerp3(a0.c, a1.c, u < 0 ? 0 : u > 1 ? 1 : u, this._t);
      o[0] = col[0]; o[1] = col[1]; o[2] = col[2];
      o[3] = alpha * Math.min(1, 0.12 + L * 1.25);
    } else {
      // The original: a hard key on the warm/cool ratio, a soft ramp on
      // brightness. Kept byte-for-byte so an unpatched image is unchanged.
      const c = warm > key ? P.warn : P.flow;
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
      o[3] = Math.min(0.95, 0.10 + L * 1.25);
      return o;
    }

    // Rule 2: contention still reads amber, whatever the palette says.
    const over = warm - key;
    if (over > 0) {
      const t = Math.min(1, over / Math.max(0.05, 1 - key)) * this.warnPull;
      const col = lerp3(o, P.warn, t, this._t);
      o[0] = col[0]; o[1] = col[1]; o[2] = col[2];
    }
    return o;
  }
}
