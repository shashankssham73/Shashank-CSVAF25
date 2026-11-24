// main.js — the Psychedelic OS view.
//
// A synthetic desktop whose every letter is under signal control. The patch
// decides what the signals do; nothing in this file chooses an effect.
//
// The chain:
//
//   mockDesktop()      a reproducible desktop: windows, folders, text
//        |
//   layout()           every letter becomes an addressable glyph that knows
//        |             its word, its line and where both of those sit
//   applyStack()       the patch's modulators, top to bottom
//        |
//   drawGlyphs()       one transform per glyph
//        |
//   ImageChain         the Computing Visualizer's whole image pipeline —
//                      scan processor, chemistry, feedback, colouriser —
//                      crossfaded against the crisp desktop by chain.mix
//
// TWO SOURCES. The mock desktop has STRUCTURE — glyphs, words, lines — which
// is what the typography operators address. A captured screen is PIXELS, so
// the image chain can process it and the typography cannot. Recovering
// structure from a real desktop means the Accessibility API, which a browser
// cannot reach; that is the boundary between what runs here and what would
// need native code.

import { Graph } from '../m0-telemetry/patch/graph.js';
import { defaultPsyche } from './defaults.js';
import { mockDesktop, layout } from './scene.js';
import { botanicalScene } from './botanical.js';
import { axScene } from './semantic.js';
import { applyStack, identity, applySurfaceStack, surfIdentity } from './modulate.js';
import { drawChrome, drawGlyphs, drawScene, makeMeasurer, PAL, FONT } from './render.js';
import { ImageChain } from './chain.js';
import { ScreenCapture } from './capture.js';
import { TileLayer } from './tilelayer.js';
import { matches } from '../m0-telemetry/patch/selection.js';

const cv = document.getElementById('stage');
const ctx = cv.getContext('2d');
const measure = makeMeasurer(ctx);
const xform = identity();
const sform = surfIdentity();
const chain = new ImageChain();
const cap = new ScreenCapture();
const tiles = new TileLayer();

let W = 0, H = 0, DPR = 1, scene = null;
let paused = false, showText = true, bypass = false, forceWet = -1;
// ---------------------------------------------------------------- float
// Keeping the render visible while you work in another application is the
// one thing a browser window cannot do: there is no always-on-top. Picture
// in Picture is the exception — the system owns that window, so it floats
// above every app, follows you across Spaces, and keeps painting while this
// tab is in the background. The canvas is captured as a video stream and
// handed to it.
let pipVideo = null, floatCv = null, floatCtx = null, floatTrack = null;

// The floated picture is its own canvas, not the live one, for three reasons:
// the preview pane can be any size and a stream whose canvas is resized goes
// black; a 16:10 window gives the system something sensible to letterbox; and
// capturing a canvas we own means we decide when a frame is produced.
const FLOAT_W = 960, FLOAT_H = 600;
const FLOAT_MS = 50;          // ~20fps into the floating window is plenty
let lastFloatPush = 0;

// Two APIs: the standard one, and Safari's older webkitSetPresentationMode,
// which is the one actually available in most Safari builds.
export function canFloat() {
  if (!HTMLCanvasElement.prototype.captureStream) return false;
  const v = document.createElement('video');
  return !!(v.requestPictureInPicture && document.pictureInPictureEnabled)
      || (typeof v.webkitSetPresentationMode === 'function'
          && v.webkitSupportsPresentationMode
          && v.webkitSupportsPresentationMode('picture-in-picture'));
}

// The patcher keeps its own preview pane. While the render is floating that
// is a second copy of the same picture, so tell the parent to put it away.
function tellParentFloating(on) {
  try { if (parent !== window) parent.postMessage({ type:'floating', on }, location.origin); }
  catch (_) {}
}

export function isFloating() {
  return !!document.pictureInPictureElement
      || !!(pipVideo && pipVideo.webkitPresentationMode === 'picture-in-picture');
}

// Called at the end of every painted frame while floating. The copy keeps the
// floating canvas current; requestFrame, where it works, also nudges a frame
// out while this tab is in the background and the browser has stopped
// volunteering them.
function pushFloatFrame(force) {
  if (!floatTrack || !floatCtx) return;
  const t = performance.now();
  if (!force && t - lastFloatPush < FLOAT_MS) return;
  lastFloatPush = t;
  floatCtx.drawImage(cv, 0, 0, FLOAT_W, FLOAT_H);
  // Harmless when the track is producing frames automatically.
  if (floatTrack.requestFrame) floatTrack.requestFrame();
}

// Built once, up front, and kept warm. Everything here used to happen on the
// click -- but creating the video, awaiting play() and waiting for metadata
// are all asynchronous, and Safari only honours requestPictureInPicture()
// while the user gesture that triggered it is still live. The first await
// ended the gesture, so the request was rejected every time. Now the click
// does nothing but ask.
function ensureFloatRig() {
  if (pipVideo) return;
  floatCv = document.createElement('canvas');
  floatCv.width = FLOAT_W; floatCv.height = FLOAT_H;
  floatCtx = floatCv.getContext('2d');
  floatCtx.fillStyle = '#0a0d14';
  floatCtx.fillRect(0, 0, FLOAT_W, FLOAT_H);

  pipVideo = document.createElement('video');
  pipVideo.muted = true;
  pipVideo.playsInline = true;
  pipVideo.autoplay = true;
  // In the layout, not parked off at -10000px: Safari can skip rendering for
  // an element that far outside the viewport, and a video it never rendered
  // goes into Picture in Picture black.
  pipVideo.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;'
                         + 'opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(pipVideo);

  // Automatic frame production, at 30fps. frameRate 0 would mean the browser
  // produces NOTHING except frames we ask for with requestFrame() -- and
  // Safari exposing that method is not the same as it delivering frames. A
  // video that never got one has no dimensions, and requestPictureInPicture
  // on it fails with "the video element is not ready", which is exactly what
  // the log showed. requestFrame below is kept as a bonus, not a dependency.
  const stream = floatCv.captureStream(30);
  floatTrack = stream.getVideoTracks()[0];
  pipVideo.srcObject = stream;
  pushFloatFrame(true);                   // something to measure
  pipVideo.play().catch(() => {});        // muted autoplay needs no gesture
}

// Synchronous up to the request itself. Returns the promise so a caller can
// see the real failure, but does not await anything before asking.
export function floatOut() {
  if (!cv.captureStream) return Promise.reject(new Error('this browser cannot capture a canvas'));
  if (isFloating()) {
    hiddenClock(false);
    tellParentFloating(false);
    if (document.pictureInPictureElement) return document.exitPictureInPicture().then(() => false);
    pipVideo.webkitSetPresentationMode('inline');
    return Promise.resolve(false);
  }
  ensureFloatRig();
  pushFloatFrame(true);
  hiddenClock(true);
  if (pipVideo.requestPictureInPicture && document.pictureInPictureEnabled) {
    return pipVideo.requestPictureInPicture().then(() => { tellParentFloating(true); return true; });
  }
  if (typeof pipVideo.webkitSetPresentationMode === 'function') {
    pipVideo.webkitSetPresentationMode('picture-in-picture');
    tellParentFloating(true);
    return Promise.resolve(true);
  }
  hiddenClock(false);
  return Promise.reject(new Error('no Picture in Picture API in this browser'));
}
window.psycheFloat = floatOut;

// ---------------------------------------------------------------- the log
// Everything that would otherwise only reach the console. Shown on the page
// because the page is where the problem is being looked at.
const diagLines = [];
export function diag(msg, kind) {
  const t = new Date().toLocaleTimeString('en-GB', { hour12:false });
  diagLines.push({ t, msg: String(msg), kind: kind || '' });
  while (diagLines.length > 7) diagLines.shift();
  const box = document.getElementById('diag');
  const out = document.getElementById('diaglines');
  if (!box || !out) return;
  box.classList.add('on');
  out.innerHTML = diagLines.map(l =>
    `<div class="l ${l.kind}">${l.t}  ${l.msg.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>`).join('');
}
window.psycheDiag = diag;
let saidReady = false;
const sayReady = () => { if (!saidReady) { saidReady = true; diag('ready — pick a source below'); } };
addEventListener('DOMContentLoaded', sayReady, { once:true });
if (document.readyState !== 'loading') sayReady();
addEventListener('error', e => diag('ERROR ' + (e.message || e), 'bad'));
addEventListener('unhandledrejection', e =>
  diag('UNHANDLED ' + ((e.reason && e.reason.message) || e.reason), 'bad'));

const compact = new URLSearchParams(location.search).has('compact');
if (compact) document.body.classList.add('compact');
let live = false;                       // true once a capture is running
let source = 'mock';                    // 'mock' | 'bot' | 'ax' | 'live'
let tree = null, treeErr = '', treePath = '~/Documents', treeLoading = false;
let ax = null, axErr = '', axAt = 0, axBusy = false, axHeld = false, axApp = '';
let lastWet = 0, repaintSrc = null;     // so the source bar can report the chain
let lastAdvice = '';
let lastGlyphs = [];
let reachAt = 0;

// The mock desktop is authored at this size and scaled to fit, so the layout
// is identical whatever the window is — which is what makes it reproducible.
const BASE_W = 1440, BASE_H = 900;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.floor(innerWidth * DPR); H = Math.floor(innerHeight * DPR);
  cv.width = W; cv.height = H;
  cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
}
addEventListener('resize', resize);
scene = mockDesktop(BASE_W, BASE_H);

// ---------------------------------------------------------------- the tree
// Fetched once. The daemon reads only the directories it already watches for
// FSEvents, names and sizes only, so this needs no permission that the
// telemetry did not already have.
async function loadTree(p) {
  treeErr = '';
  try {
    const r = await fetch(`/tree?path=${encodeURIComponent(p)}&depth=5&max=600`, { cache:'no-store' });
    const j = await r.json();
    if (j.error) { treeErr = j.error; tree = null; return false; }
    tree = j.tree; treePath = p;
    return true;
  } catch (e) { treeErr = String(e.message || e); tree = null; return false; }
}

// ---------------------------------------------------------------- the screen
// A full Accessibility walk is an IPC round trip per attribute, so it is
// polled on its own slow schedule rather than per frame — the geometry it
// returns is re-laid-out every frame regardless, so the typography still
// animates at full rate between snapshots.
// HOLDING. The Accessibility reader returns the FRONTMOST application, and
// the moment you look at the patcher to change something, that application is
// the browser — so the view would swap to showing its own page, which is both
// useless and a hall of mirrors.
//
// So a snapshot of ourselves is discarded and the previous one kept. Look at
// Finder, switch back to the patcher, and the view is still showing Finder
// while you build the effect for it. The patcher's inspector already did
// this; the view did not, which made designing against a real window a matter
// of switching back and forth and hoping.
const OURS = /Patcher\s*[—-]\s*|Psychedelic OS|Computing Visualizer/i;

// Drop our own windows, keep every other app. Discarding the whole snapshot
// when it looked like us deadlocked: the frontmost application while you are
// using the patcher IS the patcher, so a first reading never arrived.
function stripSelf(j) {
  const kept = (j.elements || []).filter(e => !(e.window && OURS.test(e.window)));
  return { ...j, elements: kept };
}

async function loadAx() {
  if (axBusy) return;
  axBusy = true;
  try {
    // every application with windows, not only the frontmost
    const r = await fetch('/ax?all=1&max=1200&budget=2200&ttl=1200', { cache:'no-store' });
    const j = await r.json();
    if (!j.ok) { axErr = j.error || 'not available'; }
    else {
      const s = stripSelf(j);
      if (s.elements.length) {
        ax = s; axErr = ''; axHeld = false;
        const apps = [...new Set(s.elements.map(e => e.app))];
        axApp = apps.length > 2 ? `${apps.length} apps` : apps.join(' + ');
      } else axHeld = true;
    }
  } catch (e) { axErr = String(e.message || e); }
  axAt = performance.now();
  axBusy = false;
}

// ---------------------------------------------------------------- patch
let graph = defaultPsyche(), patchSrc = 'default';
async function loadPatch() {
  try {
    const r = await fetch('/m1/patch', { cache: 'no-store' });
    if (r.ok) { graph = Graph.fromJSON(await r.json()); patchSrc = 'saved'; }
    else { graph = defaultPsyche(); patchSrc = 'default'; }
  } catch (_) { graph = defaultPsyche(); patchSrc = 'default'; }
}
loadPatch();

// the patcher's live preview pushes its in-memory graph straight in
addEventListener('message', e => {
  if (e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.type !== 'patch' || !m.graph) return;
  try { graph = Graph.fromJSON(m.graph); patchSrc = 'live'; } catch (_) {}
});

// ---------------------------------------------------------------- telemetry
const raw = {};
let labels = {}, connected = false, lastFrame = 0, demoUntil = 0;
(function connect() {
  const es = new EventSource('/stream');
  es.onopen = () => connected = true;
  es.onerror = () => connected = false;
  // An unsaved edit from the patcher. This is what makes a floating panel on
  // another Space follow the patcher live instead of waiting for a save.
  es.addEventListener('live', e => {
    try {
      const d = JSON.parse(e.data);
      if (d.which && d.which !== '/m1/patch') return;
      graph = Graph.fromJSON(d.graph);
      patchSrc = 'live';
    } catch (_) {}
  });
  es.addEventListener('patch', e => {
    // only re-read when it was OUR patch that was saved
    try { const d = JSON.parse(e.data); if (d.which && d.which !== '/m1/patch') return; } catch (_) {}
    loadPatch();
  });
  es.onmessage = e => {
    let f; try { f = JSON.parse(e.data); } catch (_) { return; }
    connected = true; lastFrame = performance.now();
    Object.assign(raw, f.ch);
    labels = f.lab || {};
  };
})();

function demoFrame(t) {
  const s = (f, p) => 0.5 + 0.5 * Math.sin(t * f + p);
  raw['cpu.busy_pct']      = 20 + 70 * s(0.5, 0);
  raw['vm.pageouts_per_s'] = 900 * Math.max(0, s(0.17, 2) - 0.55) * 2.2;
  raw['disk.tps']          = 1600 * s(0.4, 1);
  raw['net.in_bytes_per_s']= 1.4e6 * s(0.3, 2);
  raw['in.events']         = 28 * s(1.4, 0);
}

// ---------------------------------------------------------------- loop
let last = performance.now(), fps = 60, glyphCount = 0, modCount = 0, drawMs = 0;

// rAF is throttled to nothing while the tab is in the background — which is
// precisely when the floating window is the only thing you can see. So the
// work is split from the scheduling: rAF drives it while the page is visible,
// and a Worker's timer drives it while the page is hidden. A worker's clock
// is not throttled the way the page's is.
function frame(now) {
  requestAnimationFrame(frame);
  if (!document.hidden) tick(now);
}
let clockWorker = null;
function hiddenClock(on) {
  if (on && !clockWorker) {
    const js = 'let id=null;onmessage=e=>{if(e.data){if(!id)id=setInterval(()=>postMessage(0),33);}' +
               'else{clearInterval(id);id=null;}};';
    clockWorker = new Worker(URL.createObjectURL(new Blob([js], { type:'text/javascript' })));
    clockWorker.onmessage = () => { if (document.hidden) tick(performance.now()); };
  }
  if (clockWorker) clockWorker.postMessage(on ? 1 : 0);
}

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fps += ((1 / Math.max(dt, 1e-4)) - fps) * 0.08;
  if (paused) return;

  if (demoUntil > now) demoFrame(now / 1000);
  if (now - lastFrame > 3000 && demoUntil < now) connected = false;

  const G = graph.eval({ dt, t: now / 1000, raw, labels });
  const stack  = bypass ? [] : (G.$text || []);
  const lstack = bypass ? [] : (G.$layout || []);
  modCount = stack.length + lstack.length;

  const t0 = performance.now();
  const T = now / 1000;

  // Draws the source into whatever context and size it is given, so the same
  // code paints the crisp dry pass and the raster the image chain consumes.
  // Botanical rebuilds its scene every frame, because its geometry is driven
  // by the patch and the patch can change on any frame.
  if (source === 'bot' && !tree && !treeErr && !treeLoading) {
    treeLoading = true;
    loadTree(treePath).finally(() => { treeLoading = false; });
  }
  if (source === 'bot' && tree) {
    scene = botanicalScene(tree, BASE_W, BASE_H, G.$bot || {});
  } else if (source === 'ax') {
    // A full walk of every app costs around 650 ms of inter-process calls, so
    // it is polled slowly. The geometry is re-laid-out every frame regardless,
    // so the typography keeps animating at full rate between snapshots.
    if (now - axAt > 2500) loadAx();            // poll, do not block the frame
    scene = ax ? axScene(ax, BASE_W, BASE_H) : { W:BASE_W, H:BASE_H, chrome:[], blocks:[], surfaces:[] };
  } else if (source === 'mock' && scene.stats) {
    scene = mockDesktop(BASE_W, BASE_H);        // back from a generated source
  }

  const useLive = live && cap.ready;
  const drawDesktop = (c, w, h, wall, raw) => {
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = wall;
    c.fillRect(0, 0, w, h);
    if (useLive) {
      // A captured screen has no glyphs, so typography cannot reach it — but
      // it is still one rectangle, so the LAYOUT operators can. Treating the
      // whole frame as a single `window` surface means rotate, tilt, scale,
      // spiral and gravity all work on your real desktop.
      glyphCount = 0;
      const ss = { id:'screen', kind:'window', x:0, y:0, w, h,
                   cx:w/2, cy:h/2, i:0, kindIndex:0, ofKind:1 };
      // `raw` means: this frame is about to be cut into tiles. The stack will
      // be applied per tile, so applying it to the whole frame as well would
      // transform the same pixels twice.
      const o = (lstack.length && !raw) ? applySurfaceStack(ss, lstack, T, w, h, sform) : null;
      c.save();
      if (o) {
        c.translate(ss.cx + o.dx, ss.cy + o.dy);
        if (o.rot) c.rotate(o.rot);
        if (o.kx || o.ky) c.transform(1, o.ky, o.kx, 1, 0, 0);
        if (o.sx !== 1 || o.sy !== 1) c.scale(o.sx, o.sy);
        c.translate(-ss.cx, -ss.cy);
      }
      cap.draw(c, w, h);
      c.restore();
    } else {
      const s = w / BASE_W;
      c.setTransform(s, 0, 0, s, 0, 0);
      const glyphs = showText ? layout(scene.blocks, measure, stack,
                                      { W: scene.W || BASE_W, H: scene.H || BASE_H }) : [];
      glyphCount = glyphs.length;
      lastGlyphs = glyphs;                  // kept so per-block reach can be counted
      // Surface transforms wrap everything; the typography stack runs inside
      // them, so a rotated window's letters wave along its own rotated line.
      drawScene(c, scene, glyphs,
                lstack.length ? sf => applySurfaceStack(sf, lstack, T, BASE_W, BASE_H, sform) : null,
                g => applyStack(g, stack, T, BASE_W, BASE_H, xform));
    }
    c.restore();
  };

  // --- READ -------------------------------------------------------------
  // A reader turns the screen into units you can select and transform. When
  // one is active the source is drawn THROUGH those units — each tile is a
  // patch of the real frame, moved by whatever the layout stack says — so
  // the pixels are never approximated, only cut up and transported.
  const readSpecs = G.$read || [];

  // A patch asks for one of two things, and getting the wrong source is the
  // commonest way for it to look broken rather than wrong:
  //
  //   grid / regions  need PIXELS     -> capture my screen
  //   elements, type  need STRUCTURE  -> read my screen
  //
  // Both are legitimate on any source — a grid will happily tile whatever is
  // being rendered — but if you loaded a preset to see it on your own screen,
  // the source has to be able to supply what it reads.
  const wantsPixels = readSpecs.some(s => s.kind === 'grid' || s.kind === 'regions');
  const wantsStructure = (G.$text || []).length > 0
                      || readSpecs.some(s => s.kind === 'elements');
  // How much of the picture the image chain replaces. Computed here rather
  // than further down because the advice below needs it.
  const wet = forceWet >= 0 ? forceWet
            : Number.isFinite(G['chain.mix']) ? Math.min(1, Math.max(0, G['chain.mix'])) : 0;
  // Fully wet means the source is not visible at all: it is only a seed for
  // the chain. A perfectly working tree looks broken in that state.
  const chainHides = wet > 0.98;
  // Persists until the capture is started again, rather than expiring on a
  // timer: a message that has already vanished by the time you look at a
  // screenshot is no use for working out what happened.
  const advice = (!useLive && cap.endedAt)
                 ? 'screen sharing ended — click "capture my screen" to resume'
                   + (isFloating() ? ' (it ended while floating — try "own window")' : '')
               : (source === 'bot' && treeErr) ? 'tree: ' + treeErr
               : (source === 'bot' && !tree) ? 'reading your folders…'
               : (chainHides && source !== 'live')
                 ? 'the image chain is replacing the picture — lower chain.mix to see the source'
               : (isFloating() && source === 'mock')
                 ? 'this is the MOCK desktop — click "capture my screen" for your real one'
               : wantsStructure && useLive ? 'this patch needs structure — switch to "read my screen"'
               : wantsPixels && !useLive && source !== 'ax'
                 ? 'this patch reads pixels — "capture my screen" gives it your real ones'
               : '';
  if (advice !== lastAdvice) { lastAdvice = advice; if (repaintSrc) repaintSrc(); }
  const units = tiles.sample((c, w, h) => drawDesktop(c, w, h, '#000', true), readSpecs, W, H);
  const tiled = units.length > 0;

  // How many of those units any layout effect actually reaches. This is the
  // number that answers "is the preset doing anything?": units found says the
  // reader worked, units reached says the selection did. Zero reached draws
  // every tile untransformed, which looks exactly like an untouched mirror —
  // the one failure that is invisible without being counted.
  let reached = 0;
  if (tiled && lstack.length) {
    for (const u of units) {
      for (const m of lstack) {
        if (m.match ? matches(m.match, u)
                    : !(m.target && m.target !== 'all' && m.target !== u.kind)) { reached++; break; }
      }
    }
  }

  const paintSource = (c, w, h, wall) => {
    if (!tiled) { drawDesktop(c, w, h, wall); return; }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = wall;
    c.fillRect(0, 0, w, h);
    // Units are measured in the tile canvas's own space, so phase sources
    // like `x` and `y` must normalise against that, not the authored desktop.
    tiles.draw(c, w, h,
      lstack.length ? u => applySurfaceStack(u, lstack, T, tiles.w, tiles.h, sform) : null);
    c.restore();
  };

  // the source bar's hint depends on this, and it is only known here
  if (Math.abs(wet - lastWet) > 0.005) { lastWet = wet; if (repaintSrc) repaintSrc(); }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAL.wall;
  ctx.fillRect(0, 0, W, H);

  // fit the authored desktop into the window
  const k = Math.min(W / BASE_W, H / BASE_H);
  const ox = (W - BASE_W * k) / 2, oy = (H - BASE_H * k) / 2;

  // --- dry: the crisp, usable desktop ------------------------------------
  // Drawn directly rather than through the raster, so at mix 0 the text is
  // exactly as sharp as if none of the chain existed.
  if (wet < 0.998) {
    ctx.save();
    ctx.globalAlpha = 1 - wet;
    if (tiled) paintSource(ctx, W, H, PAL.wall);
    else if (useLive) drawDesktop(ctx, W, H, PAL.wall);
    else {
      ctx.setTransform(k, 0, 0, k, ox, oy);
      drawDesktop(ctx, BASE_W, BASE_H, PAL.wall);
    }
    ctx.restore();
  }

  // --- wet: everything the Computing Visualizer does, to a desktop --------
  // The raster is filled black, not with the wall colour: the scan processor
  // skips anything below scan.floor, so a black ground costs nothing while a
  // near-black one would stroke a faint scanline across the whole frame.
  if (wet > 0.002) {
    chain.render((c, w, h) => paintSource(c, w, h, '#000'), G, ctx, W, H, wet, T);
  }

  drawMs = performance.now() - t0;

  // ---- what each block is actually reaching -----------------------------
  // The patcher can show you the graph but not its consequences: only the
  // renderer knows how many things a block landed on. Counted here and sent
  // back, so wiring a block in produces a number next to it instead of a
  // guess about whether anything happened.
  if (now - reachAt > 250) {
    reachAt = now;
    const hit = (m, e) => m.match ? matches(m.match, e)
      : !(m.target && m.target !== 'all' && m.target !== e.kind
          && !(e.sem && m.target === e.sem.kind));
    const reach = {};
    const pool = tiled ? units : lastGlyphs;
    for (const m of lstack) {
      if (!m._id) continue;
      let k = 0; for (const e of pool) if (hit(m, e)) k++;
      reach[m._id] = (reach[m._id] || 0) + k;
    }
    for (const m of stack) {
      if (!m._id) continue;
      let k = 0; for (const e of lastGlyphs) if (hit(m, e)) k++;
      reach[m._id] = (reach[m._id] || 0) + k;
    }
    const msg = { type:'reach', reach, pool: pool.length, glyphs: lastGlyphs.length,
                  units: tiled ? units.length : 0, advice };
    try { if (parent !== window) parent.postMessage(msg, location.origin); } catch (_) {}
  }

  // ---- the patch cannot run here ---------------------------------------
  // A preset whose source cannot feed it does nothing at all, and does it
  // silently. That is indistinguishable from a broken preset, so say it
  // across the middle of the picture rather than in the status bar.
  if (advice) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fs = Math.max(13, Math.min(26, W / 46));
    ctx.font = `${fs}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    const tw = ctx.measureText(advice).width;
    const bw = tw + fs * 2.4, bh = fs * 3, bx = (W - bw) / 2, by = (H - bh) / 2;
    ctx.fillStyle = 'rgba(10,14,20,0.9)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(255,160,42,0.9)';
    ctx.lineWidth = Math.max(1, fs / 13);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,190,110,0.98)';
    ctx.fillText(advice, W / 2, by + bh / 2 + fs * 0.36);
    ctx.textAlign = 'left';
  }

  // ---- readout ---------------------------------------------------------
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${11 * DPR}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'left';
  ctx.fillStyle = connected || demoUntil > now ? 'rgba(120,170,200,0.75)' : 'rgba(255,160,42,0.9)';
  const line = demoUntil > now ? 'SYNTHETIC DEMO DATA'
             : connected ? `${useLive ? 'SCREEN ' + cap.label : 'MOCK'}  ${fps.toFixed(0)}fps`
                           // A reader is what gives pixels structure, so it is
                           // reported before the source: once one is running,
                           // "pixels carry no structure" is no longer true.
                           + (tiled ? `  ${tiles.summary} · ${reached}/${units.length} reached`
                                      + ` by ${lstack.length} effect${lstack.length === 1 ? '' : 's'}`
                                      + (reached ? '' : ' — SELECTION MATCHES NOTHING')
                                      + `  ${tiles.ms.toFixed(1)}ms read`
                                      : useLive ? `  typography + layout inert`
                                                + ` — add a Read block to give pixels structure`
                                      : source === 'bot'
                                        ? `  ${scene.stats ? scene.stats.branches : 0} branches  ${scene.stats ? scene.stats.fruit : 0} fruit  ${glyphCount} glyphs  ${modCount} mods`
                                      : source === 'ax'
                                        ? `  ${axHeld ? 'HELD' : 'LIVE'} ${axApp || 'screen'}`
                                          + `  ${scene.stats ? scene.stats.shown : 0}/${scene.stats ? scene.stats.elements : 0} elements`
                                          + `  ${glyphCount} glyphs  ${modCount} mods`
                                        : `  ${glyphCount} glyphs  ${scene.surfaces.length} surfaces  ${modCount} mods`)
                           + `  chain ${(wet*100).toFixed(0)}%`
                           + (chain.chem > 0.002 ? `  rd ${(chain.chem*100).toFixed(0)}%` : '')
                           + `  ${drawMs.toFixed(1)}ms`
             : 'DAEMON NOT REACHABLE ON :7777  —  press D for demo data';
  ctx.fillText(line, 14 * DPR, H - 14 * DPR);
  if (!compact) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(90,130,155,0.7)';
    ctx.fillText(`patch: ${patchSrc}   space pause  t text  b bypass  i chain  d demo`,
                 W - 14 * DPR, H - 14 * DPR);
  }
  if (bypass) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,160,42,0.95)';
    ctx.fillText('BYPASS — modulators off', 14 * DPR, H - 30 * DPR);
  }

  // The floating window is fed one frame per painted frame, explicitly. This
  // is the last thing a frame does, so what it copies is the finished picture.
  if (floatTrack) pushFloatFrame();
}

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === ' ') { paused = !paused; e.preventDefault(); }
  if (k === 't') showText = !showText;
  if (k === 'b') bypass = !bypass;            // A/B against plain text
  // force the image chain fully wet, for when there is no chain.mix in the
  // patch yet. Press again to hand control back to the patch.
  if (k === 'i') { forceWet = forceWet >= 0 ? -1 : 1; if (repaintSrc) repaintSrc(); }
  if (k === 'd') demoUntil = performance.now() + 60000;
});

// ---------------------------------------------------------------- source
{
  const bm = document.getElementById('bmock');
  const bb = document.getElementById('bbot');
  const ba = document.getElementById('bax');
  const bl = document.getElementById('blive');
  const note = document.getElementById('snote');
  const paint = () => {
    bm.classList.toggle('on', source === 'mock');
    bb.classList.toggle('on', source === 'bot');
    ba.classList.toggle('on', source === 'ax');
    bl.classList.toggle('on', live);
    bl.textContent = live ? 'stop capture' : 'capture my screen';
    if (lastAdvice) { note.textContent = lastAdvice; return; }
    note.textContent = live
      ? (lastWet < 0.01
          ? 'the image chain is OFF — press I, or wire chain.mix in the patcher'
          : 'image chain + layout operators apply; typography cannot (pixels carry no glyphs)')
      : source === 'bot'
        ? (treeErr ? 'tree: ' + treeErr
                   : tree ? `${treePath} — folders are branches, files are fruit`
                          : 'loading the tree…')
      : source === 'ax'
        ? (axErr ? axErr
                 : ax ? (axHeld
                     ? `holding ${axApp || 'the last window'} — switch to a window to re-read it`
                     : `reading ${axApp || 'the screen'} — typography and layout both apply`)
                      : 'reading the screen…')
        : (cap.error && cap.error !== 'capture cancelled' ? cap.error : '');
  };
  const bf = document.getElementById('bfloat');
  if (bf) {
    if (!canFloat()) {
      bf.disabled = true;
      bf.title = 'this browser cannot float a canvas (needs Picture in Picture)';
    }
    // Not async: the call must happen in the gesture, so floatOut() is invoked
    // directly and only its result is handled later.
    bf.onclick = () => {
      if (live) {
        bf.title = 'floating while capturing the screen has been unreliable here — '
                 + 'if the capture drops, use "own window" instead';
      }
      let p;
      try { p = floatOut(); }
      catch (e) { p = Promise.reject(e); }
      diag(live ? 'float requested (screen capture is running)' : 'float requested');
      p.then(on => { bf.classList.toggle('on', on); diag('float ' + (on ? 'ON' : 'off'), on ? 'good' : ''); })
       .catch(e => {
         // Say WHICH failure. "float failed" sent us hunting the wrong bug.
         const why = (e && (e.name === 'NotAllowedError'
             ? 'blocked — allow Picture in Picture for this site'
             : e.name === 'SecurityError'
             ? 'blocked inside this frame — open /m1/view.html in its own tab'
             : (e.message || e.name))) || 'unknown error';
         bf.textContent = 'float: ' + why;
         bf.title = String(e && (e.stack || e.message) || e);
         console.error('[float]', e);
         diag('float failed: ' + why, 'bad');
         setTimeout(() => bf.textContent = 'float on top', 5000);
       });
    };
    addEventListener('leavepictureinpicture', () => {
      bf.classList.remove('on'); hiddenClock(false); tellParentFloating(false);
    }, true);
    addEventListener('webkitpresentationmodechanged', () => {
      const on = isFloating();
      bf.classList.toggle('on', on); hiddenClock(on); tellParentFloating(on);
    }, true);
  }

  // A plain second window. No Picture in Picture, no canvas capture, no
  // shared video budget with this tab -- it is simply the render page again,
  // running its own screen capture. It cannot float above other apps, but it
  // is a real resizable window you can park on another display or Space, and
  // nothing about it can be throttled by what this tab is doing.
  // Build the floating-window rig on the first click anywhere -- not at load,
  // where it would exist before the user has asked for anything, and not on
  // the float click, where the video has had no chance to decode a frame
  // before Picture in Picture inspects it.
  addEventListener('pointerdown', () => {
    try { ensureFloatRig(); } catch (e) { diag('float rig: ' + (e.message || e), 'bad'); }
  }, { once:true });

  const bw = document.getElementById('bwin');
  if (bw) bw.onclick = () => {
    const w = open('/m1/view.html', 'psyche-render',
                   'width=1280,height=800,menubar=no,toolbar=no');
    if (!w) { bw.textContent = 'blocked — allow pop-ups';
              setTimeout(() => bw.textContent = 'own window', 4000); return; }
    try { w.focus(); } catch (_) {}
  };

  cap.onchange = () => { live = cap.active; if (live) source = 'live'; else source = 'mock'; paint(); };
  bm.onclick = () => { if (live) cap.stop(); live = false; source = 'mock'; paint(); };
  ba.onclick = async () => {
    if (live) { cap.stop(); live = false; }
    source = 'ax'; paint();
    await loadAx(); paint();
  };
  bb.onclick = async () => {
    if (live) { cap.stop(); live = false; }
    source = 'bot'; paint();
    if (!tree) { await loadTree(treePath); paint(); }
  };
  bl.onclick = async () => {
    if (live) { diag('capture stopped by you'); cap.stop(); live = false; source = 'mock'; paint(); return; }
    if (!cap.supported) { note.textContent = 'this browser cannot capture the screen'; return; }
    note.textContent = 'waiting for the share dialog…';
    diag('requesting screen capture…');
    let settled = false;
    setTimeout(() => { if (!settled)
      diag('share dialog has not come back — look for it, it may be behind a window', 'bad'); }, 4000);
    const ok = await cap.start();
    settled = true;
    live = ok;
    if (ok) { source = 'live'; diag(`capture started: ${cap.label || 'screen'}`, 'good'); }
    else diag('capture did not start: ' + (cap.error || 'unknown'), 'bad');
    paint();
  };
  if (!cap.supported) { bl.disabled = true; bl.title = 'getDisplayMedia unavailable'; }
  repaintSrc = paint;
  paint();
}

resize();
requestAnimationFrame(frame);
