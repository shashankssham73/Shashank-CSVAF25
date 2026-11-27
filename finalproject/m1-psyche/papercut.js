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
      const b = L.bbox(p.poly);
      const [bw, bh] = [b.w * W, b.h * H];
      const s = Math.max(bw / wf.w, bh / wf.h);          // cover, not contain
      const dw = wf.w * s, dh = wf.h * s;
      ctx.drawImage(wf.bmp, b.x * W + (bw - dw) / 2, b.y * H + (bh - dh) / 2, dw, dh);
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
    ctx.strokeStyle = on ? '#ffd27f' : hot ? `hsl(${hue} 70% 68%)` : `hsl(${hue} 50% 48% / 0.75)`;
    ctx.lineWidth = (on ? 2.5 : 1.5) * DPR;
    ctx.stroke();
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
  if (drag) {
    if (drag.kind === 'cut') drag.b = [x, y];
    else if (drag.kind === 'move') {
      L.movePane(layout, drag.id, x - drag.last[0], y - drag.last[1], !e.shiftKey);
      drag.last = [x, y];
    }
    return;
  }
  const p = L.paneAt(layout, x, y);
  hover = p ? p.id : null;
  cv.style.cursor = tool === 'cut' ? 'crosshair' : tool === 'move' ? 'grab' : 'copy';
});

cv.addEventListener('pointerdown', e => {
  const [x, y] = toSheet(e.clientX, e.clientY);
  const p = L.paneAt(layout, x, y);
  cv.setPointerCapture(e.pointerId);

  // With the picker open, a click selects rather than cuts: you are aiming
  // at a piece, not making a new one.
  if (picking) { if (p) { selected = p.id; say(`piece selected — now click a window`); } return; }
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
  const poly = make(x, y, 0.13, aspect);
  const p = L.punch(layout, poly, tool);
  selected = p.id;
  say(`punched a ${tool}`);
}

function say(s) { status = s; }

// ------------------------------------------------------------ window picker
// Click a piece with this open and that window goes into it. The list is the
// daemon's, which is ScreenCaptureKit's, which includes windows that are
// currently buried — those are exactly the ones you want to pull into a
// collage, even if they cannot stream until they are visible.
const pick = document.getElementById('pick');
let picking = false;

async function openPicker() {
  picking = true;
  pick.classList.add('on');
  pick.innerHTML = '<div class="ph">loading windows…</div>';
  let ws = [];
  try {
    const j = await (await fetch('/windows', { cache: 'no-store' })).json();
    ws = j.windows || [];
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
    row.onclick = () => {
      if (!selected) { say('select a piece first — use move, then click one'); return; }
      const p = layout.panes.find(q => q.id === selected);
      if (!p) return;
      const id = +row.dataset.id;
      if (!id) { p.source = null; p.name = ''; say('piece shows the screen again'); }
      else {
        const w = ws.find(x => x.id === id);
        p.source = { t: 'window', id, app: w.app, title: w.title };
        p.name = w.app;
        feedFor(id);
        say(`${w.app} → this piece`);
      }
      reapFeeds();
    };
  }
}
function closePicker() { picking = false; pick.classList.remove('on'); }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

document.getElementById('windows').onclick = () => (picking ? closePicker() : openPicker());

// ------------------------------------------------------------------- tools
for (const b of document.querySelectorAll('[data-tool]')) {
  b.onclick = () => {
    tool = b.dataset.tool;
    for (const o of document.querySelectorAll('[data-tool]')) o.classList.toggle('on', o === b);
    say(tool === 'cut' ? 'drag across the sheet to divide it'
      : tool === 'move' ? 'drag a piece — hold shift to move the frame but not the picture'
      : tool === 'delete' ? 'click a piece to remove it'
      : `click to place a ${tool}`);
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
