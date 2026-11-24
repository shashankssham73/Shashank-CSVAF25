(function () {
  'use strict';
  const { OPS, Tele, evaluate, addNode, removeNode, connect, mapParam, unmapParam, makeLUT, PRESETS } = CORE;
  const SPEC = DSP.SPEC;
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const FAM = { source: ['Source', '--source'], shape: ['Shape', '--shape'], xform: ['Transformer', '--xform'], palette: ['Palette', '--palette'], render: ['Output', '--render'] };
  const FAMORDER = ['source', 'shape', 'xform', 'palette', 'render'];
  const famColor = (f) => getComputedStyle(document.documentElement).getPropertyValue(FAM[f][1]).trim();

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }

  // ---------------- state ----------------
  let graph = CORE.defaultGraph();
  const ctx = { t: 0, dt: 1 / 60, outs: {}, SPEC, specPhase: null };
  let paused = false, T = 0, last = performance.now();
  let tab = 'curve', prevGraphJSON = null;
  const sel = { curve: null, spec: null };
  let meters = [], previews = [];
  const maskState = { spec: null };

  // ---------------- output renderer (Scanimate chain: grey scan -> feedback -> optional 2D filter -> colorizer) ----------------
  const W = 480, H = 300;
  const mkBuf = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return { c, g: c.getContext('2d', { willReadFrequently: true }) }; };
  let cur = mkBuf(), nxt = mkBuf();
  cur.g.fillStyle = '#000'; cur.g.fillRect(0, 0, W, H);
  const out = $('out'), octx = out.getContext('2d');
  const outImg = octx.createImageData(W, H), out32 = new Uint32Array(outImg.data.buffer);
  const proc = document.createElement('canvas'); proc.width = proc.height = 256; const pg = proc.getContext('2d', { willReadFrequently: true });
  const back = document.createElement('canvas'); back.width = W; back.height = H; const bg = back.getContext('2d', { willReadFrequently: true });
  const gray256 = new Float64Array(256 * 256), img256 = pg.createImageData(256, 256);

  function applyMaskStage(src, mk, mv, needOut) {
    pg.drawImage(src.c, 0, 0, 256, 256);
    const d = pg.getImageData(0, 0, 256, 256).data;
    for (let i = 0; i < 65536; i++) gray256[i] = d[4 * i];
    const r = DSP.applyMask(gray256, mk.mask, 256, needOut ? mv.mix : 0);
    maskState.spec = r.spec;
    if (!needOut) return null;
    let diff = 0;
    for (let i = 0; i < 65536; i++) { const v = clamp(r.out[i], 0, 255); diff += Math.abs(v - gray256[i]); const o = 4 * i; img256.data[o] = img256.data[o + 1] = img256.data[o + 2] = v; img256.data[o + 3] = 255; }
    mk.s.energy = (mk.s.energy || 0) * 0.8 + 0.2 * clamp((diff / 65536 / 255) * 8, 0, 1);
    pg.putImageData(img256, 0, 0);
    bg.drawImage(proc, 0, 0, W, H);
    return bg.getImageData(0, 0, W, H);
  }

  function render() {
    const v = ctx.resolved.render, ins = ctx.ins.render, mk = graph.nodes.mask, mv = ctx.resolved.mask;
    const g = nxt.g;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.save(); g.globalAlpha = v.fb; g.translate(W / 2, H / 2); g.rotate((v.rot * Math.PI) / 180); g.scale(v.zoom, v.zoom); g.translate(-W / 2, -H / 2); g.drawImage(cur.c, 0, 0); g.restore();
    g.globalAlpha = 1; g.globalCompositeOperation = 'lighter';
    const b = Math.round(v.bright * 255), col = `rgb(${b},${b},${b})`;
    g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = v.glow; g.lineWidth = v.width; g.lineJoin = 'round'; g.lineCap = 'round';
    const S = H * 0.45;
    g.beginPath();
    for (const sh of [ins.shape, ins.shape2]) {
      if (!sh) continue;
      for (const pa of sh.paths) {
        const p = pa.p; g.moveTo(W / 2 + p[0] * S, H / 2 + p[1] * S);
        for (let i = 2; i < p.length; i += 2) g.lineTo(W / 2 + p[i] * S, H / 2 + p[i + 1] * S);
        if (pa.closed) g.closePath();
      }
    }
    g.stroke(); g.shadowBlur = 0; g.globalCompositeOperation = 'source-over';
    let data = null;
    const maskOn = mv.on === 'on';
    if (maskOn || tab === 'mask') {
      const f = applyMaskStage(nxt, mk, mv, maskOn);
      if (f) { data = f; if (mv.inloop === 'yes') g.putImageData(f, 0, 0); }
    }
    if (!data) data = g.getImageData(0, 0, W, H);
    const pal = ins.pal || { colors: PRESETS.Tron, shift: 0, steps: 0, gamma: 1 };
    const lut = makeLUT(pal.colors, (pal.shift + v.cycle) % 1, pal.steps, pal.gamma), px = data.data;
    for (let i = 0, n = W * H; i < n; i++) out32[i] = lut[px[4 * i]];
    octx.putImageData(outImg, 0, 0);
    const t = cur; cur = nxt; nxt = t;
  }

  // ---------------- rack ----------------
  function outputsOfType(type, exceptId) {
    const res = [];
    for (const n of Object.values(graph.nodes)) {
      if (n.id === exceptId) continue;
      for (const [port, ty] of Object.entries(OPS[n.op].outs)) if (ty === type) res.push({ label: port === 'out' ? n.id : n.id + '.' + port, from: n.id, port });
    }
    return res;
  }
  function srcSelect(n, key, type) {
    const cur = n.in[key], s = h('select', { title: 'where this value comes from' });
    s.append(h('option', { value: '' }, type === 'num' ? 'manual' : '(none)'));
    for (const o of outputsOfType(type, n.id)) { const op = h('option', { value: o.from + '|' + o.port }, o.label); if (cur && cur.from === o.from && cur.port === o.port) op.selected = true; s.append(op); }
    s.addEventListener('change', () => { if (!s.value) connect(graph, n.id, key, null); else { const [f, p] = s.value.split('|'); connect(graph, n.id, key, f, p); } renderRack(); });
    return s;
  }
  const fmt = (pr, x) => (pr.int ? String(Math.round(x)) : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

  function renderRack() {
    const el = $('rack'); el.innerHTML = ''; meters = []; previews = [];
    const bar = h('div', { class: 'addbar' });
    for (const fam of ['source', 'shape', 'xform', 'palette']) {
      const s = h('select', { title: 'add a ' + FAM[fam][0].toLowerCase() }, h('option', { value: '' }, '+ ' + FAM[fam][0]));
      for (const [op, d] of Object.entries(OPS)) if (d.fam === fam) s.append(h('option', { value: op }, d.label));
      s.addEventListener('change', () => { if (s.value) { const n = addNode(graph, s.value); renderRack(); const st = OPS[n.op].studio; if (st) openTab(st, n.id); } });
      bar.append(s);
    }
    el.append(bar);
    const ids = Object.keys(graph.nodes).sort((a, b) => FAMORDER.indexOf(OPS[graph.nodes[a].op].fam) - FAMORDER.indexOf(OPS[graph.nodes[b].op].fam));
    for (const id of ids) el.append(card(graph.nodes[id]));
    refreshStudios();
  }

  function card(n) {
    const def = OPS[n.op], color = famColor(def.fam);
    const c = h('div', { class: 'card', style: `--c:${color}` });
    const head = h('h3', {}, def.label, h('span', { class: 'id' }, n.id), h('span', { class: 'sp' }));
    if (def.studio) head.append(h('button', { title: 'open the drawing studio', onclick: () => openTab(def.studio, n.id) }, 'draw'));
    if (!def.single) head.append(h('button', { title: 'delete module', onclick: () => { removeNode(graph, n.id); renderRack(); } }, 'x'));
    c.append(head);
    if (Object.values(def.outs).includes('shape')) { const pv = h('canvas', { class: 'prev', width: 96, height: 60 }); c.append(pv); previews.push({ id: n.id, c: pv }); }
    for (const [port, type] of Object.entries(def.ports || {})) {
      const row = h('div', { class: 'row' }, h('label', {}, port), h('span', {}, type === 'shape' ? 'shape in' : 'palette in'), h('span', {}), srcSelect(n, port, type));
      c.append(row);
    }
    for (const pr of def.params) {
      if (pr.type === 'num') {
        const driven = !!n.in[pr.k];
        const sl = h('input', { type: 'range', min: 0, max: 1000, step: 1 }); sl.value = Math.round(clamp(unmapParam(pr, n.p[pr.k]), 0, 1) * 1000);
        const val = h('span', { class: 'val' }, fmt(pr, n.p[pr.k]));
        sl.addEventListener('input', () => { n.p[pr.k] = mapParam(pr, sl.value / 1000); val.textContent = fmt(pr, n.p[pr.k]); });
        const row = h('div', { class: 'row' + (driven ? ' driven' : '') }, h('label', { title: pr.k }, pr.k), sl, val, srcSelect(n, pr.k, 'num'));
        c.append(row);
        if (driven) { const m = h('div', { class: 'meter' }, h('i')); c.append(m); meters.push({ id: n.id, k: pr.k, pr, val, bar: m.firstChild }); }
      } else if (pr.type === 'enum') {
        const s = h('select', {}); for (const o of pr.opts) { const op = h('option', { value: o }, o); if (n.p[pr.k] === o) op.selected = true; s.append(op); }
        s.addEventListener('change', () => { n.p[pr.k] = s.value; });
        c.append(h('div', { class: 'row' }, h('label', {}, pr.k), s));
      } else if (pr.type === 'color') {
        const i = h('input', { type: 'color', value: n.p[pr.k] }); i.addEventListener('input', () => { n.p[pr.k] = i.value; });
        c.append(h('div', { class: 'row' }, h('label', {}, pr.k), i));
      }
    }
    const outs = Object.entries(def.outs);
    if (outs.length) c.append(h('div', { class: 'out-note' }, 'outputs: ' + outs.map(([p, t]) => (p === 'out' ? t : p + ' (' + t + ')')).join(', ')));
    return c;
  }

  function updateLive() {
    for (const m of meters) {
      const r = ctx.resolved[m.id]; if (!r) continue;
      const v = r[m.k]; m.val.textContent = fmt(m.pr, v); m.bar.style.width = clamp(unmapParam(m.pr, v), 0, 1) * 100 + '%';
    }
    for (const p of previews) {
      const o = ctx.outs[p.id], g = p.c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 96, 60);
      if (!o || !o.out) continue;
      g.strokeStyle = '#9fe'; g.lineWidth = 1; g.beginPath();
      for (const pa of o.out.paths) { const q = pa.p; g.moveTo(48 + q[0] * 26, 30 + q[1] * 26); for (let i = 2; i < q.length; i += 2) g.lineTo(48 + q[i] * 26, 30 + q[i + 1] * 26); if (pa.closed) g.closePath(); }
      g.stroke();
    }
  }

  // ---------------- tabs / studios ----------------
  const TABS = [['curve', 'Draw a curve'], ['spec', 'Paint a spectrogram'], ['mask', 'Draw on the 2D spectrum'], ['paint', 'Paint a program']];
  const tabBar = $('tabs');
  for (const [k, label] of TABS) tabBar.append(h('button', { 'data-tab': k, onclick: () => openTab(k) }, label));
  function openTab(k, nodeId) {
    tab = k;
    for (const b of tabBar.children) b.classList.toggle('on', b.dataset.tab === k);
    for (const [kk] of TABS) $('st-' + kk).classList.toggle('show', kk === k);
    if (nodeId && (k === 'curve' || k === 'spec')) { sel[k] = nodeId; }
    refreshStudios();
  }
  function nodesOf(op) { return Object.values(graph.nodes).filter((n) => n.op === op); }
  function fillSelect(selEl, op, key) {
    const list = nodesOf(op); selEl.innerHTML = '';
    if (!list.find((n) => n.id === sel[key])) sel[key] = list.length ? list[0].id : null;
    for (const n of list) { const o = h('option', { value: n.id }, n.id); if (n.id === sel[key]) o.selected = true; selEl.append(o); }
  }
  function refreshStudios() { fillSelect($('cvSel'), 'curve', 'curve'); fillSelect($('sgSel'), 'spec', 'spec'); }
  $('cvSel').onchange = (e) => { sel.curve = e.target.value; };
  $('sgSel').onchange = (e) => { sel.spec = e.target.value; };
  $('cvAdd').onclick = () => { const n = addNode(graph, 'curve'); sel.curve = n.id; renderRack(); };
  $('sgAdd').onclick = () => { const n = addNode(graph, 'spec'); sel.spec = n.id; renderRack(); };

  // pointer helper
  function pos(e, c) { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height]; }
  function dragOn(canvas, onDown, onMove, onUp) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId); onDown(pos(e, canvas), e);
      const mv = (ev) => onMove(pos(ev, canvas), ev);
      const up = (ev) => { canvas.removeEventListener('pointermove', mv); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); if (onUp) onUp(ev); };
      canvas.addEventListener('pointermove', mv); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
      e.preventDefault();
    });
  }

  // ---- curve studio ----
  const cv = $('cv'), cvg = cv.getContext('2d'), cs = $('cvSpec'), csg = cs.getContext('2d');
  let cvLast = null;
  function curveNode() { return sel.curve ? graph.nodes[sel.curve] : null; }
  function setCurve(n, x, y) {
    const L = n.curve.length, i = clamp(Math.round((x / cv.width) * (L - 1)), 0, L - 1), v = clamp(1 - y / cv.height, 0, 1);
    if (cvLast && cvLast.i !== i) { const a = cvLast.i, b = i, s = Math.sign(b - a); for (let k = a; k !== b + s; k += s) n.curve[k] = cvLast.v + ((v - cvLast.v) * (k - a)) / (b - a); } else n.curve[i] = v;
    cvLast = { i, v };
  }
  dragOn(cv, (p) => { const n = curveNode(); if (!n) return; cvLast = null; setCurve(n, p[0], p[1]); }, (p) => { const n = curveNode(); if (n) setCurve(n, p[0], p[1]); }, () => { cvLast = null; });
  document.querySelectorAll('[data-cv]').forEach((b) => b.addEventListener('click', () => {
    const n = curveNode(); if (!n) return; const L = n.curve.length, c = n.curve, k = b.dataset.cv;
    if (k === 'flat') c.fill(0.5); else if (k === 'sine') for (let i = 0; i < L; i++) c[i] = 0.5 + 0.4 * Math.sin((2 * Math.PI * i) / L);
    else if (k === 'saw') for (let i = 0; i < L; i++) c[i] = 0.1 + (0.8 * i) / L;
    else if (k === 'walk') { const r = CORE.rng((Math.random() * 1e9) | 0); let x = 0.5; for (let i = 0; i < L; i++) { x = clamp(x + (r() - 0.5) * 0.12, 0.05, 0.95); c[i] = x; } }
    else if (k === 'smooth') { const o = Float32Array.from(c); for (let i = 0; i < L; i++) c[i] = (o[(i + L - 1) % L] + 2 * o[i] + o[(i + 1) % L]) / 4; }
  }));
  function drawCurve() {
    const n = curveNode(), g = cvg; g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = '#06070a'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#1d2230'; g.lineWidth = 1; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, (cv.height * i) / 4); g.lineTo(cv.width, (cv.height * i) / 4); g.stroke(); }
    g.fillStyle = '#8d93a5'; g.font = '11px sans-serif'; g.fillText('1', 4, 12); g.fillText('0', 4, cv.height - 4);
    if (!n) { g.fillText('No curve module yet. Press "+ Add curve module".', 20, 100); csg.clearRect(0, 0, cs.width, cs.height); return; }
    g.strokeStyle = famColor('source'); g.lineWidth = 2; g.beginPath();
    const L = n.curve.length; for (let i = 0; i < L; i++) { const x = (i / (L - 1)) * cv.width, y = (1 - n.curve[i]) * cv.height; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    const ph = n.s.ph || 0; g.strokeStyle = '#fff6'; g.beginPath(); g.moveTo(ph * cv.width, 0); g.lineTo(ph * cv.width, cv.height); g.stroke();
    // spectrum of the drawn curve
    const re = new Float64Array(L), im = new Float64Array(L), w = DSP.hann(L); let mean = 0; for (let i = 0; i < L; i++) mean += n.curve[i]; mean /= L;
    for (let i = 0; i < L; i++) re[i] = (n.curve[i] - mean) * w[i]; DSP.fft(re, im, false);
    csg.fillStyle = '#06070a'; csg.fillRect(0, 0, cs.width, cs.height); const bins = 64, bw = cs.width / bins;
    for (let k = 1; k <= bins; k++) { const m = Math.hypot(re[k], im[k]) / L * 8, hgt = clamp(Math.log10(1 + m * 400) / 2.6, 0, 1) * (cs.height - 16); csg.fillStyle = famColor('source'); csg.fillRect((k - 1) * bw + 1, cs.height - 14 - hgt, bw - 2, hgt); }
    csg.fillStyle = '#8d93a5'; csg.font = '11px sans-serif'; csg.fillText('spectrum of the drawn curve: bin k = k cycles per loop (1 to 64)', 6, cs.height - 2);
  }

  // ---- spectrogram studio ----
  const sg = $('sg'), sgg = sg.getContext('2d'), sgSmall = document.createElement('canvas'); sgSmall.width = SPEC.W; sgSmall.height = SPEC.H;
  const sgs = sgSmall.getContext('2d'), sgImg = sgs.createImageData(SPEC.W, SPEC.H);
  const SC = sg.width / SPEC.W;
  function specNode() { return sel.spec ? graph.nodes[sel.spec] : null; }
  let sgLast = null;
  function paintSpec(n, x, y, erase) {
    const R = +$('sgR').value, V = +$('sgV').value, cx = x / SC, cy = y / SC;
    const stamp = (px, py) => { for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = Math.round(px + dx), yy = Math.round(py + dy); if (xx < 0 || yy < 0 || xx >= SPEC.W || yy >= SPEC.H) continue; const d = Math.hypot(dx, dy); if (d > R + 0.3) continue; const f = 1 - d / (R + 1), i = yy * SPEC.W + xx; n.grid[i] = erase ? Math.round(n.grid[i] * (1 - Math.min(1, f * 2.2))) : Math.max(n.grid[i], Math.round(V * (0.35 + 0.65 * f))); } };
    if (sgLast) { const dist = Math.hypot(cx - sgLast[0], cy - sgLast[1]), steps = Math.max(1, Math.ceil(dist * 2)); for (let s = 1; s <= steps; s++) stamp(sgLast[0] + ((cx - sgLast[0]) * s) / steps, sgLast[1] + ((cy - sgLast[1]) * s) / steps); } else stamp(cx, cy);
    sgLast = [cx, cy];
  }
  let sgErase = false;
  dragOn(sg, (p, e) => { const n = specNode(); if (!n) return; sgLast = null; sgErase = e.button === 2 || $('sgErase').checked; paintSpec(n, p[0], p[1], sgErase); }, (p) => { const n = specNode(); if (n) paintSpec(n, p[0], p[1], sgErase); }, () => { sgLast = null; if (audio.playing) restartAudio(); });
  $('sgClear').onclick = () => { const n = specNode(); if (n) { n.grid.fill(0); if (audio.playing) restartAudio(); } };
  $('sgUp').onclick = () => { const n = specNode(); if (!n) return; for (let x = 0; x < SPEC.W; x++) { const y = Math.round(SPEC.H - 6 - (x / SPEC.W) * (SPEC.H - 14)); for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < SPEC.H) n.grid[yy * SPEC.W + x] = Math.max(n.grid[yy * SPEC.W + x], 230 - Math.abs(d) * 70); } } if (audio.playing) restartAudio(); };
  $('sgChord').onclick = () => { const n = specNode(); if (!n) return; for (const hz of [220, 277.2, 329.6, 440]) { const y = Math.round((1 - Math.log(hz / SPEC.fmin) / Math.log(SPEC.fmax / SPEC.fmin)) * (SPEC.H - 1)); for (let x = 20; x < SPEC.W - 20; x++) for (let d = 0; d <= 1; d++) n.grid[(y + d) * SPEC.W + x] = Math.max(n.grid[(y + d) * SPEC.W + x], 150); } if (audio.playing) restartAudio(); };
  function drawSpec() {
    const n = specNode(), g = sgg; g.fillStyle = '#06070a'; g.fillRect(0, 0, sg.width, sg.height);
    if (!n) { g.fillStyle = '#8d93a5'; g.font = '13px sans-serif'; g.fillText('No spectrogram module yet. Press "+ Add spectrogram module".', 20, 100); return; }
    const d = sgImg.data;
    for (let i = 0; i < SPEC.W * SPEC.H; i++) { const v = n.grid[i], o = 4 * i; d[o] = Math.min(255, v * 1.6); d[o + 1] = Math.max(0, (v - 90) * 1.7); d[o + 2] = Math.min(255, 30 + v * 0.6 + Math.max(0, v - 200) * 3); d[o + 3] = 255; }
    sgs.putImageData(sgImg, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(sgSmall, 0, 0, sg.width, sg.height);
    g.font = '11px sans-serif'; g.fillStyle = '#fff9';
    for (const hz of [100, 400, 1600, 8000]) { const y = (1 - Math.log(hz / SPEC.fmin) / Math.log(SPEC.fmax / SPEC.fmin)) * (SPEC.H - 1) * SC; g.fillRect(0, y, 8, 1); g.fillText(hz >= 1000 ? hz / 1000 + ' kHz' : hz + ' Hz', 12, clamp(y + 4, 12, sg.height - 3)); }
    const ph = n.s.ph || 0; g.fillStyle = '#fff8'; g.fillRect(ph * sg.width, 0, 2, sg.height);
  }

  // audio
  const audio = { ctx: null, src: null, playing: false, node: null, t0: 0 };
  function ensureAudio() { if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (audio.ctx.state === 'suspended') audio.ctx.resume(); return audio.ctx; }
  function startAudio(offsetFrac) {
    const n = specNode(); if (!n) return; const ac = ensureAudio();
    const samples = DSP.synthSpectrogram(n.grid), buf = ac.createBuffer(1, samples.length, SPEC.sr); buf.copyToChannel(samples, 0);
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; const gain = ac.createGain(); gain.gain.value = 0.7; src.connect(gain); gain.connect(ac.destination);
    const off = (offsetFrac || 0) * buf.duration; src.start(0, off); audio.src = src; audio.playing = true; audio.node = n.id; audio.t0 = ac.currentTime - off; audio.dur = buf.duration; $('sgPlay').textContent = 'Stop sound'; $('sgPlay').classList.add('on');
  }
  function stopAudio() { if (audio.src) { try { audio.src.stop(); } catch (e) { } audio.src = null; } audio.playing = false; $('sgPlay').textContent = 'Play sound'; $('sgPlay').classList.remove('on'); }
  function restartAudio() { const ph = audio.ctx ? (((audio.ctx.currentTime - audio.t0) % audio.dur) / audio.dur) : 0; if (audio.src) { try { audio.src.stop(); } catch (e) { } } startAudio(ph); }
  $('sgPlay').onclick = () => { if (audio.playing) stopAudio(); else startAudio(0); };
  ctx.specPhase = (n) => (audio.playing && audio.node === n.id && audio.ctx ? ((audio.ctx.currentTime - audio.t0) % audio.dur) / audio.dur : (T / SPEC.dur) % 1);

  // ---- mask studio ----
  const mk = $('mk'), mkg = mk.getContext('2d'), mkSmall = document.createElement('canvas'); mkSmall.width = mkSmall.height = 256; const mks = mkSmall.getContext('2d'), mkImg = mks.createImageData(256, 256);
  const maskNode = () => graph.nodes.mask;
  let mkLast = null;
  function paintM(p, e) {
    const n = maskNode(), x = p[0] / 2, y = p[1] / 2, rad = +$('mkR').value, val = +document.querySelector('input[name=mkMode]:checked').value;
    const v = e && e.altKey ? 1 - val : val;
    if (mkLast) { const d = Math.hypot(x - mkLast[0], y - mkLast[1]), st = Math.max(1, Math.ceil(d / (rad / 3))); for (let s = 1; s <= st; s++) DSP.paintMask(n.mask, 256, mkLast[0] + ((x - mkLast[0]) * s) / st, mkLast[1] + ((y - mkLast[1]) * s) / st, rad, v, true, 0.7); } else DSP.paintMask(n.mask, 256, x, y, rad, v, true, 0.7);
    mkLast = [x, y];
  }
  dragOn(mk, (p, e) => { mkLast = null; paintM(p, e); }, (p, e) => paintM(p, e), () => { mkLast = null; });
  document.querySelectorAll('[data-mk]').forEach((b) => b.addEventListener('click', () => {
    const n = maskNode(), k = b.dataset.mk; if (k === 'all') n.mask.fill(1); else if (k === 'low') n.mask = DSP.maskPreset(256, 'low', 22); else if (k === 'high') n.mask = DSP.maskPreset(256, 'high', 22);
    else if (k === 'ring') n.mask = DSP.maskPreset(256, 'ring', 18, 48); else if (k === 'wedge0') n.mask = DSP.maskPreset(256, 'wedge', 0, 22); else if (k === 'wedge90') n.mask = DSP.maskPreset(256, 'wedge', 90, 22);
  }));
  const bindParam = (id, key, conv) => { $(id).addEventListener('input', () => { maskNode().p[key] = conv ? conv($(id).value) : $(id).value; }); };
  bindParam('mkOn', 'on'); bindParam('mkLoop', 'inloop'); bindParam('mkMix', 'mix', (v) => v / 100);
  function syncMaskControls() { const n = maskNode(); if (!n) return; $('mkOn').value = n.p.on; $('mkLoop').value = n.p.inloop; $('mkMix').value = Math.round(n.p.mix * 100); }
  function drawMask() {
    const n = maskNode(), g = mkg, d = mkImg.data, sp = maskState.spec;
    for (let i = 0; i < 65536; i++) { const s = sp ? Math.min(1, sp[i] * 1.15) : 0.1, m = n.mask[i], o = 4 * i, gv = 255 * Math.pow(s, 1.4); d[o] = gv * (0.45 + 0.55 * m) + (1 - m) * 90; d[o + 1] = gv * (0.45 + 0.55 * m); d[o + 2] = gv * (0.45 + 0.55 * m); d[o + 3] = 255; }
    mks.putImageData(mkImg, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(mkSmall, 0, 0, 512, 512);
    g.strokeStyle = '#4cc9f066'; g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 512); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke();
    g.fillStyle = '#fff9'; g.font = '11px sans-serif'; g.fillText('DC (average brightness) = centre', 6, 12); g.fillText('red tint = removed', 6, 26);
  }

  // ---- paint-a-program studio ----
  const PW = 20, PH = 12, CELL = 32, pgc = $('pg'), pgg = pgc.getContext('2d'); let cells = new Uint8Array(PW * PH), brush = 1;
  const sw = $('pgSw');
  CORE.PAINT.forEach((p, i) => { const b = h('button', { 'data-b': i + 1, onclick: () => { brush = i + 1; markBrush(); } }, h('i', { style: `background:${p.c}` }), p.name); sw.append(b); });
  function markBrush() { for (const b of sw.children) b.classList.toggle('on', +b.dataset.b === brush); }
  markBrush();
  let pgErase = false;
  const pgPaint = (p) => { const x = Math.floor(p[0] / CELL), y = Math.floor(p[1] / CELL); if (x >= 0 && y >= 0 && x < PW && y < PH) cells[y * PW + x] = pgErase ? 0 : brush; };
  dragOn(pgc, (p, e) => { pgErase = e.button === 2; pgPaint(p); }, (p) => pgPaint(p));
  function drawPaint() {
    const g = pgg; g.fillStyle = '#06070a'; g.fillRect(0, 0, pgc.width, pgc.height);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) { const v = cells[y * PW + x]; if (v) { g.fillStyle = CORE.PAINT[v - 1].c; g.fillRect(x * CELL, y * CELL, CELL, CELL); } }
    g.strokeStyle = '#ffffff14'; g.lineWidth = 1; for (let x = 0; x <= PW; x++) { g.beginPath(); g.moveTo(x * CELL + .5, 0); g.lineTo(x * CELL + .5, pgc.height); g.stroke(); } for (let y = 0; y <= PH; y++) { g.beginPath(); g.moveTo(0, y * CELL + .5); g.lineTo(pgc.width, y * CELL + .5); g.stroke(); }
  }
  $('pgClear').onclick = () => cells.fill(0);
  $('pgExample').onclick = () => { cells = CORE.paintFromArt(CORE.PAINT_EXAMPLE, PW, PH); };
  $('pgCompile').onclick = () => {
    prevGraphJSON = CORE.serialize(graph);
    const r = CORE.compilePaint(cells, PW, PH, graph);
    graph = r.graph; ctx.outs = {}; renderRack();
    $('report').textContent = `${r.regions} region(s) compiled.\n` + (r.report.length ? r.report.join('\n') : 'No wires made. Regions must touch by an edge.');
  };
  $('pgUndo').onclick = () => { if (!prevGraphJSON) { $('report').textContent = 'Nothing to undo.'; return; } graph = CORE.deserialize(prevGraphJSON); prevGraphJSON = null; ctx.outs = {}; renderRack(); $('report').textContent = 'Previous rack restored.'; };

  // ---------------- header buttons ----------------
  $('bPause').onclick = () => { paused = !paused; $('bPause').textContent = paused ? 'Resume' : 'Pause'; $('bPause').classList.toggle('on', paused); };
  $('bExport').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([CORE.serialize(graph)], { type: 'application/json' })); a.download = 'scanimate-lab-patch.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  $('bImport').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { graph = CORE.deserialize(String(r.result)); if (!graph.nodes.render) addNode(graph, 'render', 'render'); if (!graph.nodes.mask) addNode(graph, 'mask', 'mask'); ctx.outs = {}; renderRack(); syncMaskControls(); } catch (err) { alert('Could not read that patch: ' + err.message); } }; r.readAsText(f); e.target.value = ''; };
  $('bReset').onclick = () => { graph = CORE.defaultGraph(); ctx.outs = {}; stopAudio(); renderRack(); syncMaskControls(); };

  // ---------------- main loop ----------------
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!paused) {
      T += dt; ctx.t = T; ctx.dt = dt; Tele.step(dt, T);
      evaluate(graph, ctx); render(); updateLive();
    }
    if (tab === 'curve') drawCurve(); else if (tab === 'spec') drawSpec(); else if (tab === 'mask') drawMask(); else drawPaint();
    requestAnimationFrame(frame);
  }
  renderRack(); syncMaskControls(); openTab('curve');
  requestAnimationFrame(frame);

  // handles for tests and for plugging real telemetry later
  window.LAB = { get graph() { return graph; }, ctx, CORE, DSP, openTab, renderRack, get cells() { return cells; }, setGraph(g) { graph = g; ctx.outs = {}; renderRack(); }, stats() { return { t: T }; } };
})();
