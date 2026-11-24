import { evalSpec, rasterize, sampleField, shape, NOTHING, isShape, depthOf,
         smin, smax, ASPECT, toFieldX, toFieldY } from './sdf.js';
import { curveAt, makeCurve, curveResample, CURVE_N } from './opkit.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}${got !== undefined ? ' -> ' + got : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' -> ' + got : ''}`); }
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const E = s => (x, y) => evalSpec(s, x, y, curveAt);

// ---------------------------------------------------------------- primitives
{
  const c = { t:'circle', x:0, y:0, r:0.3 };
  const f = E(c);
  ok('circle: centre distance = -r', near(f(0,0), -0.3, 1e-9), f(0,0).toFixed(6));
  ok('circle: on the rim = 0',       near(f(0.3,0), 0, 1e-9), f(0.3,0).toFixed(9));
  ok('circle: outside is exact',     near(f(0.5,0), 0.2, 1e-9), f(0.5,0).toFixed(6));
}
{
  const b = { t:'box', x:0, y:0, w:0.4, h:0.2, r:0 };
  const f = E(b);
  ok('box: centre = -min(w,h)',   near(f(0,0), -0.2, 1e-9), f(0,0).toFixed(6));
  ok('box: face distance exact',  near(f(0.5,0), 0.1, 1e-9), f(0.5,0).toFixed(6));
  ok('box: corner distance exact',near(f(0.7,0.4), Math.hypot(0.3,0.2), 1e-9), f(0.7,0.4).toFixed(6));
}
{
  // Apothem 0.3 means the edge midpoint sits exactly 0.3 from centre.
  const g = { t:'ngon', x:0, y:0, r:0.3, n:6, a:0 };
  const f = E(g);
  ok('ngon: centre = -apothem', near(f(0,0), -0.3, 1e-6), f(0,0).toFixed(6));
  ok('ngon: edge midpoint = 0', near(f(0.3,0), 0, 1e-6), f(0.3,0).toFixed(6));
  // a hexagon of apothem a has circumradius a/cos(pi/6)
  const R = 0.3 / Math.cos(Math.PI / 6);
  const vx = R * Math.cos(Math.PI / 6), vy = R * Math.sin(Math.PI / 6);
  ok('ngon: vertex is on the edge', near(f(vx, vy), 0, 1e-6), f(vx,vy).toFixed(6));
}
{
  const r = { t:'ring', x:0, y:0, r:0.3, th:0.06 };
  const f = E(r);
  ok('ring: on the mid radius = -th/2', near(f(0.3,0), -0.03, 1e-9), f(0.3,0).toFixed(6));
  ok('ring: centre is outside it',      f(0,0) > 0.26, f(0,0).toFixed(6));
}
{
  const s = { t:'seg', x1:-0.2, y1:0, x2:0.2, y2:0, th:0.08 };
  const f = E(s);
  ok('segment: on the axis = -th/2',  near(f(0,0), -0.04, 1e-9), f(0,0).toFixed(6));
  ok('segment: past the cap is exact',near(f(0.3,0), 0.1 - 0.04, 1e-9), f(0.3,0).toFixed(6));
}
{
  const st = { t:'star', x:0, y:0, r:0.35, n:5, m:2.2, a:0 };
  const f = E(st);
  ok('star: centre is inside', f(0,0) < -0.05, f(0,0).toFixed(4));
  ok('star: far outside is positive', f(0.9,0.9) > 0.5, f(0.9,0.9).toFixed(4));
}

// -------------------------------------------- the eikonal property |grad| = 1
// A genuine signed distance field has unit gradient. This is the single test
// that separates a real SDF from something that merely has the right sign, and
// it is what makes contours, onioning and blending behave.
// A genuine signed distance field has unit gradient ALMOST everywhere. It is
// legitimately discontinuous on the medial axis -- the skeleton where the
// nearest-edge choice flips -- which a box, a ring and a capsule all have in
// their interiors. So the right assertion is the FRACTION of points that
// satisfy it, not the maximum error. This is what makes contours, onioning
// and smooth blending behave; a field that merely has the right sign does not.
function eikonal(spec, samples = 20000, skipNear = 0.012) {
  const f = E(spec);
  const h = 1e-4;
  let good = 0, n = 0, worst = 0;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < samples; k++) {
    const x = (rnd() - 0.5) * 1.6, y = (rnd() - 0.5) * 1.0;
    const d = f(x, y);
    if (Math.abs(d) < skipNear || Math.abs(d) > 0.6) continue;   // skip the rim and the far field
    const gx = (f(x + h, y) - f(x - h, y)) / (2 * h);
    const gy = (f(x, y + h) - f(x, y - h)) / (2 * h);
    const err = Math.abs(Math.hypot(gx, gy) - 1);
    if (err < 0.02) good++; else worst = Math.max(worst, err);
    n++;
  }
  return { frac: n ? good / n : 0, n, worst };
}
for (const [name, spec, floor] of [
  ['circle',  { t:'circle', x:0.1, y:-0.05, r:0.25 }, 0.999],
  ['box',     { t:'box', x:0, y:0, w:0.35, h:0.18, r:0.05 }, 0.97],
  ['hexagon', { t:'ngon', x:0, y:0, r:0.28, n:6, a:0.3 }, 0.98],
  ['pentagon',{ t:'ngon', x:0, y:0, r:0.26, n:5, a:0 }, 0.98],
  ['star',    { t:'star', x:0, y:0, r:0.3, n:5, m:2.4, a:0 }, 0.95],
  ['ring',    { t:'ring', x:0, y:0, r:0.3, th:0.07 }, 0.97],
  ['capsule', { t:'seg', x1:-0.25, y1:-0.1, x2:0.25, y2:0.12, th:0.09 }, 0.97],
  ['arc',     { t:'arc', x:0, y:0, r:0.3, th:0.06, ap:1.1, a:0 }, 0.95],
  ['union',   { t:'union', a:{ t:'circle', x:-0.15, y:0, r:0.2 }, b:{ t:'circle', x:0.15, y:0, r:0.2 } }, 0.98],
  ['subtract',{ t:'sub', a:{ t:'circle', x:0, y:0, r:0.3 }, b:{ t:'circle', x:0.2, y:0, r:0.15 } }, 0.97],
  ['rotated', { t:'xform', c:{ t:'box', x:0, y:0, w:0.3, h:0.15, r:0 },
                tx:0.05, ty:0.02, rot:0.7, sx:1, sy:1, kx:0, ky:0 }, 0.97],
  ['scaled',  { t:'xform', c:{ t:'circle', x:0, y:0, r:0.3 },
                tx:0, ty:0, rot:0, sx:0.6, sy:0.6, kx:0, ky:0 }, 0.999],
  ['onion',   { t:'onion', c:{ t:'ngon', x:0, y:0, r:0.28, n:6, a:0 }, th:0.05 }, 0.95],
  ['mirror',  { t:'mirror', c:{ t:'circle', x:0.3, y:0.1, r:0.15 }, mx:1, my:0 }, 0.97],
  ['polar x5',{ t:'polar', c:{ t:'circle', x:0.32, y:0, r:0.09 }, n:5, a:0 }, 0.93],
]) {
  const { frac, n, worst } = eikonal(spec);
  ok(`|grad|=1 almost everywhere: ${name}`, frac >= (floor === undefined ? 0.98 : floor),
     `${(frac * 100).toFixed(2)}% of ${n} pts (worst outlier ${worst.toFixed(3)})`);
}

// Non-uniform scale is deliberately NOT a true distance field -- it cannot be,
// since an ellipse has no closed-form distance. We guarantee only that it never
// OVERESTIMATES, which is the property contours actually depend on.
{
  const child = { t:'circle', x:0, y:0, r:0.25 };
  const sq = { t:'xform', c:child, tx:0, ty:0, rot:0, sx:1.8, sy:0.6, kx:0, ky:0 };
  const f = E(sq);
  let over = 0, tested = 0;
  for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) {
    const x = (i / 59 - 0.5) * 1.6, y = (j / 59 - 0.5) * 1.0;
    const d = f(x, y);
    if (!Number.isFinite(d)) { over++; continue; }
    // walk from the point toward the field's own estimate of the edge; if the
    // estimate overshot, the sign will have flipped before we get there
    const step = Math.abs(d) * 0.98;
    const g = 1e-4;
    const gx = (f(x + g, y) - f(x - g, y)) / (2 * g), gy = (f(x, y + g) - f(x, y - g)) / (2 * g);
    const gl = Math.hypot(gx, gy) || 1;
    const d2 = f(x - (gx / gl) * step * Math.sign(d), y - (gy / gl) * step * Math.sign(d));
    if (Math.sign(d2) !== Math.sign(d) && Math.abs(d2) > 1e-6) over++;
    tested++;
  }
  ok('non-uniform scale never overestimates distance', over === 0, `${over} overshoots in ${tested} pts`);
}

// ---------------------------------------------------------------- booleans
{
  const a = { t:'circle', x:-0.1, y:0, r:0.25 };
  const b = { t:'circle', x: 0.1, y:0, r:0.25 };
  ok('union: inside either is inside',      E({t:'union',a,b})(-0.3,0) < 0 && E({t:'union',a,b})(0.3,0) < 0);
  ok('intersect: only the lens is inside',  E({t:'inter',a,b})(0,0) < 0 && E({t:'inter',a,b})(-0.3,0) > 0);
  ok('subtract: b carves out of a',         E({t:'sub',a,b})(-0.3,0) < 0 && E({t:'sub',a,b})(0.05,0) > 0);
  const sb = E({ t:'blend', a, b, k:0.2 }), hb = E({ t:'union', a, b });
  ok('blend is never farther than min',     sb(0.0,0.26) <= hb(0.0,0.26) + 1e-12,
     `smooth ${sb(0,0.26).toFixed(4)} <= hard ${hb(0,0.26).toFixed(4)}`);
  ok('blend k=0 equals a hard union',       near(E({t:'blend',a,b,k:0})(0,0.1), hb(0,0.1), 1e-12));
}
{
  // onion turns any solid into a shell of the given thickness
  const f = E({ t:'onion', c:{ t:'circle', x:0, y:0, r:0.3 }, th:0.08 });
  ok('onion: shell straddles the old rim', f(0.3,0) < 0 && f(0,0) > 0 && f(0.5,0) > 0,
     `rim ${f(0.3,0).toFixed(3)} centre ${f(0,0).toFixed(3)}`);
  ok('onion: shell has the asked thickness', near(f(0.3 + 0.04, 0), 0, 1e-9), f(0.34,0).toFixed(6));
}
{
  // morph must pass through genuinely intermediate shapes
  const a = { t:'circle', x:0, y:0, r:0.3 };
  const b = { t:'box', x:0, y:0, w:0.3, h:0.3, r:0 };
  const m = t => E({ t:'morph', a, b, t2:t });
  ok('morph t=0 is the circle', near(m(0)(0.3,0), 0, 1e-9));
  ok('morph t=1 is the box',    near(m(1)(0.3,0), 0, 1e-9));
  const mid = m(0.5);
  ok('morph t=0.5 is neither',  mid(0.3,0.3) !== undefined && mid(0.3,0.3) < E(a)(0.3,0.3) && mid(0.3,0.3) > E(b)(0.3,0.3),
     `mid ${mid(0.3,0.3).toFixed(4)} between box ${E(b)(0.3,0.3).toFixed(4)} and circle ${E(a)(0.3,0.3).toFixed(4)}`);
}

// ---------------------------------------------------------------- transforms
{
  const base = { t:'circle', x:0, y:0, r:0.2 };
  const moved = { t:'xform', c:base, tx:0.3, ty:0.1, rot:0, sx:1, sy:1, kx:0, ky:0 };
  ok('xform: translation lands the centre', near(E(moved)(0.3,0.1), -0.2, 1e-9), E(moved)(0.3,0.1).toFixed(6));
  const scaled = { t:'xform', c:base, tx:0, ty:0, rot:0, sx:2, sy:2, kx:0, ky:0 };
  ok('xform: uniform scale x2 doubles r',   near(E(scaled)(0.4,0), 0, 1e-9), E(scaled)(0.4,0).toFixed(6));
  const rot = { t:'xform', c:{ t:'box', x:0, y:0, w:0.4, h:0.1, r:0 },
                tx:0, ty:0, rot:Math.PI/2, sx:1, sy:1, kx:0, ky:0 };
  ok('xform: 90 deg swaps the box axes',    near(E(rot)(0, 0.4), 0, 1e-9), E(rot)(0,0.4).toFixed(6));
}
{
  const m = { t:'mirror', c:{ t:'circle', x:0.3, y:0, r:0.15 }, mx:1, my:0 };
  ok('mirror: both sides are solid', E(m)(0.3,0) < 0 && E(m)(-0.3,0) < 0);
  const p = { t:'polar', c:{ t:'circle', x:0.3, y:0, r:0.08 }, n:4, a:0 };
  const f = E(p);
  ok('polar n=4: four lobes present',
     f(0.3,0) < 0 && f(-0.3,0) < 0 && f(0,0.3) < 0 && f(0,-0.3) < 0);
  ok('polar: the gaps are empty', f(0.212,0.212) > 0, f(0.212,0.212).toFixed(4));
}
{
  const r = { t:'repeat', c:{ t:'circle', x:0, y:0, r:0.05 }, px:0.3, py:0, nx:2, ny:0 };
  const f = E(r);
  ok('repeat: copies at 0, +-0.3, +-0.6', f(0,0) < 0 && f(0.3,0) < 0 && f(0.6,0) < 0);
  ok('repeat: stops at the limit',        f(0.9,0) > 0, f(0.9,0).toFixed(4));
}

// ---------------------------------------------------------------- raster
{
  const spec = { t:'circle', x:0, y:0, r:0.3 };
  const W = 256, H = 160;
  const f = rasterize(spec, W, H, curveAt);
  ok('rasterize fills the buffer', f.length === W * H, `${W}x${H}`);
  // centre of the raster is field (0,0), so it should read -r
  ok('raster centre reads -r', near(sampleField(f, W, H, 0.5, 0.5), -0.3, 0.01),
     sampleField(f, W, H, 0.5, 0.5).toFixed(4));
  // bilinear read agrees with direct evaluation away from creases
  let worst = 0;
  for (let k = 0; k < 500; k++) {
    const nx = 0.1 + 0.8 * (k % 25) / 24, ny = 0.1 + 0.8 * Math.floor(k / 25) / 19;
    const a = sampleField(f, W, H, nx, ny);
    const b = evalSpec(spec, toFieldX(nx), toFieldY(ny), curveAt);
    worst = Math.max(worst, Math.abs(a - b));
  }
  ok('half-res field reads within 1 raster cell', worst < 0.006, 'worst ' + worst.toFixed(5));
}
{
  // The reason half resolution is acceptable: reconstructed contours stay put.
  const spec = { t:'ngon', x:0, y:0, r:0.3, n:5, a:0.4 };
  const lo = rasterize(spec, 128, 80, curveAt);
  let worst = 0;
  for (let k = 0; k < 400; k++) {
    const nx = 0.15 + 0.7 * (k % 20) / 19, ny = 0.15 + 0.7 * Math.floor(k / 20) / 19;
    worst = Math.max(worst, Math.abs(sampleField(lo, 128, 80, nx, ny)
                                   - evalSpec(spec, toFieldX(nx), toFieldY(ny), curveAt)));
  }
  ok('quarter-res pentagon still within a cell', worst < 0.02, 'worst ' + worst.toFixed(5));
}

// ---------------------------------------------------------------- drawn shape
{
  const cv = makeCurve('flat');                      // constant 0.5
  const spec = { t:'pcurve', x:0, y:0, cv, r0:0.1, r1:0.5, a:0 };
  const f = E(spec);
  // r = 0.1 + (0.5-0.1)*0.5 = 0.3 at every angle, so it is a circle
  ok('drawn curve, flat at 0.5, is a circle of r=0.3',
     near(f(0.3,0), 0, 1e-9) && near(f(0,0.3), 0, 1e-9), f(0.3,0).toFixed(6));
  const bump = makeCurve('flat').slice();
  bump[0] = 1;                                        // push out the angle-0 spoke
  const g = E({ t:'pcurve', x:0, y:0, cv:bump, r0:0.1, r1:0.5, a:0 });
  ok('drawn curve: a drawn bump pushes that spoke out', g(0.45, 0) < 0, g(0.45,0).toFixed(4));
}

// ---------------------------------------------------------------- guards
{
  ok('NOTHING is a shape value', isShape(NOTHING) && depthOf(NOTHING) === 1);
  ok('NOTHING is infinitely far', E(NOTHING.d)(0,0) > 1e8);
  ok('union with NOTHING is identity',
     near(E({ t:'union', a:{t:'circle',x:0,y:0,r:0.3}, b:NOTHING.d })(0.4,0), 0.1, 1e-9));
  ok('morph with NOTHING keeps the real side',
     near(E({ t:'morph', a:{t:'circle',x:0,y:0,r:0.3}, b:NOTHING.d, t2:0.5 })(0.4,0), 0.1, 1e-9));
  ok('evalSpec survives a null spec', evalSpec(null, 0, 0, curveAt) > 1e8);
  ok('evalSpec survives an unknown type', evalSpec({t:'nope'}, 0, 0, curveAt) > 1e8);
  ok('degenerate radius does not produce NaN', Number.isFinite(E({t:'circle',x:0,y:0,r:0})(0,0)));
  ok('zero scale does not produce NaN',
     Number.isFinite(E({t:'xform',c:{t:'circle',x:0,y:0,r:0.2},tx:0,ty:0,rot:0,sx:0,sy:0,kx:0,ky:0})(0,0)));
  ok('degenerate skew does not produce NaN',
     Number.isFinite(E({t:'xform',c:{t:'circle',x:0,y:0,r:0.2},tx:0,ty:0,rot:0,sx:1,sy:1,kx:1,ky:1})(0.1,0.1)));
  ok('aspect correction is 1.6', near(ASPECT, 1.6, 1e-12), ASPECT);
  ok('field space maps raster centre to origin',
     near(toFieldX(0.5), 0, 1e-12) && near(toFieldY(0.5), 0, 1e-12));
}

// ---------------------------------------------------------------- smin/smax
{
  ok('smin(a,b,0) is min',  near(smin(0.3, 0.5, 0), 0.3, 1e-12));
  ok('smax(a,b,0) is max',  near(smax(0.3, 0.5, 0), 0.5, 1e-12));
  ok('smin is <= min',      smin(0.3, 0.31, 0.2) <= 0.3);
  ok('smin far apart = min',near(smin(0.1, 5, 0.2), 0.1, 1e-12));
}

// ---------------------------------------------------------------- cost
{
  const spec = { t:'blend',
    a:{ t:'polar', c:{ t:'star', x:0.3, y:0, r:0.12, n:5, m:2.2, a:0 }, n:6, a:0 },
    b:{ t:'onion', c:{ t:'ngon', x:0, y:0, r:0.25, n:7, a:0 }, th:0.03 }, k:0.1 };
  const t0 = performance.now();
  let buf = null;
  for (let k = 0; k < 20; k++) buf = rasterize(spec, 256, 160, curveAt, buf);
  const ms = (performance.now() - t0) / 20;
  ok('a deep shape rasterizes inside a frame budget', ms < 12, ms.toFixed(2) + ' ms/frame at 256x160');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
