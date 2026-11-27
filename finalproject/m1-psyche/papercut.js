// papercut.js — the sheet, and the tools that cut it.
//
// The model lives in cutlayout.js and knows nothing about canvases. This is
// the hand: pointer events in, cuts out, and one draw pass that clips the
// live screen into each piece.
//
// The gesture that matters is MOVE. A piece carries its picture with it, so
// sliding one leaves it showing the same thing in a new place — paper, not
// glass. Hold shift and the outline moves while the picture stays put, which
// turns the piece into a window onto a fixed image instead.

import * as L from './cutlayout.js';
import { ScreenCapture, NativeFeed } from './capture.js';

const cv = document.getElementById('sheet');
const ctx = cv.getContext('2d');
const $ = s => document.querySelector(s);

let W = 0, H = 0, DPR = 1;
let layout = L.newLayout();
let tool = 'cut';
let selected = null;
let drag = null;
let hover = null;
let status = 'cut across the sheet to divide it';
// Radius of a punched shape, in sheet-x units. 0.13 covered a third of the
// screen, which is a lot of sheet to lose to one click.
let punchR = 0.08;
let cursor = null;
const FULL = { x: 0, y: 0, w: 1, h: 1 };
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
// The piece being cropped, and the rectangle being dragged over its window.
let cropping = null, cropDrag = null;

const cap = new ScreenCapture();
const nat = new NativeFeed();
const src = () => (nat.active ? nat : cap);
const haveSource = () => src().ready;

// One feed per window that some pane is showing — started on demand and
// stopped when the last pane using it goes away, so a collage costs exactly
// as many streams as it has distinct windows in it.
const winFeeds = new Map();
function feedFor(id) {
  let f = winFeeds.get(id);
  if (!f) {
    f = new NativeFeed(id);
    winFeeds.set(id, f);
    f.start({ fps: 20, width: 900 }).then(ok => {
      if (!ok) say('could not open that window: ' + (f.error || 'unknown'));
    });
  }
  return f;
}
function reapFeeds() {
  const used = new Set(layout.panes.filter(p => p.source && p.source.t === 'window')
                                   .map(p => p.source.id));
  for (const [id, f] of winFeeds) {
    if (!used.has(id)) { f.stop(); winFeeds.delete(id); }
  }
}

// ------------------------------------------------------------------ canvas
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.floor(innerWidth * DPR);
  H = Math.floor(innerHeight * DPR);
  cv.width = W; cv.height = H;
}
addEventListener('resize', resize);
resize();

// Sheet space is 0..1 on the LONGER axis-preserving box that fills the
// window, so a layout looks the same whatever shape the window is.
const toSheet = (px, py) => [px * DPR / W, py * DPR / H];
const toPx = (x, y) => [x * W, y * H];

// ------------------------------------------------------------------- paint
function tracePoly(c, poly) {
  c.beginPath();
  poly.forEach(([x, y], i) => {
    const [px, py] = toPx(x, y);
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  });
  c.closePath();
}

// A stable colour per pane, so pieces stay recognisable as you cut and the
// eye can follow one across a rearrangement.
function hueOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function draw() {
  requestAnimationFrame(draw);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(0, 0, W, H);

  const ready = haveSource();
  for (const p of layout.panes) {
    if (p.hidden || p.poly.length < 3) continue;
    const hue = hueOf(p.id);
    ctx.save();
    tracePoly(ctx, p.poly);
    ctx.clip();
    const wf = p.source && p.source.t === 'window' ? feedFor(p.source.id) : null;
    if (wf && wf.ready) {
      // A window fills its own piece rather than being placed on the sheet:
      // you chose that window for that shape, so it should be framed by it.
      // A crop narrows that to part of the window — one column, one panel,
      // the video and none of the chrome.
      const b = L.bbox(p.poly);
      const [bw, bh] = [b.w * W, b.h * H];
      const c = (p.source && p.source.crop) || FULL;
      const sx = c.x * wf.w, sy = c.y * wf.h;
      const sw = Math.max(1, c.w * wf.w), sh = Math.max(1, c.h * wf.h);
      const s = Math.max(bw / sw, bh / sh);              // cover, not contain
      const dw = sw * s, dh = sh * s;
      ctx.drawImage(wf.bmp, sx, sy, sw, sh,
                    b.x * W + (bw - dw) / 2, b.y * H + (bh - dh) / 2, dw, dh);
    } else if (ready) {
      // The offset is what makes a piece a cut-out: it samples the picture
      // from where the piece came from, not from where it now sits.
      const [ox, oy] = p.off || [0, 0];
      ctx.translate(ox * W, oy * H);
      src().draw(ctx, W, H);
    } else {
      ctx.fillStyle = `hsl(${hue} 32% 16%)`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    // outline
    ctx.save();
    tracePoly(ctx, p.poly);
    const on = selected === p.id, hot = hover === p.id;
    const target = dropTarget === p.id;
    ctx.strokeStyle = target ? '#7fe0b8'
                    : on ? '#ffd27f' : hot ? `hsl(${hue} 70% 68%)` : `hsl(${hue} 50% 48% / 0.75)`;
    ctx.lineWidth = (target ? 4 : on ? 2.5 : 1.5) * DPR;
    ctx.stroke();
    if (target) { ctx.fillStyle = 'rgba(127,224,184,0.16)'; ctx.fill(); }
    ctx.restore();

    if (wf && !wf.ready) {
      const [cx, cy] = L.centroid(p.poly);
      const [px, py] = toPx(cx, cy);
      ctx.font = `${11 * DPR}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,190,110,0.9)';
      ctx.fillText(wf.suspended ? 'hidden — bring that window forward' : 'opening…', px, py);
    } else if (p.name) {
      const [cx, cy] = L.centroid(p.poly);
      const [px, py] = toPx(cx, cy);
      ctx.font = `${11 * DPR}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(p.name, px, py);
    }
  }

  // the shape about to be placed, under the cursor
  if (PUNCH[tool] && cursor && !drag) {
    ctx.save();
    tracePoly(ctx, PUNCH[tool](cursor[0], cursor[1], punchR, W / H));
    ctx.strokeStyle = 'rgba(255,210,127,0.85)';
    ctx.lineWidth = 1.5 * DPR;
    ctx.setLineDash([6 * DPR, 5 * DPR]);
    ctx.stroke();
    ctx.restore();
  }

  // the cut being dragged
  if (drag && drag.kind === 'cut') {
    const [ax, ay] = toPx(drag.a[0], drag.a[1]);
    const [bx, by] = toPx(drag.b[0], drag.b[1]);
    ctx.save();
    ctx.strokeStyle = '#ffd27f';
    ctx.lineWidth = 1.5 * DPR;
    ctx.setLineDash([8 * DPR, 6 * DPR]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.restore();
  }

  // ---- crop editor ---------------------------------------------------
  // Drawn over the sheet rather than in a panel: you are choosing a part of
  // a picture, so the picture should be as big as the screen allows.
  if (cropping) {
    const p = layout.panes.find(q => q.id === cropping);
    const wf = p && p.source ? winFeeds.get(p.source.id) : null;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(6,9,14,0.93)';
    ctx.fillRect(0, 0, W, H);
    if (wf && wf.ready) {
      const r = cropRect(wf);
      ctx.drawImage(wf.bmp, r.x, r.y, r.w, r.h);
      const c = (p.source.crop) || FULL;
      // everything outside the crop, dimmed
      ctx.fillStyle = 'rgba(6,9,14,0.72)';
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.rect(r.x + c.x * r.w, r.y + c.y * r.h, c.w * r.w, c.h * r.h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#7fe0b8';
      ctx.lineWidth = 2 * DPR;
      ctx.strokeRect(r.x + c.x * r.w, r.y + c.y * r.h, c.w * r.w, c.h * r.h);
      ctx.strokeStyle = 'rgba(127,224,184,0.35)';
      ctx.lineWidth = 1 * DPR;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.fillStyle = 'rgba(207,224,234,0.92)';
    ctx.font = `${13 * DPR}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(wf && wf.ready
      ? 'drag a rectangle over the part you want  ·  enter to keep  ·  a for all  ·  esc to cancel'
      : 'waiting for that window…', W / 2, 34 * DPR);
    ctx.restore();
  }

  // readout
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${11 * DPR}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(120,170,200,0.75)';
  // Cut pieces tile the sheet exactly, so their areas are worth reporting as
  // a percentage. Placed shapes sit on top and would push it past 100, so
  // they are counted separately rather than folded in.
  const cutPanes = layout.panes.filter(p => !p.placed);
  const placed = layout.panes.length - cutPanes.length;
  const covered = cutPanes.reduce((s, p) => s + Math.abs(L.area(p.poly)), 0);
  ctx.fillText(
    `${cutPanes.length} cut${placed ? ` · ${placed} placed` : ''}  ·  `
    + `${(covered * 100).toFixed(1)}% of the sheet  ·  `
    + `${ready ? src().label : 'no source — pick one above'}  ·  ${status}`,
    14 * DPR, H - 14 * DPR);
}

// ------------------------------------------------------------------ gesture
cv.addEventListener('pointermove', e => {
  const [x, y] = toSheet(e.clientX, e.clientY);
  if (cropping) {
    if (!cropDrag) return;
    const p = layout.panes.find(q => q.id === cropping);
    const wf = p && p.source ? winFeeds.get(p.source.id) : null;
    if (!wf || !wf.ready) return;
    const r = cropRect(wf);
    const px = e.clientX * DPR, py = e.clientY * DPR;
    const u0 = clamp01((cropDrag.x - r.x) / r.w), v0 = clamp01((cropDrag.y - r.y) / r.h);
    const u1 = clamp01((px - r.x) / r.w),         v1 = clamp01((py - r.y) / r.h);
    p.source.crop = { x: Math.min(u0, u1), y: Math.min(v0, v1),
                      w: Math.abs(u1 - u0), h: Math.abs(v1 - v0) };
    return;
  }
  if (drag) {
    if (drag.kind === 'cut') drag.b = [x, y];
    else if (drag.kind === 'move') {
      L.movePane(layout, drag.id, x - drag.last[0], y - drag.last[1], !e.shiftKey);
      drag.last = [x, y];
    }
    return;
  }
  cursor = [x, y];
  const p = L.paneAt(layout, x, y);
  hover = p ? p.id : null;
  cv.style.cursor = tool === 'cut' ? 'crosshair' : tool === 'move' ? 'grab'
                  : tool === 'use' ? 'pointer' : 'copy';
});

// Scroll to size the next shape. Shown live in the readout, because a size
// you cannot see until after you have placed it is a guess.
cv.addEventListener('wheel', e => {
  if (tool === 'use') {
    e.preventDefault();
    poke('scroll', e.clientX * DPR, e.clientY * DPR,
         '&dy=' + Math.max(-6, Math.min(6, Math.round(-e.deltaY / 40))));
    return;
  }
  if (!PUNCH[tool]) return;
  e.preventDefault();
  punchR = Math.max(0.02, Math.min(0.45, punchR * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
  say(`${tool} · ${(punchR * 200).toFixed(0)}% wide — click to place`);
}, { passive: false });

cv.addEventListener('pointerdown', e => {
  if (cropping) {
    cropDrag = { x: e.clientX * DPR, y: e.clientY * DPR };
    cv.setPointerCapture(e.pointerId);
    return;
  }
  const [x, y] = toSheet(e.clientX, e.clientY);
  const p = L.paneAt(layout, x, y);
  cv.setPointerCapture(e.pointerId);

  // With the picker open, a click selects rather than cuts: you are aiming
  // at a piece, not making a new one.
  if (picking) { if (p) { selected = p.id; say(`piece selected — now click a window`); } return; }
  if (tool === 'use') { poke('click', e.clientX * DPR, e.clientY * DPR); return; }
  if (tool === 'cut') { drag = { kind: 'cut', a: [x, y], b: [x, y] }; return; }
  if (tool === 'move') {
    if (!p) return;
    selected = p.id;
    drag = { kind: 'move', id: p.id, last: [x, y] };
    cv.style.cursor = 'grabbing';
    return;
  }
  if (tool === 'delete') {
    if (p && L.removePane(layout, p.id)) { say(`removed a piece`); if (selected === p.id) selected = null; }
    else say('the last piece cannot be removed');
    return;
  }
  // a punch tool: the shape is centred where you pressed
  punchAt(x, y);
});

addEventListener('pointerup', () => {
  if (cropping) {
    // A click with no drag means "all of it" rather than a zero-size crop,
    // which would otherwise show one pixel stretched across the piece.
    const p = layout.panes.find(q => q.id === cropping);
    if (p && p.source && p.source.crop
        && (p.source.crop.w < 0.01 || p.source.crop.h < 0.01)) delete p.source.crop;
    cropDrag = null;
    return;
  }
  if (drag && drag.kind === 'cut') {
    const [ax, ay] = drag.a, [bx, by] = drag.b;
    const far = Math.hypot(bx - ax, by - ay) > 0.02;
    drag = null;
    if (!far) { say('drag further — a cut needs a direction'); return; }
    // Cut every piece the line crosses, so one stroke divides the sheet
    // rather than only the piece you started on.
    let n = 0;
    for (const p of [...layout.panes]) if (L.cutPane(layout, p.id, ax, ay, bx, by)) n++;
    say(n ? `cut ${n} piece${n === 1 ? '' : 's'}` : 'that cut missed everything');
    return;
  }
  if (drag) { drag = null; cv.style.cursor = 'grab'; }
});

const PUNCH = {
  circle:  (x, y, r, a) => L.ellipsePoly(x, y, r, r * a, 64),
  hexagon: (x, y, r, a) => L.ngonPoly(x, y, r, 6, 0, a),
  triangle:(x, y, r, a) => L.ngonPoly(x, y, r, 3, 0, a),
  star:    (x, y, r, a) => L.starPoly(x, y, r, 5, 0.45, 0, a),
  square:  (x, y, r, a) => L.rectPoly(x - r, y - r * a, r * 2, r * 2 * a),
};

function punchAt(x, y) {
  const make = PUNCH[tool];
  if (!make) return;
  // Radius in sheet-x units, corrected on y so a circle is round on screen
  // rather than an ellipse the shape of the window.
  const aspect = W / H;
  const poly = make(x, y, punchR, aspect);
  const p = L.punch(layout, poly, tool);
  selected = p.id;
  say(`punched a ${tool}`);
}

// The window frame, letterboxed into most of the screen.
function cropRect(wf) {
  const pad = 70 * DPR;
  const maxW = W - pad * 2, maxH = H - pad * 2;
  const s = Math.min(maxW / wf.w, maxH / wf.h);
  const w = wf.w * s, h = wf.h * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

function startCrop() {
  if (!selected) { say('select a piece with a window in it first'); return; }
  const p = layout.panes.find(q => q.id === selected);
  if (!p || !p.source || p.source.t !== 'window') {
    say('that piece has no window — drop one in first'); return;
  }
  cropping = p.id;
  say('drag over the part of the window you want');
}

function endCrop(keep) {
  cropping = null; cropDrag = null;
  say(keep ? 'crop set' : 'crop cancelled');
}

// Where in its window a point inside a piece falls, 0..1 — the exact inverse
// of the cover-fit used to draw it, crop included. Without this a click in a
// cropped piece would land somewhere else entirely in the real window.
function pointToWindow(p, px, py) {
  const wf = p.source && p.source.t === 'window' ? winFeeds.get(p.source.id) : null;
  if (!wf || !wf.ready) return null;
  const b = L.bbox(p.poly);
  const bw = b.w * W, bh = b.h * H;
  const c = (p.source.crop) || FULL;
  const sw = Math.max(1, c.w * wf.w), sh = Math.max(1, c.h * wf.h);
  const s = Math.max(bw / sw, bh / sh);
  const dw = sw * s, dh = sh * s;
  const dx0 = b.x * W + (bw - dw) / 2, dy0 = b.y * H + (bh - dh) / 2;
  const uu = (px - dx0) / dw, vv = (py - dy0) / dh;
  if (uu < 0 || uu > 1 || vv < 0 || vv > 1) return null;
  return { u: c.x + uu * c.w, v: c.y + vv * c.h, win: p.source.id, app: p.source.app };
}

// The piece is a window, so clicking it should reach that window. The daemon
// resolves 0..1 against where the window is NOW, because it may have moved
// since the layout was cut.
async function poke(t, px, py, extra = '') {
  const [x, y] = toSheet(px / DPR, py / DPR);
  const p = L.paneAt(layout, x, y);
  if (!p || !p.source || p.source.t !== 'window') { say('that piece has no window to click into'); return; }
  const w = pointToWindow(p, px, py);
  if (!w) { say('outside the window inside that piece'); return; }
  try {
    const r = await fetch(`/poke?win=${w.win}&u=${w.u.toFixed(5)}&v=${w.v.toFixed(5)}`
                          + `&type=${t}${extra}`, { cache: 'no-store' });
    const j = await r.json();
    say(j.ok ? `${t} → ${j.app}` : `could not reach it: ${j.error || r.status}`);
  } catch (e) { say('poke failed: ' + e.message); }
}

function say(s) { status = s; }

// ------------------------------------------------------------ window picker
// Click a piece with this open and that window goes into it. The list is the
// daemon's, which is ScreenCaptureKit's, which includes windows that are
// currently buried — those are exactly the ones you want to pull into a
// collage, even if they cannot stream until they are visible.
const pick = document.getElementById('pick');
let picking = false;
let dragWin = null, dropTarget = null, winList = [];

async function openPicker() {
  picking = true;
  pick.classList.add('on');
  pick.innerHTML = '<div class="ph">loading windows…</div>';
  let ws = [];
  try {
    const j = await (await fetch('/windows', { cache: 'no-store' })).json();
    ws = j.windows || [];
    winList = ws;
    if (j.error) throw new Error(j.error);
  } catch (e) {
    pick.innerHTML = `<div class="ph">could not list windows</div>`
                   + `<div class="perr">${String(e.message || e)}</div>`;
    return;
  }
  pick.innerHTML = '<div class="ph">click a piece, then a window</div>'
    + '<div class="prow none" data-id="0">— the screen underneath —</div>'
    + ws.map(w => `<div class="prow${w.onScreen ? '' : ' off'}" data-id="${w.id}">`
        + `<b>${esc(w.app)}</b>${w.title ? ' · ' + esc(w.title.slice(0, 42)) : ''}`
        + `<span class="pdim">${w.w}×${w.h}${w.onScreen ? '' : ' · hidden'}</span></div>`).join('');
  for (const row of pick.querySelectorAll('.prow')) {
    // Dragging is the gesture that matches the metaphor: you pick a window
    // up and drop it into a hole you cut. Clicking still works, because a
    // long drag across a big screen is tiring when you are placing twelve.
    row.draggable = true;
    row.ondragstart = e => {
      dragWin = { id: +row.dataset.id, app: row.querySelector('b')?.textContent || '' };
      e.dataTransfer.setData('text/plain', String(dragWin.id));
      e.dataTransfer.effectAllowed = 'copy';
      say('drop it on a piece');
    };
    row.ondragend = () => { dragWin = null; dropTarget = null; };
    row.onclick = () => {
      if (!selected) { say('drag it onto a piece, or click a piece first'); return; }
      const p = layout.panes.find(q => q.id === selected);
      if (!p) return;
      assignWindow(p.id, +row.dataset.id);
    };
  }
}
// One place where a window becomes a piece's content, used by both the
// click path and the drop path.
function assignWindow(paneId, winId) {
  const p = layout.panes.find(q => q.id === paneId);
  if (!p) return;
  if (!winId) {
    p.source = null; p.name = '';
    say('piece shows the screen again');
  } else {
    const w = winList.find(x => x.id === winId) || { id: winId, app: 'window', title: '' };
    p.source = { t: 'window', id: winId, app: w.app, title: w.title };
    p.name = w.app;
    feedFor(winId);
    say(`${w.app} → this piece`);
  }
  reapFeeds();
}

cv.addEventListener('dragover', e => {
  if (!dragWin) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const [x, y] = toSheet(e.clientX, e.clientY);
  const p = L.paneAt(layout, x, y);
  dropTarget = p ? p.id : null;
});
cv.addEventListener('dragleave', () => { dropTarget = null; });
cv.addEventListener('drop', e => {
  e.preventDefault();
  const id = +(e.dataTransfer.getData('text/plain') || 0);
  const [x, y] = toSheet(e.clientX, e.clientY);
  const p = L.paneAt(layout, x, y);
  dragWin = null; dropTarget = null;
  if (!p) { say('dropped outside the sheet'); return; }
  selected = p.id;
  assignWindow(p.id, id);
});

function closePicker() { picking = false; pick.classList.remove('on'); }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

document.getElementById('windows').onclick = () => (picking ? closePicker() : openPicker());
document.getElementById('crop').onclick = () => (cropping ? endCrop(true) : startCrop());

// ------------------------------------------------------------------- tools
for (const b of document.querySelectorAll('[data-tool]')) {
  b.onclick = () => {
    tool = b.dataset.tool;
    for (const o of document.querySelectorAll('[data-tool]')) o.classList.toggle('on', o === b);
    say(tool === 'cut' ? 'drag across the sheet to divide it'
      : tool === 'move' ? 'drag a piece — hold shift to move the frame but not the picture'
      : tool === 'use' ? 'click and scroll inside a piece — it reaches the real window'
      : tool === 'delete' ? 'click a piece to remove it'
      : `${tool} · ${(punchR * 200).toFixed(0)}% wide — scroll to resize, click to place`);
  };
}

$('#reset').onclick = () => { layout = L.newLayout(); selected = null; say('back to one whole sheet'); };

$('#bmock').onclick = () => { if (nat.active) nat.stop(); if (cap.active) cap.stop(); say('no source — pieces show their own colour'); };
$('#bnative').onclick = async () => {
  if (nat.active) { nat.stop(); say('feed stopped'); return; }
  if (cap.active) cap.stop();
  say('starting the whole-screen feed…');
  const ok = await nat.start({ exclude: 'hud-panel,Safari,Brave,Chrome,Arc' });
  say(ok ? 'whole screen running' : 'could not start: ' + (nat.error || 'unknown'));
};
$('#blive').onclick = async () => {
  if (cap.active) { cap.stop(); say('capture stopped'); return; }
  if (nat.active) nat.stop();
  say('waiting for the share dialog…');
  const ok = await cap.start();
  say(ok ? 'capturing' : 'could not start: ' + (cap.error || 'unknown'));
};

// ---------------------------------------------------------------- persist
const KEY = '/papercut';
$('#save').onclick = async () => {
  try {
    const r = await fetch(KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(L.toJSON(layout)) });
    say(r.ok ? 'layout saved' : 'save failed');
  } catch (e) { say('save failed: ' + e.message); }
};
$('#load').onclick = async () => {
  try {
    const r = await fetch(KEY, { cache: 'no-store' });
    if (!r.ok) { say('nothing saved yet'); return; }
    layout = L.fromJSON(await r.json());
    selected = null;
    // Open the windows the layout asks for, rather than waiting for the
    // first frame to notice they are missing.
    for (const p of layout.panes) if (p.source && p.source.t === 'window') feedFor(p.source.id);
    reapFeeds();
    const wins = layout.panes.filter(p => p.source && p.source.t === 'window').length;
    say(`loaded ${layout.panes.length} pieces${wins ? `, ${wins} with windows` : ''}`);
  } catch (e) { say('load failed: ' + e.message); }
};

addEventListener('keydown', e => {
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (selected && L.removePane(layout, selected)) { selected = null; say('removed a piece'); }
  }
  if (cropping) {
    if (e.key === 'Enter') endCrop(true);
    if (e.key === 'Escape') endCrop(false);
    if (e.key === 'a') {
      const p = layout.panes.find(q => q.id === cropping);
      if (p && p.source) delete p.source.crop;
      say('showing the whole window');
    }
    return;
  }
  if (e.key === 'c') startCrop();
  if (e.key === 'Escape' && picking) closePicker();
  if (e.key === ']') { if (selected) { L.raisePane(layout, selected); say('brought to the front'); } }
});

// Exposed so the layout can be driven from the console or a test page —
// geometry bugs are far easier to see than to assert.
window.papercut = {
  L,
  get layout() { return layout; },
  set layout(v) { layout = v; },
  cut: (ax, ay, bx, by) => { let n = 0;
    for (const p of [...layout.panes]) if (L.cutPane(layout, p.id, ax, ay, bx, by)) n++; return n; },
  punch: (kind, x, y, r = 0.13) =>
    L.punch(layout, PUNCH[kind](x, y, r, W / H), kind),
  feed: id => feedFor(id),
};

draw();
