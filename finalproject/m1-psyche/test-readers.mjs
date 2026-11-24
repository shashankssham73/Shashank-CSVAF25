// Tests for the screen readers. Synthetic images with known content, so
// every measurement has a right answer.

import { measure, gridUnits, regionUnits } from './readers.js';
import { matches, sel, ALL } from '../m0-telemetry/patch/selection.js';

let pass = 0, fail = 0;
const ok = (n, c, g) => { if (c) { pass++; console.log(`  ok   ${n}${g!==undefined?' -> '+g:''}`); }
                          else { fail++; console.log(`  FAIL ${n}${g!==undefined?' -> '+g:''}`); } };
const near = (a, b, e) => Math.abs(a - b) <= e;

// a fake ImageData
function img(W, H, fn) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fn(x, y, W, H);
    const i = (y * W + x) * 4;
    d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255;
  }
  return { width: W, height: H, data: d };
}
const BW = 1440, BH = 900;

// ---------------------------------------------------------------- measure
{
  const black = img(64, 64, () => [0, 0, 0]);
  const white = img(64, 64, () => [255, 255, 255]);
  const mid   = img(64, 64, () => [128, 128, 128]);
  ok('black measures zero brightness', measure(black,0,0,64,64).bright === 0);
  ok('white measures full brightness', near(measure(white,0,0,64,64).bright, 1, 0.01),
     measure(white,0,0,64,64).bright.toFixed(3));
  ok('mid grey measures about half', near(measure(mid,0,0,64,64).bright, 0.502, 0.01),
     measure(mid,0,0,64,64).bright.toFixed(3));
  ok('a flat field has no edges', measure(mid,0,0,64,64).edge < 0.001,
     measure(mid,0,0,64,64).edge.toFixed(5));
  ok('a flat field is not busy', measure(mid,0,0,64,64).busy < 0.001);
}
{
  // vertical black/white stripes: maximum edge density
  const stripes = img(64, 64, x => (x % 2 ? [255,255,255] : [0,0,0]));
  const m = measure(stripes, 0, 0, 64, 64, 1);
  ok('hard stripes read as high edge density', m.edge > 0.5, m.edge.toFixed(3));
  ok('and as busy', m.busy > 0.5, m.busy.toFixed(3));
  ok('while averaging to mid brightness', near(m.bright, 0.5, 0.06), m.bright.toFixed(3));
}
{
  const red   = img(32, 32, () => [255, 0, 0]);
  const green = img(32, 32, () => [0, 255, 0]);
  const blue  = img(32, 32, () => [0, 0, 255]);
  const grey  = img(32, 32, () => [128, 128, 128]);
  ok('red hue is 0',        near(measure(red,0,0,32,32).hue, 0, 0.01), measure(red,0,0,32,32).hue.toFixed(3));
  ok('green hue is 1/3',    near(measure(green,0,0,32,32).hue, 1/3, 0.01), measure(green,0,0,32,32).hue.toFixed(3));
  ok('blue hue is 2/3',     near(measure(blue,0,0,32,32).hue, 2/3, 0.01), measure(blue,0,0,32,32).hue.toFixed(3));
  ok('pure colours are fully saturated', measure(red,0,0,32,32).sat > 0.99);
  ok('grey is unsaturated', measure(grey,0,0,32,32).sat < 0.01);
}
{
  const half = img(64, 64, x => (x < 32 ? [255,255,255] : [0,0,0]));
  ok('measuring a sub-rectangle sees only that rectangle',
     measure(half,0,0,32,64).bright > 0.98 && measure(half,32,0,64,64).bright < 0.02,
     `left ${measure(half,0,0,32,64).bright.toFixed(2)}, right ${measure(half,32,0,64,64).bright.toFixed(2)}`);
  ok('a degenerate rectangle does not crash', Number.isFinite(measure(half,10,10,10,10).bright));
  ok('out-of-bounds is clamped', Number.isFinite(measure(half,-50,-50,999,999).bright));
}

// ---------------------------------------------------------------- grid
{
  const g = img(256, 160, (x,y,W) => [255 * (x / W), 60, 200 * (1 - x / W)]);
  const u = gridUnits(g, BW, BH, { cols: 8, rows: 5 });
  ok('grid returns cols x rows units', u.length === 40, `${u.length} for 8x5`);
  ok('tiles tile the canvas exactly',
     near(u[0].w * 8, BW, 0.01) && near(u[0].h * 5, BH, 0.01),
     `${u[0].w.toFixed(1)} x ${u[0].h.toFixed(1)}`);
  ok('tiles carry their position', u[0].x === 0 && u[0].y === 0 && u[7].x > u[0].x);
  ok('tiles carry a source rectangle to draw from',
     u.every(t => t.src && t.src.w > 0 && t.src.h > 0));
  ok('the gradient is read left to right',
     u[7].sem.bright > u[0].sem.bright,
     `left ${u[0].sem.bright.toFixed(3)} -> right ${u[7].sem.bright.toFixed(3)}`);
  ok('every tile is numbered for distributing operators',
     u.every((t,k) => t.i === k && t.kindIndex === k && t.ofKind === 40));
  ok('tiles know their column and row', u[9].sem.col === 1 && u[9].sem.row === 1);
}
{
  // area is the "custom screen size and shape" case
  const g = img(256, 160, (x,y,W) => (x < W/2 ? [255,255,255] : [0,0,0]));
  const full = gridUnits(g, BW, BH, { cols: 4, rows: 1 });
  const left = gridUnits(g, BW, BH, { cols: 4, rows: 1, ax:0, ay:0, aw:0.5, ah:1 });
  ok('area restricts where the grid looks',
     left.every(t => t.sem.bright > 0.95) && full[3].sem.bright < 0.05,
     `left half all bright; full-width last tile ${full[3].sem.bright.toFixed(2)}`);
  ok('and where the tiles land on the canvas',
     near(left[3].x + left[3].w, BW / 2, 0.01), `${(left[3].x+left[3].w).toFixed(0)} of ${BW}`);
}

// ---------------------------------------------------------------- regions
{
  // three plainly distinct blocks: dark, mid, bright
  const three = img(240, 60, (x) => x < 80 ? [20,20,20] : x < 160 ? [128,128,128] : [240,240,240]);
  const u = regionUnits(three, BW, BH, { cols: 24, rows: 6, tol: 0.05, min: 2, max: 20 });
  ok('three distinct blocks become three regions', u.length === 3, `${u.length} regions`);
  const b = u.map(r => r.sem.bright).sort((a,c) => a - c);
  ok('and their brightnesses are the three blocks',
     near(b[0], 0.078, 0.03) && near(b[1], 0.502, 0.03) && near(b[2], 0.941, 0.03),
     b.map(v=>v.toFixed(2)).join(' '));
  ok('each region knows its bounding box', u.every(r => r.w > 0 && r.h > 0));
  ok('and how solidly it fills it', u.every(r => r.sem.fill > 0.95), 'all near 1 for solid blocks');
}
{
  // a smooth gradient must NOT shatter into stripes
  const grad = img(240, 60, (x,y,W) => { const v = 255 * x / W; return [v,v,v]; });
  const loose = regionUnits(grad, BW, BH, { cols: 24, rows: 6, tol: 0.3, min: 2, max: 40 });
  const tight = regionUnits(grad, BW, BH, { cols: 24, rows: 6, tol: 0.01, min: 1, max: 40 });
  ok('a loose tolerance keeps a gradient whole', loose.length <= 2, `${loose.length} regions`);
  ok('a tight tolerance splits it', tight.length > loose.length,
     `${tight.length} at tol 0.01 vs ${loose.length} at 0.3`);
}
{
  const noise = img(240, 60, (x,y) => { const v = ((x*37 + y*91) % 255); return [v, 255-v, v]; });
  const u = regionUnits(noise, BW, BH, { cols: 20, rows: 5, tol: 0.05, min: 4, max: 30 });
  ok('a minimum size discards specks', u.every(r => r.sem.tiles >= 4));
  const capped = regionUnits(noise, BW, BH, { cols: 20, rows: 5, tol: 0.5, min: 1, max: 3 });
  ok('a maximum count is respected', capped.length <= 3, `${capped.length}`);
  ok('regions come back largest first', (() => {
    const q = regionUnits(noise, BW, BH, { cols:20, rows:5, tol:0.08, min:1, max:30 });
    return q.every((r,k) => k === 0 || r.sem.tiles <= q[k-1].sem.tiles);
  })());
}

// ------------------------------------- the existing Pick blocks, unchanged
{
  const g = img(256, 160, (x,y,W) => { const v = 255 * x / W; return [v, v, v]; });
  const tiles = gridUnits(g, BW, BH, { cols: 10, rows: 4 });

  ok('Everything selects every tile', tiles.every(t => matches(ALL.m, t)));
  ok('pick by kind selects tiles', tiles.every(t => matches({ t:'kind', v:'tile' }, t)));
  ok('and does not select something else', !matches({ t:'kind', v:'body' }, tiles[0]));

  // THE ONE THAT MATTERS: the numeric range pick, which already existed for
  // text measures, now selects on a measured screen property with no change
  // to selection.js at all.
  const bright = tiles.filter(t => matches({ t:'range', k:'bright', lo:0.6, hi:1 }, t));
  const dark   = tiles.filter(t => matches({ t:'range', k:'bright', lo:0, hi:0.4 }, t));
  ok('"every bright tile" is a selection', bright.length > 0 && bright.length < tiles.length,
     `${bright.length} of ${tiles.length}`);
  ok('"every dark tile" is the other end', dark.length > 0 && !dark.some(t => bright.includes(t)),
     `${dark.length} of ${tiles.length}, no overlap`);
  ok('selecting on edge density works too',
     tiles.filter(t => matches({ t:'range', k:'edge', lo:0, hi:1 }, t)).length === tiles.length);

  // and combining selections still works
  const both = { t:'and', a:{ t:'kind', v:'tile' }, b:{ t:'range', k:'bright', lo:0.6, hi:1 } };
  ok('combined selections work on tiles', tiles.filter(t => matches(both, t)).length === bright.length);
  ok('pick under a path prefix groups a reader',
     tiles.every(t => matches({ t:'under', path:'grid>' }, t)));
  ok('regions and tiles can be told apart', (() => {
    const r = regionUnits(g, BW, BH, { cols:12, rows:4, tol:0.3, min:1, max:9 });
    return r.every(x => matches({ t:'kind', v:'region' }, x))
        && !r.some(x => matches({ t:'kind', v:'tile' }, x));
  })());
}

// ---------------------------------------------------------------- cost
{
  const big = img(1024, 640, (x,y) => [(x*7)%255, (y*11)%255, ((x+y)*3)%255]);
  let t0 = performance.now();
  for (let k = 0; k < 20; k++) gridUnits(big, BW, BH, { cols: 32, rows: 20 });
  const gms = (performance.now() - t0) / 20;
  ok('a 32x20 grid of a 1024x640 frame', gms < 12, gms.toFixed(2) + ' ms (640 tiles)');

  t0 = performance.now();
  for (let k = 0; k < 10; k++) regionUnits(big, BW, BH, { cols: 48, rows: 30 });
  const rms = (performance.now() - t0) / 10;
  ok('region finding over 48x30 tiles', rms < 25, rms.toFixed(2) + ' ms');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
