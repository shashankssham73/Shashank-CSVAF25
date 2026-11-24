// Computing visualizer — a video synthesiser whose input signal is the live
// telemetry of the machine it is running on.
//
// The chain, in order:
//
//   SOURCE      machine map + traffic + structural FUI, drawn small (512x320)
//                 +  SHAPES    distance fields from the patch, written in as
//                 |            luminance so they go through everything below
//                 |                                   luminance + chroma
//   SCAN PROC   Rutt/Etra vertical deflection, per-scanline, hard-keyed
//      and/or   REACTION-DIFFUSION: the raster seeds Gray-Scott on the GPU,
//                 |                 crossfaded against the scan processor by
//                 |                 rd.mix, which is itself a patch destination
//   FEEDBACK    iterated affine warp at gain < 1
//                 |
//   COLOURISER  luminance bands or a gradient ramp -> colour and transparency
//                 |
//   SCREEN      + raw shapes, + crisp readouts that sample the deflection field
//
// Nothing is drawn directly. Every pixel is the result of a signal operation
// on a measurement.

import { P } from './palette.js';
import { BUSES, FAULTS, norm, phaseOf } from './topology.js';
import { Graph, defaultGraph } from '../patch/graph.js';
import { Feedback } from './feedback.js';
import { Particles } from './particles.js';
import { SourceLayer } from './source.js';
import { ScanProcessor } from './scanproc.js';
import { ShapeLayer } from './shapes.js';
import { ReactionDiffusion } from './rd.js';
import { FUI } from './fui.js';

const cv = document.getElementById('stage');
const ctx = cv.getContext('2d');
const fb = new Feedback();
const parts = new Particles(6000);
const src = new SourceLayer();
const scan = new ScanProcessor();
const shapes = new ShapeLayer();
const rd = new ReactionDiffusion(512, 320);
const fui = new FUI();

let W = 0, H = 0, DPR = 1;
let paused = false, scanOn = true, showFui = true, showShapes = true;

// Reaction-diffusion defaults: the coral regime, dormant until rd.mix is
// raised. U = 1, V = 0 is stable, so nothing grows until the machine seeds it.
const RD = { F:0.0545, k:0.0620, Du:1.0, Dv:0.5, dt:1.0,
             iters:16, inject:0.85, decay:0, gain:2.6, bias:0, floor:0.03, mix:0 };

// ?compact=1 — the persistent panel. Act name, travellers, one status line.
fui.compact = new URLSearchParams(location.search).has('compact');

// ---------------------------------------------------------------- the patch
// Signal routing lives in patch.json, edited in patch.html. Nothing in this
// file decides what a channel means. If no patch has been saved, the built-in
// default reproduces exactly what the hardcoded mapping used to do.
let graph = defaultGraph(), patchSrc = 'default', heroDebt = 0;
async function loadPatch() {
  try {
    const r = await fetch('/patch', { cache: 'no-store' });
    if (r.ok) { graph = Graph.fromJSON(await r.json()); patchSrc = 'saved'; }
    else { graph = defaultGraph(); patchSrc = 'default'; }
  } catch (_) { graph = defaultGraph(); patchSrc = 'default'; }
}
loadPatch();

// The patcher's live preview posts its in-memory graph straight here, so the
// image follows an edit without anyone having to save first. Same-origin only.
// Note this re-runs init() on every node exactly as a save does, so filter and
// analysis state restarts on each push -- fine for a preview, which is why the
// full window keeps reading the saved patch instead.
addEventListener('message', e => {
  if (e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.type !== 'patch' || !m.graph) return;
  try { graph = Graph.fromJSON(m.graph); patchSrc = 'live'; } catch (_) {}
});

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.floor(innerWidth * DPR); H = Math.floor(innerHeight * DPR);
  cv.width = W; cv.height = H;
  cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
  fb.resize(W, H);
  scan.W = W; scan.H = H;        // so deflectAt is valid before the first render
  fui.dpr = DPR;
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- telemetry

const raw = {}, sm = {};
let labels = {}, connected = false, lastFrame = 0, frameSeq = 0, demoUntil = 0;
const ema = (k, x, a) => (sm[k] = sm[k] == null ? x : sm[k] + (x - sm[k]) * a);

(function connect() {
  const es = new EventSource('/stream');
  es.onopen = () => connected = true;
  es.onerror = () => connected = false;
  // An unsaved edit from the patcher. This is what makes a floating panel on
  // another Space follow the patcher live instead of waiting for a save.
  es.addEventListener('live', e => {
    try {
      const d = JSON.parse(e.data);
      if (d.which && d.which !== '/patch') return;
      graph = Graph.fromJSON(d.graph);
      patchSrc = 'live';
    } catch (_) {}
  });
  es.addEventListener('patch', () => loadPatch());   // live re-patch, no reload
  es.onmessage = e => {
    let f; try { f = JSON.parse(e.data); } catch (_) { return; }
    connected = true; lastFrame = performance.now(); frameSeq = f.seq;
    Object.assign(raw, f.ch);
    const prev = labels['fs.last_path'];
    labels = f.lab || {};
    const p = labels['fs.last_path'];
    if (p && p !== prev && p !== '-') parts.spawnHero(p.split('/').pop(), 'file');
  };
})();

function demoFrame(t) {
  const s = (f, ph) => 0.5 + 0.5 * Math.sin(t * f + ph);
  raw['cpu.busy_pct']        = 25 + 62 * s(0.7, 0);
  raw['cpu.user_pct']        = 18 + 44 * s(0.7, 0);
  raw['cpu.sys_pct']         = 7 + 18 * s(1.1, 2);
  raw['load.1m']             = 2 + 6 * s(0.3, 1);
  raw['disk.mb_per_s']       = 110 * s(0.5, 1);
  raw['disk.tps']            = 1800 * s(0.5, 1.2);
  raw['vm.faults_per_s']     = 1.1e5 * s(0.9, 3);
  raw['vm.cow_per_s']        = 9e3 * s(1.3, 1);
  raw['vm.pageins_per_s']    = 800 * s(0.4, 2);
  raw['vm.pageouts_per_s']   = 900 * Math.max(0, s(0.22, 4) - 0.45) * 2;
  raw['vm.compress_per_s']   = 5000 * Math.max(0, s(0.25, 1) - 0.4) * 2;
  raw['vm.decompress_per_s'] = 2600 * s(0.6, 5);
  raw['vm.free_mb']          = 3000 + 2000 * s(0.2, 0);
  raw['vm.compressor_mb']    = 1800 + 900 * s(0.18, 2);
  raw['net.in_bytes_per_s']  = 1.7e6 * s(0.33, 2);
  raw['net.out_bytes_per_s'] = 6e5 * s(0.47, 0);
  raw['net.retx_per_s']      = 16 * Math.max(0, s(0.3, 3) - 0.5) * 2;
  raw['net.rtt_avg_ms']      = 40 + 60 * s(0.21, 1);
  raw['pwr.watts']           = 12 + 26 * s(0.6, 2);
  raw['in.events']           = 30 * s(1.7, 0);
  raw['in.cursor_speed']     = 2 * s(2.3, 1);
  raw['fs.events']           = Math.random() < 0.09 ? 4 : 0;
  if (Math.random() < 0.014) parts.spawnHero('demo-' + (1000 + (Math.random() * 9000 | 0)) + '.pdf', 'file');
}

// ---------------------------------------------------------------- loop

let last = performance.now(), fps = 60;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fps += ((1 / Math.max(dt, 1e-4)) - fps) * 0.08;
  if (paused) return;

  if (demoUntil > now) demoFrame(now / 1000);
  if (now - lastFrame > 3000 && demoUntil < now) connected = false;

  for (const k of ['cpu.busy_pct', 'cpu.user_pct', 'cpu.sys_pct']) ema(k, raw[k] || 0, 0.12);

  // ---- the patch graph is the entire mapping ---------------------------
  const G = graph.eval({ dt, t: now / 1000, raw, labels });

  for (const b of BUSES) {
    if (b.dead || !b.ch) continue;
    const lvl = Math.max(0, G['bus.' + b.id] ?? 0);
    sm['lvl.' + b.id] = lvl;
    let warnLvl = b.warn ? 0.85 : 0;
    for (const f of FAULTS) if (f.bus === b.id) warnLvl = Math.max(warnLvl, norm(raw[f.ch] || 0, f.ref));
    parts.emitFlow(b, lvl, dt, warnLvl);
    ema('node.' + b.to, lvl, 0.08);
  }
  parts.speedMul = Number.isFinite(G['particle.speed']) ? G['particle.speed'] : 1;
  parts.step(dt, G['hero.deathProb'] || 0);

  // optional extra travellers, so a demo need not wait on FSEvents
  const sr = G['hero.spawnRate'] || 0;
  if (sr > 0) {
    heroDebt += sr * dt;
    while (heroDebt >= 1) {
      heroDebt -= 1;
      const p = labels['fs.last_path'];
      parts.spawnHero(p && p !== '-' ? p.split('/').pop() : 'anon', 'file');
    }
  }
  fui.push(raw);

  const apply = (k, set) => { const v = G[k]; if (Number.isFinite(v)) set(v); };
  apply('scan.amp',     v => scan.amp = v);
  apply('scan.persp',   v => scan.persp = v);
  apply('scan.key',     v => scan.key = v);
  apply('scan.gainR',   v => scan.gainR = v);
  apply('scan.floor',   v => scan.floor = v);
  apply('scan.density', v => scan.refDensity = v);
  apply('scan.rowStep', v => scan.rowStep = Math.max(1, Math.min(8, Math.round(v))));
  apply('fb.gain',      v => fb.gain = v);
  apply('fb.zoom',      v => fb.zoom = v);
  apply('fb.rot',       v => fb.rot = v);
  apply('type.warp',    v => fui.warp = v);
  apply('rd.mix',       v => RD.mix    = Math.min(1, Math.max(0, v)));
  apply('rd.feed',      v => RD.F      = v);
  apply('rd.kill',      v => RD.k      = v);
  apply('rd.inject',    v => RD.inject = v);
  apply('rd.iters',     v => RD.iters  = v);
  apply('rd.decay',     v => RD.decay  = v);
  apply('rd.gain',      v => RD.gain   = v);
  apply('rd.diffV',     v => RD.Dv     = v);
  apply('rd.floor',     v => RD.floor  = v);

  // The graph supplies the magnitude of the tear; the sign stays noise, because
  // a dropout has no preferred direction.
  scan.skew = Number.isFinite(G['scan.skew']) ? G['scan.skew'] * (Math.random() - 0.5) * 2 : 0;

  // The colouriser is reconfigured every frame. Passing undefined when no
  // colouriser node exists reverts it to the original two-colour key.
  scan.col.configure(G.$color);

  // ---- chain ------------------------------------------------------------
  const img = src.draw(parts, sm, showFui ? (c, sw, sh) => fui.structural(c, sw, sh) : null);

  // Shapes go in BEFORE the scan processor reads the raster, so a shape is
  // deflected and fed back exactly like a bus is. Raw-routed shapes are
  // skipped here and composited over the finished frame further down.
  if (showShapes) shapes.applyToRaster(img, G.$shapes);

  // The chemistry is seeded by the finished raster — machine map, shapes and
  // every traveller — so a particle moving along a bus injects V where it
  // passes rather than being drawn as a dot. Only run it when it is audible.
  const wet = rd.ok ? RD.mix : 0;
  if (wet > 0.002) {
    rd.seed(img);
    rd.step(RD);
    rd.render(scan.col, RD.gain, RD.bias, scan.key, RD.floor);
  }

  const pctx = fb.begin();
  // Crossfade. At mix 0 this is exactly the image before reaction-diffusion
  // existed; at 1 the scan processor is silent and only the chemistry shows.
  if (scanOn && wet < 0.998) {
    pctx.globalAlpha = 1 - wet;
    scan.render(pctx, img, W, H, P);
    pctx.globalAlpha = 1;
  } else if (!scanOn && wet < 0.998) {
    pctx.globalAlpha = 1 - wet;
    pctx.drawImage(src.cv, 0, 0, W, H);             // bypass, to see the raw source
    pctx.globalAlpha = 1;
  }
  if (wet > 0.002) {
    pctx.globalAlpha = wet;
    pctx.drawImage(rd.canvas, 0, 0, W, H);
    pctx.globalAlpha = 1;
  }

  // Ground first, then the accumulated field over it, then the readouts.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);
  fb.end(ctx);

  // Raw shapes sit above the field but below the readouts, so a label is never
  // buried by one.
  if (showShapes) shapes.drawRaw(ctx, W, H, G.$shapes, scan.col, scan.key);

  if (showFui) {
    fui.overlay(ctx, W, H, scan, raw, labels, phaseOf(raw), {
      connected, seq: frameSeq, fps, demo: demoUntil > now,
      parts: parts.count, arrived: parts.arrived, gain: fb.gain,
      patch: patchSrc, nodes: graph.nodes.size,
      shapes: shapes.count, shapeMs: shapes.ms, colorizer: scan.col.name,
      rd: rd.ok ? (wet > 0.002 ? RD.mix : 0) : -1, rdIters: rd.iters, rdWhy: rd.reason,
      heroes: parts.heroes.map(h => h.label),
    });
  }
}

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === ' ') { paused = !paused; e.preventDefault(); }
  if (k === 'f') fb.enabled = !fb.enabled;
  if (k === 's') scanOn = !scanOn;
  if (k === 'h') showFui = !showFui;
  if (k === 'g') showShapes = !showShapes;
  // R cycles the chemistry in by hand, for when there is no rd.mix in the
  // patch yet. Shift-R wipes the field back to the stable state.
  if (k === 'r') { RD.mix = e.shiftKey ? RD.mix : (RD.mix > 0.5 ? 0 : 1); if (e.shiftKey) rd.reset(); }
  if (k === 't') fui.warp = fui.warp > 0.05 ? 0 : 0.40;
  if (k === 'c') { fb.clear(); parts.clear(); }
  if (k === 'd') demoUntil = performance.now() + 45000;
  if (k === '[') fb.gain = Math.max(0.80, fb.gain - 0.01);
  if (k === ']') fb.gain = Math.min(0.995, fb.gain + 0.01);
  if (k === '-') scan.rowStep = Math.min(8, scan.rowStep + 1);
  if (k === '=') scan.rowStep = Math.max(1, scan.rowStep - 1);
});

resize();
requestAnimationFrame(frame);
