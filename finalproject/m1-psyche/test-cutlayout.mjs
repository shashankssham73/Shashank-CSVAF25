// test-cutlayout.mjs — the geometry, checked.
//
// Cuts either conserve area or they do not, and a layout that loses a few
// percent per cut looks fine for three cuts and absurd by twenty. Most of
// these assert conservation rather than coordinates.

import * as L from './cutlayout.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  — ' + extra : '')); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const A = p => Math.abs(L.area(p));

console.log('\nshapes');
ok('a unit rect has area 1', near(A(L.rectPoly(0, 0, 1, 1)), 1));
ok('a half rect has area 0.5', near(A(L.rectPoly(0, 0, 0.5, 1)), 0.5));
{
  const c = L.ellipsePoly(0.5, 0.5, 0.5, 0.5, 256);
  // An inscribed n-gon is SMALLER than its circle by (2*pi/n)^2/6, which at
  // n=256 is 1.00e-4 exactly. Asserting tighter than that tests arithmetic,
  // not the code.
  ok('a 256-gon circle is within 0.02% of pi r^2',
     Math.abs(A(c) - Math.PI * 0.25) / (Math.PI * 0.25) < 2e-4,
     'got ' + A(c).toFixed(6));
}
ok('a hexagon has 6 points', L.ngonPoly(0.5, 0.5, 0.3, 6).length === 6);
ok('a 5-point star has 10 points', L.starPoly(0.5, 0.5, 0.3, 5).length === 10);
ok('a star is smaller than its circumcircle',
   A(L.starPoly(0.5, 0.5, 0.3, 5)) < Math.PI * 0.09);

console.log('\ncentroid and bounds');
{
  const [cx, cy] = L.centroid(L.rectPoly(0.2, 0.4, 0.4, 0.2));
  ok('rect centroid is its middle', near(cx, 0.4) && near(cy, 0.5));
  const b = L.bbox(L.ngonPoly(0.5, 0.5, 0.25, 7));
  ok('a heptagon fits its bounding box', b.w <= 0.5001 && b.h <= 0.5001);
}

console.log('\nhit testing');
{
  const r = L.rectPoly(0.25, 0.25, 0.5, 0.5);
  ok('inside is inside', L.pointIn(r, 0.5, 0.5));
  ok('outside is outside', !L.pointIn(r, 0.1, 0.5));
  ok('just outside a corner is outside', !L.pointIn(r, 0.2499, 0.2499));
  const c = L.ellipsePoly(0.5, 0.5, 0.3, 0.3, 128);
  ok('a circle rejects its bounding-box corner', !L.pointIn(c, 0.21, 0.21));
  ok('a circle accepts its centre', L.pointIn(c, 0.5, 0.5));
}

console.log('\nthe cut');
{
  const sheet = L.rectPoly(0, 0, 1, 1);
  const [a, b] = L.slice(sheet, 0.5, 0, 0.5, 1);
  ok('a vertical cut halves the sheet', near(A(a), 0.5) && near(A(b), 0.5),
     `${A(a).toFixed(4)} / ${A(b).toFixed(4)}`);
  ok('the two halves still add to the whole', near(A(a) + A(b), 1));

  const [d, e] = L.slice(sheet, 0, 0, 1, 1);
  ok('a diagonal cut makes two triangles', near(A(d), 0.5) && near(A(e), 0.5));
  ok('triangles have 3 points, not duplicated corners',
     d.length === 3 && e.length === 3, `${d.length} / ${e.length}`);

  const [f, g] = L.slice(sheet, 0.3, 0, 0.7, 1);
  ok('a slanted cut conserves area', near(A(f) + A(g), 1));

  const [m, n] = L.slice(sheet, 2, 0, 2, 1);
  ok('a cut that misses leaves one side empty',
     (m.length < 3) !== (n.length < 3), `${m.length} / ${n.length}`);
}

console.log('\ncutting a cut piece');
{
  // The point of using polygons throughout: a piece cut from a cut piece
  // goes through the same code, however odd its shape has become.
  let poly = L.rectPoly(0, 0, 1, 1);
  let total = 1, pieces = [poly];
  for (let i = 0; i < 12; i++) {
    const victim = pieces.pop();
    const [x, y] = L.centroid(victim);
    const ang = i * 0.7;
    const [p, q] = L.slice(victim, x - Math.cos(ang), y - Math.sin(ang),
                                   x + Math.cos(ang), y + Math.sin(ang));
    if (p.length >= 3) pieces.unshift(p);
    if (q.length >= 3) pieces.unshift(q);
  }
  const sum = pieces.reduce((s, p) => s + A(p), 0);
  ok('12 successive cuts conserve the sheet exactly', near(sum, total, 1e-9),
     'sum ' + sum.toFixed(12));
  ok('12 cuts produce 13 pieces', pieces.length === 13, 'got ' + pieces.length);
}

console.log('\nlayouts');
{
  const lay = L.newLayout();
  ok('a new layout is one whole sheet',
     lay.panes.length === 1 && near(A(lay.panes[0].poly), 1));

  const r = L.cutPane(lay, lay.panes[0].id, 0.4, 0, 0.4, 1);
  ok('cutting a pane yields two panes', !!r && lay.panes.length === 2);
  ok('ids stay unique', new Set(lay.panes.map(p => p.id)).size === lay.panes.length);
  ok('cut panes still cover the sheet',
     near(lay.panes.reduce((s, p) => s + A(p.poly), 0), 1));

  const tiny = L.cutPane(lay, lay.panes[0].id, 0.0001, 0, 0.0001, 1);
  ok('a cut too close to the edge is refused', tiny === null);

  ok('paneAt finds the left pane', L.paneAt(lay, 0.2, 0.5).id === lay.panes[0].id);
  ok('paneAt finds the right pane', L.paneAt(lay, 0.8, 0.5).id === lay.panes[1].id);
  ok('paneAt off the sheet finds nothing', L.paneAt(lay, 1.5, 0.5) === null);

  const coveredBefore = lay.panes.reduce((s, p) => s + A(p.poly), 0);
  const hole = L.punch(lay, L.ellipsePoly(0.5, 0.5, 0.18, 0.18, 64), 'hole');
  ok('punching adds a pane', lay.panes.includes(hole));
  ok('punching is marked as placed, not cut', hole.placed === true);
  // A placed shape sits on top rather than being subtracted, so the pieces
  // underneath keep every bit of their area. Slide it away and what was
  // below is still whole.
  const base = lay.panes.filter(p => !p.placed).reduce((s, p) => s + A(p.poly), 0);
  ok('placing a shape takes nothing away from the pieces below',
     near(base, coveredBefore), `${base.toFixed(6)} vs ${coveredBefore.toFixed(6)}`);
  ok('the punched pane is on top', lay.panes[lay.panes.length - 1] === hole);
  ok('paneAt picks the punched pane over what it sits on',
     L.paneAt(lay, 0.5, 0.5).id === hole.id);

  const before = lay.panes.length;
  L.removePane(lay, hole.id);
  ok('removing a pane removes exactly one', lay.panes.length === before - 1);

  while (lay.panes.length > 1) L.removePane(lay, lay.panes[0].id);
  ok('the last pane cannot be removed', !L.removePane(lay, lay.panes[0].id));
}

console.log('\nmoving and ordering');
{
  const lay = L.newLayout();
  L.cutPane(lay, lay.panes[0].id, 0.5, 0, 0.5, 1);
  const [p, q] = lay.panes;
  const a0 = A(p.poly);
  L.movePane(lay, p.id, 0.1, -0.05);
  ok('moving preserves area', near(A(p.poly), a0));
  ok('moving actually moves', near(L.bbox(p.poly).x, 0.1));
  ok('raise puts a pane last', L.raisePane(lay, p.id) && lay.panes[1] === p);
  ok('raising the top pane is a no-op', !L.raisePane(lay, p.id));
}

console.log('\nsaving and loading');
{
  const lay = L.newLayout();
  L.cutPane(lay, lay.panes[0].id, 0.5, 0, 0.5, 1);
  L.punch(lay, L.starPoly(0.3, 0.3, 0.15, 5), 'star');
  lay.panes[0].name = 'left';
  lay.panes[0].source = { t: 'window', app: 'Brave' };
  const round = L.fromJSON(JSON.parse(JSON.stringify(L.toJSON(lay))));
  ok('pane count survives a round trip', round.panes.length === lay.panes.length);
  ok('names survive', round.panes[0].name === 'left');
  ok('sources survive', round.panes[0].source.app === 'Brave');
  ok('geometry survives to a tenth of a pixel',
     near(A(round.panes[0].poly), A(lay.panes[0].poly), 1e-4));
  ok('a corrupt layout falls back to a whole sheet',
     L.fromJSON({ panes: [{ poly: [[0, 0]] }] }).panes.length === 1);
  ok('null falls back to a whole sheet', L.fromJSON(null).panes.length === 1);
}

console.log('\ncarrying the picture');
{
  const lay = L.newLayout();
  L.cutPane(lay, lay.panes[0].id, 0.5, 0, 0.5, 1);
  const p = lay.panes[0];
  ok('a fresh pane samples where it sits', p.off[0] === 0 && p.off[1] === 0);
  L.movePane(lay, p.id, 0.2, 0.1);
  ok('moving carries the picture by default', near(p.off[0], 0.2) && near(p.off[1], 0.1));
  L.movePane(lay, p.id, -0.2, -0.1, false);
  ok('moving without carrying leaves the picture put',
     near(p.off[0], 0.2) && near(p.off[1], 0.1));
  ok('the outline still moved back', near(L.bbox(p.poly).x, 0));
  const back = L.fromJSON(JSON.parse(JSON.stringify(L.toJSON(lay))));
  ok('the offset survives a round trip', near(back.panes[0].off[0], 0.2));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
