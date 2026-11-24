// readers.js — how the patcher reads the screen.
//
// Until now there was exactly one way: the Accessibility API, which returns
// ELEMENTS — semantic, exact, and blind to anything that is not a control.
// It cannot see a photograph, a video, a gradient, or a canvas. This adds the
// other two ways of looking, so the screen is addressable whatever is on it.
//
//   elements   what the applications say is there      exact, semantic
//   grid       fixed tiles, each measured              uniform, predictable
//   regions    tiles merged until something coheres    follows the content
//
// A UNIT is whatever a reader returns: an element, a tile, a region. They all
// carry the same two things — a rectangle, and a `sem` bag of measurements —
// which is what lets the existing Pick blocks select among them with no
// changes at all. `pick.range` already tests `e.sem[key]` numerically, so
// "every bright tile" and "every busy region" are selections the moment the
// measurements exist.
//
// ON "PIXEL BY PIXEL". A 2940x1838 screen is 5.4 million pixels. Treating
// each as an addressable unit you could select and transform is not a
// resolution choice, it is a different program — nothing could draw it and
// nothing could pick among it. A fine grid IS per-pixel reading, sampled at a
// density you can actually work with, and the tile count is yours to set.

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// RGB to hue and saturation, 0..1. Hue is circular, so a mean hue is only
// meaningful for a tile that is roughly one colour — `sat` tells you whether
// to believe it.
function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return { h, s: mx <= 0 ? 0 : d / mx, v: mx };
}

// Measure one rectangle of an ImageData. Sampled on a stride rather than
// exhaustively: a tile's mean does not need every pixel, and this runs for
// every tile every frame.
export function measure(img, x0, y0, x1, y1, stride = 3) {
  const W = img.width, H = img.height, d = img.data;
  x0 = Math.max(0, Math.min(W - 1, Math.round(x0)));
  y0 = Math.max(0, Math.min(H - 1, Math.round(y0)));
  x1 = Math.max(x0 + 1, Math.min(W, Math.round(x1)));
  y1 = Math.max(y0 + 1, Math.min(H, Math.round(y1)));

  let n = 0, sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, edge = 0, ne = 0;
  for (let y = y0; y < y1; y += stride) {
    for (let x = x0; x < x1; x += stride) {
      const i = (y * W + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      sr += r; sg += g; sb += b;
      const l = (r * 0.3 + g * 0.5 + b * 0.2) / 255;
      sl += l; sl2 += l * l; n++;
      // forward difference in both axes: a cheap edge density that needs no
      // second pass and no kernel
      if (x + stride < x1) {
        const j = (y * W + x + stride) * 4;
        edge += Math.abs(r - d[j]) + Math.abs(g - d[j + 1]) + Math.abs(b - d[j + 2]);
        ne++;
      }
      if (y + stride < y1) {
        const j = ((y + stride) * W + x) * 4;
        edge += Math.abs(r - d[j]) + Math.abs(g - d[j + 1]) + Math.abs(b - d[j + 2]);
        ne++;
      }
    }
  }
  if (!n) return { bright:0, hue:0, sat:0, edge:0, busy:0, r:0, g:0, b:0, n:0 };
  const mr = sr / n, mg = sg / n, mb = sb / n;
  const mean = sl / n;
  const varc = Math.max(0, sl2 / n - mean * mean);
  const c = hsv(mr, mg, mb);
  return {
    bright: clamp01(mean),
    hue:    c.h,
    sat:    clamp01(c.s),
    // normalised so a hard black/white edge reads about 1
    edge:   ne ? clamp01(edge / ne / 420) : 0,
    busy:   clamp01(Math.sqrt(varc) * 3.2),
    r: mr, g: mg, b: mb, n,
  };
}

// Every unit carries the same shape, so the Pick blocks cannot tell the
// difference between a tile, a region and an element.
function unit(kind, id, path, x, y, w, h, m, extra = {}, BW = 0, BH = 0) {
  return {
    kind, id,
    x, y, w, h, cx: x + w / 2, cy: y + h / 2,
    // Where this unit's centre is in 0..1 of the frame. Shape selections are
    // authored in that space, so without it a shape cannot be asked whether
    // it contains a unit.
    nx: BW ? (x + w / 2) / BW : 0,
    ny: BH ? (y + h / 2) / BH : 0,
    i: 0, kindIndex: 0, ofKind: 1,
    sem: {
      kind, role: kind, app: '', path, text: '',
      len: 0, words: 0, entropy: 0, digits: 0, caps: 0, ttr: 1, depth: 0,
      bright: m.bright, hue: m.hue, sat: m.sat, edge: m.edge, busy: m.busy,
      ...extra,
    },
  };
}

// ---------------------------------------------------------------- grid
//
// Fixed tiles. Predictable, uniform, and the only reader whose cost you know
// in advance: cols x rows, every frame, regardless of what is on screen.
//
// `area` restricts it to part of the screen, in 0..1 coordinates, which is
// the "custom size and shape" case — a grid over just the left half, or just
// the strip where your menu bar is.
export function gridUnits(img, BW, BH, p = {}) {
  const cols = Math.max(1, Math.min(160, Math.round(p.cols ?? 16)));
  const rows = Math.max(1, Math.min(160, Math.round(p.rows ?? 10)));
  const ax = clamp01(p.ax ?? 0), ay = clamp01(p.ay ?? 0);
  const aw = clamp01(p.aw ?? 1), ah = clamp01(p.ah ?? 1);
  const out = [];
  const sx0 = ax * img.width, sy0 = ay * img.height;
  const sw = aw * img.width, sh = ah * img.height;
  const bx0 = ax * BW, by0 = ay * BH, bw = aw * BW, bh = ah * BH;
  const stride = Math.max(1, Math.round(Math.min(sw / cols, sh / rows) / 6));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = measure(img, sx0 + (c / cols) * sw, sy0 + (r / rows) * sh,
                             sx0 + ((c + 1) / cols) * sw, sy0 + ((r + 1) / rows) * sh, stride);
      const u = unit('tile', `t${r}_${c}`, `grid>r${r}c${c}`,
                     bx0 + (c / cols) * bw, by0 + (r / rows) * bh, bw / cols, bh / rows, m,
                     { col: c, row: r, cols, rows }, BW, BH);
      u.i = out.length;
      // Where this tile came from, in 0..1 of the frame. NORMALISED on
      // purpose: measuring happens on a small canvas and drawing on a large
      // one, and a tile should not be pinned to the resolution it was
      // measured at.
      u.src = { x: ax + (c / cols) * aw, y: ay + (r / rows) * ah,
                w: aw / cols, h: ah / rows };
      out.push(u);
    }
  }
  for (const u of out) { u.kindIndex = u.i; u.ofKind = out.length; }
  return out;
}

// ---------------------------------------------------------------- regions
//
// "Grids of pixels until something is recognised."
//
// Tiles are measured on a coarse grid, then neighbouring tiles that look
// alike are merged. What survives is not a semantic object — nothing here
// knows what a button is — but it does follow the CONTENT: a photograph
// becomes one region, a toolbar becomes a strip, a block of text becomes a
// patch of high edge density. It sees what Accessibility cannot.
//
// Union-find over the tile grid. Two tiles join if their brightness, hue and
// edge density are all within tolerance, so a gradient stays one region and a
// boundary splits.
export function regionUnits(img, BW, BH, p = {}) {
  const cols = Math.max(2, Math.min(120, Math.round(p.cols ?? 40)));
  const rows = Math.max(2, Math.min(120, Math.round(p.rows ?? 25)));
  const tol  = Math.max(0.005, p.tol ?? 0.09);
  const minTiles = Math.max(1, Math.round(p.min ?? 3));
  const maxOut   = Math.max(1, Math.min(400, Math.round(p.max ?? 60)));
  const ax = clamp01(p.ax ?? 0), ay = clamp01(p.ay ?? 0);
  const aw = clamp01(p.aw ?? 1), ah = clamp01(p.ah ?? 1);

  const sx0 = ax * img.width, sy0 = ay * img.height;
  const sw = aw * img.width, sh = ah * img.height;
  const stride = Math.max(1, Math.round(Math.min(sw / cols, sh / rows) / 3));

  const cell = new Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    cell[r * cols + c] = measure(img, sx0 + (c / cols) * sw, sy0 + (r / rows) * sh,
                                      sx0 + ((c + 1) / cols) * sw, sy0 + ((r + 1) / rows) * sh,
                                      stride);
  }

  const parent = new Int32Array(cols * rows);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  // Hue is circular, and meaningless on a grey tile, so it only counts when
  // both tiles are actually coloured.
  const alike = (a, b) => {
    if (Math.abs(a.bright - b.bright) > tol) return false;
    if (Math.abs(a.edge - b.edge) > tol * 2.5) return false;
    if (a.sat > 0.2 && b.sat > 0.2) {
      let dh = Math.abs(a.hue - b.hue);
      if (dh > 0.5) dh = 1 - dh;
      if (dh > tol) return false;
    }
    return true;
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (c + 1 < cols && alike(cell[i], cell[i + 1])) join(i, i + 1);
    if (r + 1 < rows && alike(cell[i], cell[i + cols])) join(i, i + cols);
  }

  const groups = new Map();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, k = find(i);
    let g = groups.get(k);
    if (!g) groups.set(k, g = { n:0, c0:c, c1:c, r0:r, r1:r, b:0, h:0, s:0, e:0, u:0 });
    g.n++;
    if (c < g.c0) g.c0 = c; if (c > g.c1) g.c1 = c;
    if (r < g.r0) g.r0 = r; if (r > g.r1) g.r1 = r;
    const m = cell[i];
    g.b += m.bright; g.h += m.hue; g.s += m.sat; g.e += m.edge; g.u += m.busy;
  }

  const list = [...groups.values()].filter(g => g.n >= minTiles)
        .sort((a, b) => b.n - a.n).slice(0, maxOut);

  const bx0 = ax * BW, by0 = ay * BH, bw = aw * BW, bh = ah * BH;
  const out = list.map((g, k) => {
    const m = { bright: g.b / g.n, hue: g.h / g.n, sat: g.s / g.n,
                edge: g.e / g.n, busy: g.u / g.n };
    const x = bx0 + (g.c0 / cols) * bw, y = by0 + (g.r0 / rows) * bh;
    const w = ((g.c1 - g.c0 + 1) / cols) * bw, h = ((g.r1 - g.r0 + 1) / rows) * bh;
    const u = unit('region', `g${k}`, `regions>${k}`, x, y, w, h, m, {
      tiles: g.n,
      // how much of its own bounding box the region actually fills: a solid
      // block is near 1, a scattered one much less
      fill: g.n / Math.max(1, (g.c1 - g.c0 + 1) * (g.r1 - g.r0 + 1)),
      area: (w * h) / (BW * BH),
    }, BW, BH);
    u.i = k;
    u.src = { x: ax + (g.c0 / cols) * aw, y: ay + (g.r0 / rows) * ah,
              w: ((g.c1 - g.c0 + 1) / cols) * aw, h: ((g.r1 - g.r0 + 1) / rows) * ah };
    return u;
  });
  for (const u of out) { u.kindIndex = u.i; u.ofKind = out.length; }
  return out;
}

export const READERS = { grid: gridUnits, regions: regionUnits };
