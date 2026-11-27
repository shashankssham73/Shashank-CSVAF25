// cutlayout.js — the paper, and the cuts in it.
//
// One screen, cut into pieces, each piece showing something different. The
// metaphor is a sheet of paper: you do not place windows on it, you CUT it,
// and the pieces are what you get.
//
// Every region is a polygon. Not a rectangle with special cases for the
// round ones — a polygon, always, with circles and stars approximated by
// enough points that the difference is invisible at screen size. That one
// decision is why slicing works on any shape: a cut is a half-plane clip,
// and a half-plane clip of a polygon is a polygon, so a cut piece can be cut
// again with the same code.
//
//   SLICE   drag a line across a piece   -> two pieces
//   PUNCH   drop a shape onto the sheet  -> that shape becomes a piece
//
// Coordinates are 0..1 of the sheet, so a layout survives a change of
// display, and the whole file is pure geometry: no canvas, no DOM, testable
// in Node.

export const TAU = Math.PI * 2;

// ------------------------------------------------------------------ shapes
// All of these return a polygon: an array of [x, y] in 0..1.

export function rectPoly(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

export function ellipsePoly(cx, cy, rx, ry, n = 64) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return p;
}

export function ngonPoly(cx, cy, r, n = 6, rot = 0, aspect = 1) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU - Math.PI / 2;
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * aspect]);
  }
  return p;
}

export function starPoly(cx, cy, r, points = 5, inner = 0.45, rot = 0, aspect = 1) {
  const p = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * TAU - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * aspect]);
  }
  return p;
}

// ------------------------------------------------------------- measurements
// Signed area, so winding order is recoverable. Positive is clockwise in
// screen coordinates, where y grows downward.
export function area(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-12) {              // degenerate: fall back to the mean
    let mx = 0, my = 0;
    for (const [x, y] of poly) { mx += x; my += y; }
    return [mx / poly.length, my / poly.length];
  }
  a *= 3;
  return [cx / a, cy / a];
}

export function bbox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Ray casting. On an exact edge the answer is arbitrary, which for picking a
// pane with the mouse is a pixel nobody can aim at.
export function pointIn(poly, px, py) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py)
        && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-18) + xi) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------------- the cut
// Sutherland–Hodgman against one half-plane. `side` +1 keeps the left of the
// directed line a->b, -1 the right.
export function clipHalfPlane(poly, ax, ay, bx, by, side = 1) {
  const dx = bx - ax, dy = by - ay;
  const where = ([x, y]) => side * ((x - ax) * dy - (y - ay) * dx);
  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const cur = poly[i], prv = poly[(i + n - 1) % n];
    const dc = where(cur), dp = where(prv);
    if (dc <= 0) {                                  // current is kept
      if (dp > 0) out.push(cross(prv, cur, dp, dc));
      out.push(cur);
    } else if (dp <= 0) {
      out.push(cross(prv, cur, dp, dc));
    }
  }
  return clean(out);
}

// A cut that passes exactly through a corner emits that corner twice, and a
// cut parallel to an edge leaves a point in the middle of a straight line.
// Neither changes the area, and both accumulate: after twenty cuts a simple
// quadrilateral can be carrying a dozen vertices that do nothing. Tidy once,
// here, where every cut has to come through anyway.
//
// The collinearity threshold is on twice the triangle area. Three adjacent
// points of a 256-gon of radius 0.5 span about 2.3e-7, so a circle keeps all
// of its points; only genuinely redundant ones go.
export function clean(poly, eps = 1e-9) {
  if (poly.length < 3) return poly;
  const out = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-12 && Math.abs(q[1] - p[1]) < 1e-12) continue;
    out.push(p);
  }
  while (out.length > 1) {                    // the seam, first against last
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) out.pop();
    else break;
  }
  if (out.length < 3) return out;
  const keep = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
    const twice = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
    if (twice > eps) keep.push(b);
  }
  return keep.length >= 3 ? keep : out;
}

function cross(p, c, dp, dc) {
  const t = dp / (dp - dc);
  return [p[0] + (c[0] - p[0]) * t, p[1] + (c[1] - p[1]) * t];
}

// A cut: one polygon becomes two. Either side can come back empty when the
// line misses, and the caller decides what that means.
export function slice(poly, ax, ay, bx, by) {
  return [clipHalfPlane(poly, ax, ay, bx, by,  1),
          clipHalfPlane(poly, ax, ay, bx, by, -1)];
}

// ------------------------------------------------------------------ layouts
let seq = 0;
const nextId = () => `cut${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newLayout() {
  return { v: 1, panes: [pane(rectPoly(0, 0, 1, 1), 'the sheet')] };
}

export function pane(poly, name = '') {
  return {
    id: nextId(),
    poly,
    name,
    // What shows inside. Filled in by the next stage; a pane with no source
    // shows the screen underneath it, which is the sensible default for a
    // cut in a sheet laid over the desktop.
    source: null,
    effect: null,
    hidden: false,
    // Where this piece samples its picture from. Paper, not glass: cut a
    // piece out and slide it, and the picture goes with it, leaving the
    // piece showing the same thing somewhere else. Holding the offset still
    // while the outline moves is the other gesture — a window onto a fixed
    // picture rather than a cut-out of it.
    off: [0, 0],
  };
}

// The piece under a point, topmost first — later panes are drawn over
// earlier ones, so they are picked first too.
export function paneAt(layout, x, y) {
  for (let i = layout.panes.length - 1; i >= 0; i--) {
    const p = layout.panes[i];
    if (!p.hidden && pointIn(p.poly, x, y)) return p;
  }
  return null;
}

// Cut one pane in two. The original keeps its id and settings; the new piece
// inherits them, because cutting a window in half should give you two of
// that window, not one of it and one empty.
export function cutPane(layout, id, ax, ay, bx, by, minArea = 0.0008) {
  const i = layout.panes.findIndex(p => p.id === id);
  if (i < 0) return null;
  const p = layout.panes[i];
  const [a, b] = slice(p.poly, ax, ay, bx, by);
  if (a.length < 3 || b.length < 3) return null;
  if (Math.abs(area(a)) < minArea || Math.abs(area(b)) < minArea) return null;
  const q = { ...p, id: nextId(), poly: b };
  p.poly = a;
  layout.panes.splice(i + 1, 0, q);
  return [p, q];
}

// Drop a shape onto the sheet as its own piece.
//
// This does NOT cut the shape out of what is underneath, and that is a
// decision rather than a shortcut. Subtracting a shape from a polygon is
// exact only when the cutter is convex. A star is not, and an approximation
// that keeps the largest surviving fragment leaves black wedges wherever the
// rest used to be — clearly visible the first time you punch one.
//
// Correct non-convex subtraction needs a real clipping algorithm, and for a
// collage it would also be the wrong behaviour: slide a punched circle away
// and you want the thing underneath to still be whole, not holed.
//
// So a placed piece sits ON TOP. Slices tile exactly; placed shapes overlap.
// Picking already honours that, because paneAt walks from the top down.
export function punch(layout, poly, name = '') {
  const q = pane(poly, name);
  q.placed = true;
  layout.panes.push(q);
  return q;
}

export function removePane(layout, id) {
  const i = layout.panes.findIndex(p => p.id === id);
  if (i < 0 || layout.panes.length <= 1) return false;
  layout.panes.splice(i, 1);
  return true;
}

export function movePane(layout, id, dx, dy, carry = true) {
  const p = layout.panes.find(q => q.id === id);
  if (!p) return false;
  p.poly = p.poly.map(([x, y]) => [x + dx, y + dy]);
  if (carry) p.off = [(p.off ? p.off[0] : 0) + dx, (p.off ? p.off[1] : 0) + dy];
  return true;
}

export function raisePane(layout, id) {
  const i = layout.panes.findIndex(p => p.id === id);
  if (i < 0 || i === layout.panes.length - 1) return false;
  layout.panes.push(layout.panes.splice(i, 1)[0]);
  return true;
}

// ------------------------------------------------------------ serialisation
export function toJSON(layout) {
  return { v: 1, panes: layout.panes.map(p => ({
    id: p.id, name: p.name, hidden: !!p.hidden,
    source: p.source, effect: p.effect, off: p.off || [0, 0],
    // Five decimals is a tenth of a pixel on a 5K display and keeps a
    // 40-pane layout under a few KB.
    poly: p.poly.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]),
  })) };
}

export function fromJSON(j) {
  if (!j || !Array.isArray(j.panes) || !j.panes.length) return newLayout();
  const panes = j.panes
    .filter(p => Array.isArray(p.poly) && p.poly.length >= 3)
    .map(p => ({
      id: p.id || nextId(),
      name: p.name || '',
      hidden: !!p.hidden,
      source: p.source || null,
      effect: p.effect || null,
      off: Array.isArray(p.off) ? [+p.off[0] || 0, +p.off[1] || 0] : [0, 0],
      poly: p.poly.map(([x, y]) => [+x, +y]),
    }));
  return panes.length ? { v: 1, panes } : newLayout();
}
