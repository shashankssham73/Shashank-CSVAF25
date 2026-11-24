// Tests for the stage where a distance field becomes luminance in the raster.
// Node has no canvas, so the few DOM calls ShapeLayer makes are stubbed; the
// pixel arithmetic under test is plain JavaScript and runs unmodified.

const mkCtx = () => ({
  imageSmoothingEnabled: false,
  createImageData: (w, h) => ({ width:w, height:h, data:new Uint8ClampedArray(w*h*4) }),
  putImageData() {}, drawImage() {},
});
globalThis.document = { createElement: () => ({ width:0, height:0, getContext: mkCtx }) };

const { ShapeLayer } = await import('./shapes.js');
const { Colorizer }  = await import('./colorizer.js');
const { SW, SH, CYAN, AMBER } = await import('./source.js');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}${got !== undefined ? ' -> ' + got : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' -> ' + got : ''}`); }
};
const img = () => ({ width:SW, height:SH, data:new Uint8ClampedArray(SW*SH*4) });
const at = (d, nx, ny) => {
  const i = ((Math.round(ny*(SH-1)))*SW + Math.round(nx*(SW-1)))*4;
  return [d[i], d[i+1], d[i+2], d[i+3]];
};
const fillSpec = (over = {}) => ({
  kind:'fill', spec:{ t:'circle', x:0, y:0, r:0.25 }, lvl:0, soft:0.012,
  luma:0.9, warm:0, route:'scanned', blend:'add', res:'med', ...over });

const L = new ShapeLayer();

// ---------------------------------------------------------------- fill
{
  const I = img();
  L.applyToRaster(I, [fillSpec()]);
  const c = at(I.data, 0.5, 0.5), out = at(I.data, 0.05, 0.5);
  ok('fill: puts ink at the centre of the shape', c[1] > 100, `g=${c[1]} a=${c[3]}`);
  ok('fill: leaves the outside untouched', out[0]===0 && out[1]===0 && out[2]===0 && out[3]===0);
  ok('fill: counted the shape', L.count === 1, L.count);
}
{
  // THE ASPECT TEST. A circle in field space must come out round in PIXELS.
  // If the aspect correction in sdf.js were wrong, this would be an ellipse,
  // and every shape in the system would be subtly stretched.
  const I = img();
  L.applyToRaster(I, [fillSpec()]);
  const d = I.data;
  let x0=SW, x1=-1, y0=SH, y1=-1;
  for (let j=0;j<SH;j++) for (let i=0;i<SW;i++) {
    if (d[(j*SW+i)*4+3] > 0) { if(i<x0)x0=i; if(i>x1)x1=i; if(j<y0)y0=j; if(j>y1)y1=j; }
  }
  const w = x1-x0+1, h = y1-y0+1;
  ok('fill: a field circle is round in pixels (aspect is corrected)',
     Math.abs(w-h) <= 2, `${w}x${h} px, ratio ${(w/h).toFixed(4)}`);
  // r = 0.25 spans 2*0.25*SH = 160 px, plus the soft edge on each side, which
  // still has non-zero coverage: 2*(0.25 + 0.012)*320 = 167.7
  const expect = 2 * (0.25 + 0.012) * SH;
  ok('fill: the circle is the size the radius and softness say', Math.abs(w - expect) <= 2,
     `${w} px, expected ${expect.toFixed(1)}`);
}
{
  const I = img();
  L.applyToRaster(I, [fillSpec({ route:'raw' })]);
  ok('fill: a raw-routed shape is NOT written into the raster',
     I.data.every(v => v === 0) && L.count === 0, 'count ' + L.count);
}

// ---------------------------------------------------------------- chroma
{
  const a = img(), b = img();
  L.applyToRaster(a, [fillSpec({ warm:0 })]);
  L.applyToRaster(b, [fillSpec({ warm:1 })]);
  const ca = at(a.data, 0.5, 0.5), cb = at(b.data, 0.5, 0.5);
  ok('chroma: warm=0 is on the cyan side (blue beats red)', ca[2] > ca[0], `r=${ca[0]} b=${ca[2]}`);
  ok('chroma: warm=1 is on the amber side (red beats blue)', cb[0] > cb[2], `r=${cb[0]} b=${cb[2]}`);
  // the scan processor computes warm as r/(r+b+1); check it recovers what we asked for
  const w = c => c[0] / (c[0] + c[2] + 1);
  ok('chroma: the scan processor will read back warm=0 correctly', w(ca) < 0.15, w(ca).toFixed(3));
  ok('chroma: the scan processor will read back warm=1 correctly', w(cb) > 0.85, w(cb).toFixed(3));
}

// ---------------------------------------------------------------- blend
{
  const s = fillSpec({ luma:0.5 });
  const add = img(), max = img();
  L.applyToRaster(add, [s, { ...s, blend:'add' }]);
  L.applyToRaster(max, [{ ...s, blend:'max' }, { ...s, blend:'max' }]);
  const a = at(add.data, 0.5, 0.5), m = at(max.data, 0.5, 0.5);
  const one = img();
  L.applyToRaster(one, [{ ...s, blend:'max' }]);
  const o = at(one.data, 0.5, 0.5);
  ok('blend add: two overlapping shapes accumulate', a[1] > o[1] * 1.6, `${o[1]} -> ${a[1]}`);
  ok('blend max: two overlapping shapes do not', m[1] === o[1], `${o[1]} vs ${m[1]}`);
}
{
  // additive compositing must saturate, not wrap around to black
  const s = fillSpec({ luma:1, warm:0.5 });
  const I = img();
  L.applyToRaster(I, Array.from({length:12}, () => ({ ...s })));
  const c = at(I.data, 0.5, 0.5);
  ok('blend add: saturates at 255 instead of wrapping',
     c[0] === 255 && c[1] === 255 && c[2] === 255, c.join(','));
}

// ---------------------------------------------------------------- contour
{
  const s = { kind:'contour', spec:{ t:'circle', x:0, y:0, r:0.1 }, lvl:0, wid:0.008,
              rings:4, sp:0.06, fall:0.5, luma:0.9, warm:0, route:'scanned',
              blend:'add', res:'high' };
  const I = img();
  L.applyToRaster(I, [s]);
  const d = I.data;
  // ink should appear at r = 0.1, 0.16, 0.22, 0.28 from the centre and nowhere
  // deep inside; one field, sliced four times
  const ring = r => at(d, 0.5 + r/1.6, 0.5)[3] > 0;
  ok('contour: ink on the zero level',     ring(0.100), 'r=0.100');
  ok('contour: ink on the 2nd ring',       ring(0.160), 'r=0.160');
  ok('contour: ink on the 4th ring',       ring(0.280), 'r=0.280');
  ok('contour: no ink between rings',      !ring(0.130), 'r=0.130');
  ok('contour: nothing deep inside',       !ring(0.030), 'r=0.030');
  ok('contour: nothing past the last ring',!ring(0.360), 'r=0.360');
  // outer rings fade, which is what `fall` is for
  const i0 = at(d, 0.5 + 0.100/1.6, 0.5)[1], i3 = at(d, 0.5 + 0.280/1.6, 0.5)[1];
  ok('contour: outer rings are dimmer than inner ones', i3 < i0, `${i0} -> ${i3}`);
}

// ---------------------------------------------------------------- raw path
{
  const col = new Colorizer();
  col.configure({ mode:'keyer',
    stops:[{c:[10,28,38],a:0.25},{c:[53,224,255],a:0.7},{c:[255,160,42],a:0.9},{c:[255,255,255],a:1}],
    edges:[0.3,0.62,0.86], soft:0 });
  let drawn = 0;
  const ctx = { imageSmoothingEnabled:false, drawImage(){ drawn++; } };
  const n = L.drawRaw(ctx, 1200, 800, [fillSpec({ route:'raw' }), fillSpec()], col, 0.42);
  ok('raw: draws only the raw-routed shapes', n === 1, n);
  ok('raw: blits once', drawn === 1, drawn);
  ok('raw: the colourised buffer has opaque pixels where the shape is',
     L.rawImg.data[(Math.round(SH/2)*SW + Math.round(SW/2))*4+3] > 0,
     'alpha ' + L.rawImg.data[(Math.round(SH/2)*SW + Math.round(SW/2))*4+3]);
  const noRaw = L.drawRaw(ctx, 1200, 800, [fillSpec()], col, 0.42);
  ok('raw: does nothing when no shape is raw-routed', noRaw === 0, noRaw);
  ok('raw: does nothing on an empty list', L.drawRaw(ctx, 1200, 800, [], col, 0.42) === 0);
  ok('raw: does nothing on a missing list', L.drawRaw(ctx, 1200, 800, undefined, col, 0.42) === 0);
}

// ---------------------------------------------------------------- no-ops
{
  const I = img();
  L.applyToRaster(I, undefined);
  ok('applyToRaster tolerates a missing shape list', I.data.every(v=>v===0) && L.ms === 0);
  L.applyToRaster(I, []);
  ok('applyToRaster tolerates an empty shape list', I.data.every(v=>v===0));
}

// ---------------------------------------------------------------- cost
{
  const specs = [
    fillSpec({ res:'med' }),
    { kind:'contour', spec:{ t:'ngon', x:0, y:0, r:0.3, n:6, a:0 }, lvl:0, wid:0.006,
      rings:4, sp:0.05, fall:0.5, luma:0.8, warm:0.2, route:'scanned', blend:'add', res:'med' },
    fillSpec({ spec:{ t:'star', x:0, y:0, r:0.35, n:5, m:2.4, a:0 }, res:'med' }),
  ];
  const I = img();
  const t0 = performance.now();
  for (let k=0;k<30;k++) L.applyToRaster(I, specs);
  const ms = (performance.now()-t0)/30;
  ok('three shapes composite inside a frame budget', ms < 14,
     ms.toFixed(2) + ' ms/frame for 3 shapes into 512x320');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
