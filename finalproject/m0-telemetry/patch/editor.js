// editor.js — the patcher.
//
// DOM nodes, an SVG wire layer and a CSS transform for pan/zoom. Nodes are real
// elements so parameters can be real inputs; only the wires are drawn. The
// graph runs live here against the same telemetry stream the visualizer uses,
// so every node shows its actual value while you patch.

import { OPS, CATS, DESTS } from './ops.js';
import { Graph, defaultGraph } from './graph.js';
import { curveAt, CURVE_N, makeCurve } from './opkit.js';
import { OPDOCS } from './opdocs.js';
import { OPGUIDE } from './opguide.js';

// The editor is shared by every patcher. What differs between them is which
// operator categories appear in the palette, where the patch is saved, and
// what the preview window points at — so all of that is configuration and
// none of it is in here. Each patcher page imports this and calls boot().
let CFG = {
  cats:      null,                  // null = show every category
  // Which destinations the Output node offers. The Psychedelic OS has no
  // buses, no travellers and no hero's journey, so offering them there would
  // be offering controls that reach nothing.
  destFilter: null,                 // null = every destination
  patchUrl:  '/patch',
  previewUrl:'/viz.html?compact=1',
  vizUrl:    '/viz.html',
  defaultGraph,
  demos:     [],                    // [{ sel:'#demo', fn(graph) -> nodes added, note }]
};

const $ = s => document.querySelector(s);
const stage = $('#stage'), world = $('#world'), svg = $('#wires');
const HEAD = 24, PTOP = 16, PGAP = 17, PRM = 24, SCOPE_H = 46, CURVE_H = 66;

let graph = new Graph();
let view = { x: 80, y: 60, z: 0.9 };
let sel = null, els = new Map();

// ---------------------------------------------------------------- geometry
function portCount(n) { const op = OPS[n.type]; return Math.max(op.ins.length, op.outs.length); }
function nodeH(n) {
  const op = OPS[n.type];
  return HEAD + PTOP + portCount(n) * PGAP + (op.params.length ? 6 : 0)
       + op.params.reduce((a, p) => a + (p.type === 'sel'   ? PRM + 11
                                       : p.type === 'curve' ? CURVE_H + 16
                                       :                      PRM), 0)
       + (op.scope ? SCOPE_H + 10 : 4);
}
const portY = i => HEAD + PTOP + i * PGAP;
function portPos(id, dir, i) {
  const n = graph.nodes.get(id); if (!n) return { x: 0, y: 0 };
  return { x: n.x + (dir === 'out' ? OPS[n.type].w : 0), y: n.y + portY(i) };
}

// ---------------------------------------------------------------- build DOM
function buildNode(n) {
  const op = OPS[n.type];
  const d = document.createElement('div');
  d.className = 'node'; d.dataset.id = n.id;
  d.style.width = op.w + 'px';

  const head = document.createElement('div');
  head.className = 'nhead';
  head.innerHTML = `<span class="sw" style="background:${op.color}"></span>`
                 + `<span class="tt">${op.title}</span>`
                 + `<span class="reach"></span><span class="vv"></span>`;
  head.title = OPDOCS[n.type] || op.title;
  d.appendChild(head);

  op.ins.forEach((p, i) => {
    const dot = document.createElement('div');
    dot.className = 'port in' + (p.shape ? ' shape' : p.seltype ? ' seltype' : '');
    dot.dataset.dir = 'in'; dot.dataset.i = i; dot.dataset.id = n.id;
    dot.style.top = (portY(i) - 5.5) + 'px';
    const lab = document.createElement('div');
    lab.className = 'plab in'; lab.style.top = (portY(i) - 6) + 'px';
    lab.textContent = p.label || p.k;
    d.append(dot, lab);
  });
  op.outs.forEach((p, i) => {
    const dot = document.createElement('div');
    dot.className = 'port out' + (p.shape ? ' shape' : p.seltype ? ' seltype' : '');
    dot.dataset.dir = 'out'; dot.dataset.i = i; dot.dataset.id = n.id;
    dot.style.top = (portY(i) - 5.5) + 'px';
    const lab = document.createElement('div');
    lab.className = 'plab out'; lab.style.top = (portY(i) - 6) + 'px';
    lab.textContent = p.label || p.k;
    d.append(dot, lab);
  });

  const box = document.createElement('div');
  box.className = 'params';
  box.style.marginTop = (PTOP + portCount(n) * PGAP - 10) + 'px';
  for (const q of op.params) {
    const row = document.createElement('div');
    row.className = 'prm' + (q.type === 'sel' ? ' wide'
                           : q.type === 'col' ? ' colr'
                           : q.type === 'curve' ? ' curve' : '');
    const lab = document.createElement('label');
    lab.textContent = q.label;
    row.appendChild(lab);
    let inp;
    if (q.type === 'curve') {
      row.appendChild(buildCurve(n, q));
      box.appendChild(row);
      continue;                                 // its own editor, not an input
    }
    if (q.type === 'txt') {
      inp = document.createElement('input');
      inp.type = 'text'; inp.value = n.p[q.k] || ''; inp.placeholder = '—';
      inp.addEventListener('change', () => { n.p[q.k] = inp.value; pushPreview(); });
      inp.addEventListener('pointerdown', e => e.stopPropagation());
      inp.addEventListener('keydown', e => e.stopPropagation());
      row.className = 'prm wide';
      row.appendChild(inp);
      box.appendChild(row);
      continue;
    }
    if (q.type === 'col') {
      inp = document.createElement('input');
      inp.type = 'color';
      inp.value = /^#[0-9a-fA-F]{6}$/.test(n.p[q.k]) ? n.p[q.k] : '#ffffff';
      inp.addEventListener('input', () => { n.p[q.k] = inp.value; pushPreview(); });
      inp.addEventListener('pointerdown', e => e.stopPropagation());
      row.appendChild(inp);
      box.appendChild(row);
      continue;                                 // colourisers hold no state to reset
    }
    if (q.type === 'sel') {
      inp = document.createElement('select');
      let opts = q.options;
      if (q.k === 'dest' && CFG.destFilter) {
        const keep = opts.filter(o => CFG.destFilter.some(p => o === p || o.startsWith(p)));
        if (keep.length) opts = keep;
        // An existing patch may name a destination this patcher hides; keep
        // it in the list rather than silently rewriting what it does.
        if (!opts.includes(n.p[q.k])) opts = [n.p[q.k], ...opts];
      }
      for (const o of opts) {
        const e = document.createElement('option');
        e.value = o; e.textContent = o; inp.appendChild(e);
      }
      inp.value = n.p[q.k];
    } else {
      inp = document.createElement('input');
      inp.type = 'number'; inp.step = q.step; inp.value = n.p[q.k];
      lab.addEventListener('pointerdown', e => scrub(e, lab, inp, n, q));
    }
    inp.addEventListener('change', () => {
      n.p[q.k] = q.type === 'sel' ? inp.value : (parseFloat(inp.value) || 0);
      n.s = OPS[n.type].init();                 // a parameter change resets buffers
      pushPreview();
    });
    inp.addEventListener('pointerdown', e => e.stopPropagation());
    row.appendChild(inp);
    box.appendChild(row);
  }
  d.appendChild(box);

  if (op.scope) {
    const c = document.createElement('canvas');
    c.className = 'scope';
    c.width = (op.w - 16) * 2; c.height = SCOPE_H * 2;
    c.style.width = (op.w - 16) + 'px'; c.style.height = SCOPE_H + 'px';
    d.appendChild(c);
    d._scope = c;
  }

  d.style.height = nodeH(n) + 'px';
  head.addEventListener('pointerdown', e => dragNode(e, n, d));
  d.addEventListener('pointerdown', () => select(n.id));
  world.appendChild(d);
  els.set(n.id, d);
  return d;
}

// The drawn-curve editor. The array under the pointer is the operator's
// coefficient vector: for Drawn kernel it is the impulse response, for Drawn
// spectral mask it is the frequency response, for Drawn transfer it is the
// lookup table. There is no interpretation step -- the drawing is the filter.
//
// Deliberately NOT resetting node state on an edit: the kernel and mask
// operators detect a changed drawing themselves and rebuild only their
// coefficients, so a 40 s signal history survives being redrawn.
function buildCurve(n, q) {
  const c = document.createElement('canvas');
  c.className = 'curve';
  const W = (OPS[n.type].w - 16), H = CURVE_H;
  c.width = W * 2; c.height = H * 2;             // 2x for crispness on retina
  c.title = 'drag to draw · double-click to smooth · shift-double-click to reset';

  if (!Array.isArray(n.p[q.k]) || n.p[q.k].length !== CURVE_N) n.p[q.k] = makeCurve('ramp');

  const g = c.getContext('2d');
  const draw = () => {
    const cv = n.p[q.k], N = cv.length;
    const w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    // midline and quarter lines, so a drawn level is readable
    g.strokeStyle = '#242c34'; g.lineWidth = 2;
    for (const f of [0.25, 0.5, 0.75]) {
      g.beginPath(); g.moveTo(0, h * f); g.lineTo(w, h * f); g.stroke();
    }
    g.beginPath();
    g.moveTo(0, h);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      g.lineTo(x, h - Math.min(1, Math.max(0, cv[i])) * h);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fillStyle = 'rgba(79,158,134,0.22)';
    g.fill();
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w, y = h - Math.min(1, Math.max(0, cv[i])) * h;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = '#6fd0b0'; g.lineWidth = 3; g.stroke();
  };

  // Paint, interpolating across every index between this sample and the last,
  // so a fast drag cannot leave gaps in the coefficient vector.
  let lastI = null;
  const paint = ev => {
    const r = c.getBoundingClientRect();
    const cv = n.p[q.k], N = cv.length;
    const fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const fy = Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height));
    const i = Math.round(fx * (N - 1));
    if (lastI === null || lastI === i) cv[i] = fy;
    else {
      const a = Math.min(lastI, i), b = Math.max(lastI, i);
      const va = lastI < i ? cv[lastI] : fy, vb = lastI < i ? fy : cv[lastI];
      for (let k = a; k <= b; k++) cv[k] = va + (vb - va) * ((k - a) / (b - a));
    }
    lastI = i;
    draw();
  };

  c.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    select(n.id);
    lastI = null;
    paint(e);
    const mv = ev => paint(ev);
    const up = () => {
      lastI = null;
      pushPreview();                            // the drawing is the coefficients
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });

  c.addEventListener('dblclick', e => {
    e.stopPropagation(); e.preventDefault();
    if (e.shiftKey) { n.p[q.k] = makeCurve('ramp'); toast('curve reset'); }
    else {
      const cv = n.p[q.k], N = cv.length, out = cv.slice();
      for (let i = 0; i < N; i++) {                 // 3-tap smoother, edges held
        const a = cv[Math.max(0, i - 1)], b = cv[i], d = cv[Math.min(N - 1, i + 1)];
        out[i] = (a + 2 * b + d) / 4;
      }
      n.p[q.k] = out; toast('curve smoothed');
    }
    draw(); pushPreview();
  });

  draw();
  return c;
}

function rebuild() {
  for (const d of els.values()) d.remove();
  els.clear();
  for (const n of graph.nodes.values()) buildNode(n);
  place(); drawWires(); stats();
}
function place() {
  for (const [id, d] of els) {
    const n = graph.nodes.get(id); if (!n) continue;
    d.style.left = n.x + 'px'; d.style.top = n.y + 'px';
  }
}

// ---------------------------------------------------------------- wires
let pending = null;                               // a wire being dragged
function wirePath(a, b) {
  const dx = Math.max(36, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}
function drawWires() {
  let h = '';
  for (const e of graph.edges) {
    const a = portPos(e.from, 'out', e.fo), b = portPos(e.to, 'in', e.ti);
    const src = graph.nodes.get(e.from);
    const col = src ? OPS[src.type].color : '#5c6670';
    const op = src && OPS[src.type].outs[e.fo];
    const cls = op && op.shape ? 'shapewire' : op && op.seltype ? 'selwire' : '';
    const d = wirePath(a, b);
    h += `<path class="${cls}" d="${d}" stroke="${col}" opacity="0.75"/>`
       + `<path class="hit" d="${d}" data-to="${e.to}" data-ti="${e.ti}"/>`;
  }
  if (pending && pending.cur) {
    const a = pending.dir === 'out' ? portPos(pending.id, 'out', pending.i) : pending.cur;
    const b = pending.dir === 'out' ? pending.cur : portPos(pending.id, 'in', pending.i);
    h += `<path d="${wirePath(a, b)}" stroke="var(--accent)" stroke-dasharray="5 4" opacity="0.9"/>`;
  }
  svg.innerHTML = h;
}
svg.addEventListener('click', e => {
  const p = e.target.closest('path.hit'); if (!p) return;
  graph.disconnect(p.dataset.to, +p.dataset.ti);
  drawWires(); stats(); toast('wire cut');
});

// ---------------------------------------------------------------- interaction
const toWorld = (cx, cy) => {
  const r = stage.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
};
function applyView() {
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  // Below about half scale the parameter text is unreadable anyway, so hide
  // it and let each node read as a coloured, titled block instead.
  world.classList.toggle('far', view.z < 0.55);
}

function dragNode(e, n, d) {
  e.stopPropagation(); e.preventDefault();
  select(n.id);
  const s = toWorld(e.clientX, e.clientY), ox = n.x, oy = n.y;
  const mv = ev => {
    const w = toWorld(ev.clientX, ev.clientY);
    n.x = Math.round(ox + (w.x - s.x)); n.y = Math.round(oy + (w.y - s.y));
    d.style.left = n.x + 'px'; d.style.top = n.y + 'px';
    drawWires();
  };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}

function scrub(e, lab, inp, n, q) {
  e.preventDefault(); e.stopPropagation();
  const x0 = e.clientX, v0 = parseFloat(inp.value) || 0;
  const span = (q.max - q.min);
  const mv = ev => {
    const k = ev.shiftKey ? 0.1 : 1;
    let v = v0 + ((ev.clientX - x0) / 260) * span * k;
    v = Math.min(q.max, Math.max(q.min, v));
    const dec = Math.max(0, Math.ceil(-Math.log10(q.step)));
    inp.value = v.toFixed(dec);
    n.p[q.k] = v;
    // Push DURING the drag, not only on release. The whole point of dragging
    // a value is watching what it does; pushPreview is already debounced, so
    // this costs one send per 160ms however fast you scrub.
    pushPreview();
  };
  const up = () => {
    n.s = OPS[n.type].init();
    pushPreview();
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}

stage.addEventListener('pointerdown', e => {
  const port = e.target.closest('.port');
  if (port) {
    e.preventDefault();
    pending = { id: port.dataset.id, dir: port.dataset.dir, i: +port.dataset.i, cur: null };
    const mv = ev => { pending.cur = toWorld(ev.clientX, ev.clientY); drawWires(); };
    const up = ev => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const tp = t && t.closest ? t.closest('.port') : null;
      if (tp && tp.dataset.dir !== pending.dir) {
        const out = pending.dir === 'out' ? pending : { id: tp.dataset.id, i: +tp.dataset.i };
        const inn = pending.dir === 'in' ? pending : { id: tp.dataset.id, i: +tp.dataset.i };
        if (graph.connect(out.id, out.i, inn.id, inn.i)) toast('connected');
        else if (graph.lastRefusal) toast('refused: ' + graph.lastRefusal);
      }
      pending = null; drawWires(); stats();
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
    return;
  }
  if (e.target.closest('.node')) return;
  select(null);
  stage.classList.add('panning');
  const sx = e.clientX, sy = e.clientY, vx = view.x, vy = view.y;
  const mv = ev => { view.x = vx + (ev.clientX - sx); view.y = vy + (ev.clientY - sy); applyView(); };
  const up = () => {
    stage.classList.remove('panning');
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});

stage.addEventListener('wheel', e => {
  // The side panels live inside the stage, so their wheel events bubble here.
  // Zooming the canvas on them meant they could never be scrolled.
  if (e.target.closest && e.target.closest('#inspect, #outline, #preview')) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const k = Math.exp(-e.deltaY * 0.0015);
  const z = Math.min(2.2, Math.max(0.15, view.z * k));
  view.x = mx - (mx - view.x) * (z / view.z);
  view.y = my - (my - view.y) * (z / view.z);
  view.z = z; applyView();
}, { passive: false });

function select(id) {
  sel = id;
  for (const [k, d] of els) d.classList.toggle('sel', k === id);
}

addEventListener('keydown', e => {
  if (/input|select|textarea/i.test(e.target.tagName)) return;
  if ((e.key === 'Backspace' || e.key === 'Delete') && sel) {
    graph.remove(sel); const d = els.get(sel); if (d) d.remove(); els.delete(sel);
    sel = null; drawWires(); stats(); toast('node deleted');
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
});

function fit() {
  const ns = [...graph.nodes.values()];
  if (!ns.length) return;
  const x0 = Math.min(...ns.map(n => n.x)), y0 = Math.min(...ns.map(n => n.y));
  const x1 = Math.max(...ns.map(n => n.x + OPS[n.type].w)), y1 = Math.max(...ns.map(n => n.y + nodeH(n)));
  const r = stage.getBoundingClientRect();
  view.z = Math.min(1.1, Math.min((r.width - 60) / (x1 - x0), (r.height - 60) / (y1 - y0)));
  view.x = 30 - x0 * view.z; view.y = 30 - y0 * view.z;
  applyView();
}

// ---------------------------------------------------------------- palette
// ------------------------------------------------------- the explanation card
// A native title tooltip is the wrong shape for this: it takes a second to
// appear, it cannot be styled, and it cannot hold two paragraphs. This is a
// panel that follows the pointer down the palette, so running your eye down
// the list reads like a glossary rather than a list of names.
let guideCard = null, guideT = null;

function ensureGuideCard() {
  if (guideCard) return guideCard;
  guideCard = document.createElement('div');
  guideCard.id = 'opguide';
  document.body.appendChild(guideCard);
  return guideCard;
}

function showGuide(type, anchor) {
  const op = OPS[type]; if (!op) return;
  const g = OPGUIDE[type] || {};
  const c = ensureGuideCard();
  c.innerHTML =
      `<div class="gh"><span class="sw" style="background:${op.color}"></span>`
    + `<span class="gt">${esc(op.title)}</span>`
    + `<span class="gc">${esc(catLabel(op.cat))}</span></div>`
    + `<div class="gsec">what it is</div><div class="gb">${esc(g.what || OPDOCS[type] || '')}</div>`
    + (g.use ? `<div class="gsec">what it is good for</div><div class="gb use">${esc(g.use)}</div>` : '')
    + portLine(op);

  // Position beside the item, then pull back inside the window if the card
  // would hang off the bottom — long entries near the end of a long list.
  c.style.visibility = 'hidden';
  c.classList.add('on');
  const r = anchor.getBoundingClientRect();
  const h = c.offsetHeight;
  let top = r.top - 6;
  if (top + h > innerHeight - 10) top = Math.max(10, innerHeight - 10 - h);
  c.style.left = (r.right + 10) + 'px';
  c.style.top = top + 'px';
  c.style.visibility = '';
}

function hideGuide() { if (guideCard) guideCard.classList.remove('on'); }

function catLabel(cat) {
  const f = CATS.find(c => c[0] === cat);
  return f ? f[1].split('—')[0].trim() : cat;
}

// What it takes in and what it gives back, named rather than numbered.
function portLine(op) {
  const nm = p => p.seltype ? 'selection' : p.shape ? 'shape' : (p.label || p.k);
  const i = (op.ins || []).map(nm), o = (op.outs || []).map(nm);
  if (!i.length && !o.length) return '';
  return `<div class="gports">`
       + (i.length ? `<b>in</b> ${esc(i.join(', '))}` : `<b>in</b> —`)
       + `   <b>out</b> ${esc(o.length ? o.join(', ') : '—')}</div>`;
}

function buildPalette() {
  const pal = $('#pal');
  pal.innerHTML = '';
  const show = CFG.cats ? new Set(CFG.cats) : null;

  // 86 operators in 19 groups is too many to scroll. Typing filters on the
  // operator's name, its category, and its internal id — so "wave", "colour"
  // and "txt" all find what you would expect.
  const find = document.createElement('input');
  find.id = 'palfind'; find.type = 'search'; find.placeholder = 'filter operators…';
  find.autocomplete = 'off'; find.spellcheck = false;
  pal.appendChild(find);
  const count = document.createElement('div');
  count.id = 'palcount';
  pal.appendChild(count);

  const groups = [];
  for (const [cat, label] of CATS) {
    if (show && !show.has(cat)) continue;
    const h = document.createElement('h4'); h.textContent = label; pal.appendChild(h);
    const items = [];
    for (const [type, op] of Object.entries(OPS)) {
      if (op.cat !== cat) continue;
      const b = document.createElement('button');
      b.innerHTML = `<span class="sw" style="background:${op.color}"></span>${op.title}`;
      // No `title`: the native tooltip would race the card and cover it.
      b.addEventListener('pointerenter', () => {
        clearTimeout(guideT);
        guideT = setTimeout(() => showGuide(type, b), 90);
      });
      b.addEventListener('pointerleave', () => { clearTimeout(guideT); hideGuide(); });
      b.addEventListener('focus', () => showGuide(type, b));
      b.addEventListener('blur', hideGuide);
      b.onclick = () => {
        const r = stage.getBoundingClientRect();
        const w = toWorld(r.left + r.width / 2, r.top + r.height / 3);
        const n = graph.add(type, Math.round(w.x), Math.round(w.y));
        buildNode(n); place(); drawWires(); stats(); select(n.id);
      };
      items.push({ el: b, hay: (op.title + ' ' + type + ' ' + label + ' ' + cat).toLowerCase() });
      pal.appendChild(b);
    }
    groups.push({ h, items });
  }

  const total = groups.reduce((a, g) => a + g.items.length, 0);
  const apply = () => {
    const q = find.value.trim().toLowerCase();
    let shown = 0;
    for (const g of groups) {
      let any = 0;
      for (const it of g.items) {
        const hit = !q || it.hay.includes(q);
        it.el.style.display = hit ? '' : 'none';
        if (hit) { any++; shown++; }
      }
      g.h.style.display = any ? '' : 'none';
    }
    count.textContent = q ? `${shown} of ${total} operators` : `${total} operators`;
  };
  find.addEventListener('input', apply);
  find.addEventListener('keydown', e => {
    e.stopPropagation();                       // delete must not remove a node
    if (e.key === 'Escape') { find.value = ''; apply(); find.blur(); }
  });
  apply();
}

// ---------------------------------------------------------------- live data
const raw = {}; let labels = {}, connected = false, evalHz = 60;
(function connect() {
  const es = new EventSource('/stream');
  es.onopen = () => setConn(true);
  es.onerror = () => setConn(false);
  es.onmessage = e => {
    let f; try { f = JSON.parse(e.data); } catch (_) { return; }
    setConn(true); Object.assign(raw, f.ch); labels = f.lab || {};
  };
})();
function setConn(v) {
  connected = v;
  $('#conn').classList.toggle('on', v);
  $('#connt').textContent = v ? 'live' : 'no daemon';
}

const fmt = v => !Number.isFinite(v) ? '--'
  : Math.abs(v) >= 1e5 ? v.toExponential(1)
  : Math.abs(v) >= 100 ? v.toFixed(0)
  : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);

let last = performance.now(), acc = 0, hzAcc = 0, frames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  frames++; hzAcc += dt;
  if (hzAcc > 0.5) { evalHz = frames / hzAcc; frames = 0; hzAcc = 0; $('#nhz').textContent = evalHz.toFixed(0); }

  const G = graph.eval({ dt, t: now / 1000, raw, labels });

  acc += dt;
  if (acc < 1 / 20) return;                       // DOM text at 20 Hz is plenty
  acc = 0;

  // What this patch is actually handing the renderer, right now. Everything
  // a patch can produce is one of these, so this line IS the contract:
  // named scalar sinks, plus five structured outputs.
  const outs = [];
  const scal = Object.keys(G).filter(k => k[0] !== '$' && Number.isFinite(G[k]));
  if (scal.length) outs.push(`${scal.length} dest`);
  if (G.$text)   outs.push(`${G.$text.length} type`);
  if (G.$layout) outs.push(`${G.$layout.length} layout`);
  if (G.$shapes) outs.push(`${G.$shapes.length} shape`);
  if (G.$color)  outs.push(G.$color.mode);
  if (G.$bot)    outs.push('botanical');
  const el = $('#drives');
  if (el) {
    el.textContent = outs.length ? outs.join(' · ') : 'nothing yet';
    el.title = scal.length ? 'destinations: ' + scal.sort().join(', ') : 'no Output nodes wired';
  }
  for (const [id, d] of els) {
    const n = graph.nodes.get(id); if (!n) continue;
    const vv = d.querySelector('.vv');
    if (vv) vv.textContent = n.o.length ? fmt(n.o[0]) : '';
    d.classList.toggle('err', !!n.err);
    if (d._scope && n.s && n.s.hist) drawScope(d._scope, n.s);
  }
}
function drawScope(c, s) {
  const g = c.getContext('2d'), w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  let lo = Infinity, hi = -Infinity;
  for (const v of s.hist) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo) || hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  g.strokeStyle = '#2c343d'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.strokeStyle = '#49b8d8'; g.lineWidth = 2.5; g.beginPath();
  const n = s.hist.length;
  for (let k = 0; k < n; k++) {
    const v = s.hist[(s.i + k) % n];
    const x = (k / (n - 1)) * w, y = h - ((v - lo) / (hi - lo)) * h;
    k ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  g.fillStyle = '#5a646e'; g.font = '16px ui-monospace,monospace';
  g.fillText(fmt(hi), 4, 16); g.fillText(fmt(lo), 4, h - 5);
}

// ---------------------------------------------------------------- inspect
//
// What is actually on screen in the window you are looking at, read through
// the Accessibility API, refreshed as you switch windows. Click an element
// and it becomes a block.
//
// This is the half of the patcher that cannot be a fixed list: the palette
// on the left is what effects EXIST, and this is what is THERE right now.
//
// HOLDING. The patcher runs in a browser, so the moment you look back at it
// the frontmost application is the browser and the inspector would show its
// own page. When the snapshot is of ourselves, the previous one is kept and
// the header says so — switch to Finder, look at it, come back, and Finder
// is still listed and still clickable.

let axSnap = null, axHeld = false, axErr = '', axTimer = null, axBusy = false;

// Our own pages, by window title. Reading every app means reading the
// browser too, and the patcher listing its own controls is noise at best and
// a hall of mirrors at worst.
const OURS = /Patcher\s*[—-]\s*|Psychedelic OS|Computing Visualizer/i;
const isOurWindow = e => !!(e.window && OURS.test(e.window));

// Drop our own windows and keep everything else. This replaces an earlier
// approach that discarded the WHOLE snapshot when it looked like us — which
// deadlocked, because the frontmost application while you are using the
// patcher is always the patcher, so a first reading never arrived.
function stripSelf(j) {
  if (!j || !j.elements) return j;
  const kept = j.elements.filter(e => !isOurWindow(e));
  return { ...j, elements: kept, dropped: j.elements.length - kept.length };
}

async function pollAx() {
  const box = $('#inspect');
  if (!box || !box.classList.contains('on') || axBusy) return;
  axBusy = true;
  try {
    // `all=1`: every application with windows, not just the frontmost one.
    // Without it the inspector can only ever show whatever is in front, and
    // while you are using the patcher that is the patcher.
    const r = await fetch('/ax?all=1&max=1200&budget=2200&ttl=1200', { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) { axErr = j.error || 'not available'; }
    else {
      const s = stripSelf(j);
      // Keep the previous reading rather than blanking, if everything that
      // came back was us.
      if (s.elements.length) { axSnap = s; axHeld = false; }
      else axHeld = true;
      axErr = '';
    }
  } catch (e) { axErr = String(e.message || e); }
  axBusy = false;
  renderInspect();
}

function renderInspect() {
  const box = $('#inspect');
  if (!box || !box.classList.contains('on')) return;
  if (axErr) {
    box.innerHTML = `<div class="ihead">inspect</div>`
      + `<div class="ierr">${axErr}</div>`
      + `<div class="ierr dim">Grant Accessibility to m1-desktop/bin/ax-reader in `
      + `System Settings &rsaquo; Privacy &amp; Security &rsaquo; Accessibility.</div>`;
    return;
  }
  if (!axSnap) { box.innerHTML = `<div class="ihead">inspect</div>`
    + `<div class="ierr dim">reading the screen…</div>`; return; }

  const els = axSnap.elements;
  const app = els.length ? els[0].app : '?';
  const win = els.length ? (els[0].window || '') : '';
  const dflt = pickMode === 'default';
  let h = `<div class="ihead">inspect <span class="${axHeld ? 'held' : 'livedot'}">`
        + `${axHeld ? 'held' : 'live'}</span></div>`
        + `<div class="imode">`
        + `<button data-mode="default" class="${dflt ? 'on' : ''}">default</button>`
        + `<button data-mode="custom" class="${dflt ? '' : 'on'}">custom</button>`
        + `</div>`
        + `<div class="ihint">${dflt
            ? 'click anything and its whole window is affected, with a standard '
              + 'effect if you have not built one. Presets land on the window you pick.'
            : 'click an element for that element, a container for everything under '
              + 'it. You wire it into an effect yourself.'}</div>`
        + (dflt && scopePath
            ? `<div class="iscope">affecting: ${esc(scopePath.split('>').pop())}</div>`
            : '')
        + `<div class="iapp">${app}${win ? ' — ' + win : ''}</div>`
        + `<div class="icount">${els.length} elements</div>`;

  // Containers first, so "everything under this window" is reachable before
  // the long list of leaves.
  const seen = new Set();
  const conts = [];
  for (const e of els) {
    const parts = String(e.path).split('>');
    for (let k = 2; k <= Math.min(parts.length - 1, 4); k++) {
      const p = parts.slice(0, k).join('>');
      if (!seen.has(p)) { seen.add(p); conts.push({ path: p, depth: k }); }
    }
  }
  if (conts.length) {
    h += `<div class="isec">containers</div>`;
    for (const c of conts.slice(0, 14)) {
      h += `<div class="irow cont" data-under="${encodeURIComponent(c.path)}" `
         + `style="padding-left:${6 + c.depth * 7}px">`
         + `<span class="irole">under</span>`
         + `<span class="itext">${esc(c.path.split('>').pop())}</span></div>`;
    }
  }

  h += `<div class="isec">elements</div>`;
  for (const e of els.slice(0, 220)) {
    const t = (e.text || '').replace(/\s+/g, ' ').trim();
    h += `<div class="irow" data-path="${encodeURIComponent(e.path)}" `
       + `data-text="${encodeURIComponent(t)}" `
       + `style="padding-left:${6 + Math.min(e.depth, 8) * 5}px" `
       + `title="${esc(e.path)}">`
       + `<span class="irole">${esc(e.role.replace(/^AX/, ''))}</span>`
       + `<span class="itext">${esc(t.slice(0, 54)) || '—'}</span>`
       + `<span class="idim">${e.w}×${e.h}</span></div>`;
  }
  // The screen is re-read about once a second, and replacing innerHTML sends
  // the panel back to the top. Scrolling down a list of 200 elements was
  // therefore impossible: you scrolled, the next reading snapped you back.
  const sy = box.scrollTop;
  box.innerHTML = h;
  box.scrollTop = sy;

  box.querySelectorAll('[data-mode]').forEach(b => {
    b.onclick = () => { pickMode = b.dataset.mode; renderInspect(); };
  });

  box.querySelectorAll('.irow[data-path]').forEach(el => {
    const path = decodeURIComponent(el.dataset.path);
    el.onclick = () => (pickMode === 'default'
      ? scopeTo(windowOf(path), windowOf(path).split('>').pop())
      : addPick('pick.element',
          { path, text: decodeURIComponent(el.dataset.text) },
          decodeURIComponent(el.dataset.text) || 'element'));
  });
  box.querySelectorAll('.irow[data-under]').forEach(el => {
    const path = decodeURIComponent(el.dataset.under);
    el.onclick = () => (pickMode === 'default'
      // A container click in Default mode means that container, not its
      // window: clicking a toolbar should affect the toolbar.
      ? scopeTo(path, path.split('>').pop())
      : addPick('pick.under', { path }, path.split('>').pop()));
  });
}

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                          .replace(/"/g,'&quot;');

// Drop a selector block on the canvas, already filled in, already selected.
// DEFAULT vs CUSTOM.
//
// Custom is the fine-grained way: click one thing, get one block, wire it
// yourself. It is what you want once you know exactly which element you mean.
//
// Default is the on-ramp. Click anything in a window and the patcher does the
// obvious thing: scope every effect to that whole window, and if nothing is
// wired yet, add a standard effect so there is something to look at. It then
// saves, because in Default mode the point is that it works without a second
// step.
//
// A preset goes through exactly the same door. Loading one gives you its
// effects with their selection inputs free; the window you last chose is
// re-applied to them, so "pick a preset, pick a window" is the whole
// interaction and the preset lands on the window you meant rather than on
// whatever happened to be in front.
let pickMode = 'default';
let scopeId = null;             // the pick.under node Default mode maintains
let scopePath = '';             // the window it currently points at

// The window an element belongs to: App > Window, the first two levels of
// the hierarchy path.
function windowOf(path) {
  const parts = String(path).split('>');
  return parts.slice(0, Math.min(2, parts.length)).join('>');
}

// Effects whose selection input is still free. Pick blocks are excluded: they
// are the other half of the sentence, not something to scope.
function openSelectionInputs() {
  const out = [];
  for (const n of graph.nodes.values()) {
    const op = OPS[n.type];
    if (!op || op.cat === 'pick') continue;
    const si = op.ins.findIndex(p => p.seltype);
    if (si < 0) continue;
    if (graph.edges.some(e => e.to === n.id && e.ti === si)) continue;
    out.push({ n, si });
  }
  return out;
}

// The standard effect: letters that swell and shrink and ride a slow wave,
// with a legibility floor in pixels so they never shrink past readable. It is
// deliberately the plainest thing that is unmistakably happening.
function standardEffect(x, y) {
  const sc = graph.add('txt.scale', x, y,
    { s: 1.1, f: 0.22, base: 1, axis: 'both', minpx: 10, from: 'word', scale: 0.8,
      target: 'all' });
  const wv = graph.add('txt.wave', x, y + 150,
    { amp: 6, f: 0.3, axis: 'y', shape: 'sine', from: 'index', scale: 0.55,
      target: 'all' });
  return [sc, wv];
}

// Point the patch at one window. Called by a click in Default mode, and again
// after a preset loads so the preset inherits the same scope.
function scopeTo(path, label, quiet) {
  scopePath = path;

  // Reuse the scope node if it is still there, so repeated clicks move the
  // scope instead of littering the canvas with picks.
  let pick = scopeId && graph.nodes.get(scopeId);
  if (pick && pick.type !== 'pick.under') pick = null;
  if (pick) pick.p = { ...pick.p, path };
  else {
    const r = stage.getBoundingClientRect();
    const w = toWorld(r.left + r.width * 0.22, r.top + r.height * 0.38);
    pick = graph.add('pick.under', Math.round(w.x), Math.round(w.y), { path });
    scopeId = pick.id;
  }

  let open = openSelectionInputs();
  let made = 0;
  // Only build the standard effect when there is no effect at all. A patch
  // whose effects all have their own selections already — the grid and region
  // presets do, since reading the screen IS their target — is one that chose
  // what it affects, and bolting a second effect onto it would be noise.
  if (!open.length && !effectCount()) {
    made = standardEffect(pick.x + 330, pick.y).length;
    open = openSelectionInputs();
  }
  let wired = 0;
  for (const { n, si } of open) if (graph.connect(pick.id, 0, n.id, si)) wired++;

  if (!wired && !made) {
    // Nothing took the scope. Leave the pick on the canvas so it can be wired
    // by hand, and say why rather than claiming success.
    graph.dirty = true; rebuild(); select(pick.id);
    if (!quiet) toast('this patch already chooses what it affects — '
                    + 'wire this block in by hand, or switch to custom');
    return { wired: 0, made: 0 };
  }

  graph.dirty = true;
  rebuild(); select(pick.id);
  if (!quiet) {
    const name = String(label || path.split('>').pop()).slice(0, 24);
    save().then(() => toast(made
      ? `“${name}” — standard effect added and running`
      : `“${name}” — ${wired} effect${wired === 1 ? '' : 's'} now running there`));
  }
  return { wired, made };
}

// How many surface effects the patch has, regardless of what they target.
function effectCount() {
  let k = 0;
  for (const n of graph.nodes.values()) {
    const op = OPS[n.type];
    if (op && (op.cat === 'text' || op.cat === 'layout' || op.cat === 'bot')) k++;
  }
  return k;
}

function addPick(type, params, label) {
  const r = stage.getBoundingClientRect();
  const w = toWorld(r.left + r.width * 0.42, r.top + r.height * 0.4);
  const n = graph.add(type, Math.round(w.x), Math.round(w.y), params);
  buildNode(n); place(); drawWires(); stats(); select(n.id);
  toast(`picked “${String(label).slice(0, 28)}” — wire it into an effect`);
}

// ---------------------------------------------------------------- outline
//
// A patch of eighty nodes is unreadable as a canvas, and "fit" only makes the
// nodes smaller. This reads the graph back out as the thing you actually
// built: one line per chain, from its source to what it drives.
//
// Chains are found by walking BACKWARDS from every sink, because a sink is
// the only place a signal can legitimately end — so every line here is a
// complete, working path, and anything you built that is missing from this
// list is not connected to anything.

function sinkLabel(n) {
  const op = OPS[n.type];
  if (n.type === 'out') return n.p.dest;
  if (op.cat === 'text')   return 'type: ' + op.title.toLowerCase();
  if (op.cat === 'layout') return 'layout: ' + op.title.toLowerCase();
  if (op.cat === 'render') return 'draw: ' + op.title.toLowerCase();
  if (op.cat === 'color')  return 'colour: ' + op.title.toLowerCase();
  if (op.cat === 'bot')    return 'tree: ' + op.title.toLowerCase();
  if (op.cat === 'util')   return op.title.toLowerCase();
  return op.title;
}

function chains() {
  const bySrc = new Map(), byDst = new Map();
  for (const e of graph.edges) {
    if (!byDst.has(e.to)) byDst.set(e.to, []);
    byDst.get(e.to).push(e);
    if (!bySrc.has(e.from)) bySrc.set(e.from, []);
    bySrc.get(e.from).push(e);
  }
  const out = [];
  for (const n of graph.nodes.values()) {
    const op = OPS[n.type];
    if (op.outs.length && bySrc.has(n.id)) continue;        // not a terminal
    // walk back along the first wired input until a source is reached
    const path = [n];
    const seen = new Set([n.id]);
    let cur = n;
    while (true) {
      const inc = byDst.get(cur.id);
      if (!inc || !inc.length) break;
      const e = inc.slice().sort((a, b) => a.ti - b.ti)[0];
      const prev = graph.nodes.get(e.from);
      if (!prev || seen.has(prev.id)) break;
      seen.add(prev.id);
      path.unshift(prev);
      cur = prev;
    }
    const extra = (byDst.get(n.id) || []).length - 1;
    out.push({ node: n, path, drives: sinkLabel(n), branches: Math.max(0, extra),
               wired: path.length > 1 });
  }
  out.sort((a, b) => (a.node.y - b.node.y) || (a.node.x - b.node.x));
  return out;
}

function renderOutline() {
  const box = $('#outline');
  if (!box || !box.classList.contains('on')) return;
  const list = chains();
  const live = list.filter(c => c.wired).length;
  // "Not driven" is not "broken": a modulator running on its own parameters
  // is a perfectly good block. Only say what is true.
  let h = `<div class="ohead">${list.length} chains · ${live} driven by a signal · `
        + `${list.length - live} on fixed parameters · ${graph.nodes.size} nodes</div>`;
  for (const c of list) {
    const steps = c.path.map(n => {
      const op = OPS[n.type];
      const t = n.type === 'channel' ? n.p.ch : op.title;
      return `<span class="ostep" data-id="${n.id}" style="border-color:${op.color}">${t}</span>`;
    }).join('<span class="oarrow">&rsaquo;</span>');
    h += `<div class="orow${c.wired ? '' : ' fixed'}" data-id="${c.node.id}">`
       + `<div class="odrv">${c.drives}`
       + (c.wired ? '' : '<span class="ofix">fixed</span>') + `</div>`
       + `<div class="opath">${steps}`
       + (c.branches ? `<span class="obr">+${c.branches} more in</span>` : '')
       + `</div></div>`;
  }
  box.innerHTML = h;
  box.querySelectorAll('.ostep').forEach(el => {
    el.onclick = ev => { ev.stopPropagation(); focusNode(el.dataset.id); };
  });
  box.querySelectorAll('.orow').forEach(el => {
    el.onclick = () => focusNode(el.dataset.id);
  });
}

// Centre a node and select it, so a line in the outline takes you to the
// thing it describes.
function focusNode(id) {
  const n = graph.nodes.get(id);
  if (!n) return;
  const r = stage.getBoundingClientRect();
  view.z = Math.max(view.z, 0.75);
  view.x = r.width / 2 - (n.x + OPS[n.type].w / 2) * view.z;
  view.y = r.height / 2 - (n.y + 40) * view.z;
  applyView();
  select(id);
}

// ---------------------------------------------------------------- tidy
// Columns by dependency depth, so a chain reads left to right.
//
// Rows deliberately preserve each node's existing vertical ORDER, because
// typography and layout modulators apply top to bottom by position — sorting
// them any other way would silently change what the patch does.
function tidy() {
  const byDst = new Map();
  for (const e of graph.edges) {
    if (!byDst.has(e.to)) byDst.set(e.to, []);
    byDst.get(e.to).push(e);
  }
  const depth = new Map();
  const depthOf = (id, guard = 0) => {
    if (depth.has(id)) return depth.get(id);
    if (guard > 64) return 0;
    const inc = byDst.get(id);
    let d = 0;
    if (inc) for (const e of inc) d = Math.max(d, depthOf(e.from, guard + 1) + 1);
    depth.set(id, d);
    return d;
  };
  const ns = [...graph.nodes.values()];
  for (const n of ns) depthOf(n.id);
  const order = ns.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const rank = new Map(order.map((n, i) => [n.id, i]));
  const cols = new Map();
  for (const n of ns) {
    const d = depth.get(n.id) || 0;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d).push(n);
  }
  let x = 60;
  for (const d of [...cols.keys()].sort((a, b) => a - b)) {
    const col = cols.get(d).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    let w = 0;
    col.forEach((n, i) => {
      n.x = x;
      n.y = 60 + i * 150;
      w = Math.max(w, OPS[n.type].w);
    });
    x += w + 90;
  }
  place(); drawWires(); stats(); fit();
  toast('tidied — columns are dependency depth, rows keep their order');
}

// ------------------------------------------------------------ live reach
// The preview reports how many things each block actually landed on. That
// number is the answer to "what did connecting this block change?", and it is
// the one thing the graph alone can never tell you: a block wired perfectly to
// a selection that matches nothing looks identical to one that is working.
let reachMap = {}, reachPool = 0;
addEventListener('message', e => {
  if (e.origin !== location.origin) return;
  const m = e.data;
  if (m && m.type === 'floating') {
    // Two copies of the same picture is one too many. The pane is NOT hidden
    // with display:none, because a display:none iframe stops rendering and
    // the floating window it is feeding would freeze. It is made transparent
    // and inert instead, so it keeps painting at full size -- which is also
    // what keeps the floating window sharp, since the float canvas is copied
    // from it.
    const box = $('#preview');
    if (box) box.classList.toggle('floated', !!m.on);
    const chip = $('#floatchip');
    if (chip) chip.classList.toggle('on', !!m.on);
    return;
  }
  if (!m || m.type !== 'reach') return;
  reachMap = m.reach || {};
  reachPool = m.pool || 0;
  paintReach();
});

function paintReach() {
  for (const [id, d] of els) {
    const b = d.querySelector('.reach');
    if (!b) continue;
    const n = graph.nodes.get(id);
    const op = n && OPS[n.type];
    // Only effects land on things. A number next to a maths block would be
    // meaningless, and meaningless numbers are worse than none.
    if (!op || !['text', 'layout', 'bot'].includes(op.cat)) {
      b.textContent = ''; b.className = 'reach'; continue;
    }
    const k = reachMap[id];
    if (k == null) { b.textContent = ''; b.className = 'reach'; continue; }
    b.textContent = reachPool ? `${k}/${reachPool}` : String(k);
    b.className = 'reach' + (k ? '' : ' zero');
    b.title = k ? `reaching ${k} of ${reachPool} things on screen right now`
                : 'this block reaches NOTHING — its selection matches no element on screen';
  }
}

// ---------------------------------------------------------------- preview
// Push the graph we are holding in memory into the preview iframe. Debounced,
// because a structural change can fire several times in one gesture.
let previewT = null;
function pushPreview() {
  const box = $('#preview');
  const f = box && box.classList.contains('on') ? $('#pvf') : null;
  clearTimeout(previewT);
  previewT = setTimeout(() => {
    const j = graph.toJSON();
    if (f && f.contentWindow) {
      try { f.contentWindow.postMessage({ type: 'patch', graph: j }, location.origin); } catch (_) {}
    }
    // ...and to every OTHER open window: the floating panel, a second
    // display, another Space. postMessage only reaches this page's iframe.
    try {
      fetch('/live', { method:'POST', headers:{ 'Content-Type':'application/json' },
                       body: JSON.stringify({ ...j, which: CFG.patchUrl }) });
    } catch (_) {}
  }, 160);
}

// ---------------------------------------------------------------- persistence
function stats() {
  $('#nnodes').textContent = graph.nodes.size;
  $('#nedges').textContent = graph.edges.length;
  pushPreview();                      // every structural change already calls this
  paintReach();
  renderOutline();
}
let toastT;
function toast(m) {
  const t = $('#toast'); t.textContent = m; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1400);
}
async function save() {
  try {
    const r = await fetch(CFG.patchUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify(graph.toJSON()) });
    const j = await r.json();
    toast(r.ok ? `saved — ${j.nodes} nodes, ${j.edges} wires` : 'save failed: ' + j.error);
  } catch (e) { toast('save failed: ' + e.message); }
}
async function load() {
  try {
    const r = await fetch(CFG.patchUrl, { cache: 'no-store' });
    if (r.ok) { graph = Graph.fromJSON(await r.json()); toast('loaded saved patch'); }
    else { graph = CFG.defaultGraph(); toast('no saved patch — loaded default'); }
  } catch (_) { graph = CFG.defaultGraph(); toast('loaded default'); }
  rebuild(); fit();
}
export function boot(cfg = {}) {
  CFG = { ...CFG, ...cfg };
  graph = CFG.defaultGraph();

  const pvf = $('#pvf');
  if (pvf) pvf.src = CFG.previewUrl;

  buildPalette();

  $('#save').onclick = save;
  $('#revert').onclick = load;
  $('#reset').onclick = () => { graph = CFG.defaultGraph(); rebuild(); fit();
                                toast('default patch loaded — not saved yet'); };
  // An empty canvas. "load default" gives you fourteen blocks to delete
  // first, which is a poor place to start building something from nothing.
  const eb = $('#empty');
  if (eb) eb.onclick = () => {
    if (graph.nodes.size && !confirm('Clear the canvas? The saved patch is untouched until you press save.')) return;
    graph = new Graph(); rebuild(); fit();
    toast('empty canvas — click a block in the sidebar to start');
  };
  $('#fit').onclick = fit;
  const tb = $('#tidy'); if (tb) tb.onclick = tidy;
  // ---- presets ----------------------------------------------------------
  const psel = $('#presets'), pnew = $('#savepreset');
  async function refreshPresets(keep) {
    if (!psel) return;
    try {
      const j = await (await fetch('/presets', { cache:'no-store' })).json();
      psel.innerHTML = '<option value="">presets…</option>'
        + j.presets.map(p => `<option value="${p.name}">${p.name} (${p.nodes})</option>`).join('');
      if (keep) psel.value = keep;
    } catch (_) {}
  }
  if (psel) {
    psel.onchange = async () => {
      const name = psel.value;
      if (!name) return;
      try {
        const j = await (await fetch('/presets?name=' + encodeURIComponent(name),
                                     { cache:'no-store' })).json();
        graph = Graph.fromJSON(j.graph);
        // The preset arrives with its selection inputs free. In Default mode
        // that is exactly what lets the window you last picked be re-applied
        // to it, so the preset affects what you meant.
        scopeId = null;
        rebuild(); fit();
        if (pickMode === 'default' && scopePath) {
          const { wired } = scopeTo(scopePath, '', true);
          await save();
          toast(`“${name}” running on `
              + `${scopePath.split('>').pop()} — ${wired} effect`
              + `${wired === 1 ? '' : 's'}`);
        } else if (pickMode === 'default') {
          toast(`“${name}” loaded — click a window in inspect to run it there`);
        } else {
          toast(`loaded preset “${name}” — save to make it the live patch`);
        }
      } catch (e) { toast('could not load that preset'); }
    };
    refreshPresets();
    // Presets can be written while the patcher is open — by Save preset here,
    // or straight into the presets folder. Re-read the list when the menu is
    // opened rather than only at boot, so a new one does not need a reload.
    // On pointerenter, not mousedown: rewriting a <select>'s options while
    // its popup is opening misbehaves in Safari. Hovering happens first and
    // leaves the list settled before the menu appears.
    let lastRefresh = 0;
    psel.addEventListener('pointerenter', () => {
      if (Date.now() - lastRefresh < 1500) return;
      lastRefresh = Date.now();
      refreshPresets(psel.value);
    });
  }
  if (pnew) pnew.onclick = async () => {
    const name = prompt('Save this patch as a preset called:', psel && psel.value || '');
    if (!name) return;
    try {
      const r = await fetch('/presets', { method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ name, graph: graph.toJSON() }) });
      const j = await r.json();
      if (j.error) { toast('save failed: ' + j.error); return; }
      await refreshPresets(j.saved);
      toast(`preset “${j.saved}” saved — ${j.nodes} nodes`);
    } catch (e) { toast('save failed: ' + e.message); }
  };

  const ib = $('#inspectbtn');
  if (ib) ib.onclick = () => {
    const on = $('#inspect').classList.toggle('on');
    ib.classList.toggle('go', on);
    if (on) { pollAx(); if (!axTimer) axTimer = setInterval(pollAx, 1100); }
    else { clearInterval(axTimer); axTimer = null; }
    renderInspect();
  };
  const ob = $('#outlinebtn');
  if (ob) ob.onclick = () => {
    const on = $('#outline').classList.toggle('on');
    ob.classList.toggle('go', on);
    renderOutline();
  };
  $('#openviz').onclick = () => window.open(CFG.vizUrl, '_blank');

  for (const d of CFG.demos) {
    const el = $(d.sel);
    if (!el) continue;
    el.onclick = () => { const n = d.fn(graph); rebuild(); toast(`added ${n} nodes — ${d.note}`); };
  }

  wirePreview();
  applyView();
  load().then(() => requestAnimationFrame(loop));
}

function wirePreview() {
  const box = $('#preview');
  $('#prev').onclick = () => {
    const on = box.classList.toggle('on');
    $('#prev').classList.toggle('go', on);
    if (on) { pushPreview(); toast('live preview on — it follows your edits, no save needed'); }
  };
  // drag the top-left grip to resize, since the pane is anchored bottom-right
  $('#pvgrip').addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    const w0 = box.offsetWidth, h0 = box.offsetHeight;
    const mv = ev => {
      box.style.width  = Math.max(220, Math.min(1100, w0 - (ev.clientX - x0))) + 'px';
      box.style.height = Math.max(140, Math.min(800,  h0 - (ev.clientY - y0))) + 'px';
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
}
