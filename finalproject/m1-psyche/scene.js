// scene.js — a desktop to practise on, and the per-glyph layout pass.
//
// Designing typographic effects against a live screen capture is miserable:
// the content changes under you, so you can never tell whether a change in
// the image came from your edit or from the desktop. This is a synthetic
// desktop instead — the same frame every run, reproducible, and testable.
//
// It is also the exact shape a real capture will have to be converted into,
// so swapping in ScreenCaptureKit plus the Accessibility API later means
// replacing `mockDesktop()` and changing nothing downstream. The Accessibility
// API gives role, text and screen rectangle for every element in every app,
// which is precisely the `blocks` structure below.

import { spacingFor } from './modulate.js';

// Every glyph carries the KIND of thing it belongs to, so a modulator can hit
// filenames and leave body text alone.
export const KINDS = ['menu', 'title', 'body', 'name', 'label'];

const LOREM = [
  'The system is not a place you visit. It is the place you already are,',
  'and the only question is whether it will admit to being alive.',
  'Every file you open moves through the same buses, the same caches,',
  'the same four hundred microseconds of waiting.',
];

export function mockDesktop(W = 1440, H = 900) {
  const chrome = [];      // frames and icons, drawn as plain geometry
  const blocks = [];      // text, laid out per glyph
  const surfaces = [];    // transformable rectangles: windows, icons, the bar

  // A surface is a rectangle with a pivot at its centre. Everything tagged
  // with its id moves when it moves, so rotating a window carries its title
  // and its text. `kindIndex` and `ofKind` let an operator distribute
  // surfaces evenly — the Grid-to-ring operator needs to know how many
  // siblings there are to space them around a circle.
  const surf = (id, kind, x, y, w, h) => {
    surfaces.push({ id, kind, x, y, w, h, cx: x + w / 2, cy: y + h / 2,
                    i: surfaces.length, kindIndex: 0, ofKind: 1 });
    return id;
  };

  // --- menu bar ---------------------------------------------------------
  const bar = surf('bar', 'bar', 0, 0, W, 26);
  chrome.push({ t:'bar', x:0, y:0, w:W, h:26, surf:bar });
  let mx = 18;
  for (const item of ['Finder', 'File', 'Edit', 'View', 'Go', 'Window', 'Help']) {
    blocks.push({ kind:'menu', x:mx, y:18, size:12.5, text:item, surf:bar });
    mx += item.length * 8 + 22;
  }
  blocks.push({ kind:'menu', x:W - 150, y:18, size:12.5, text:'100%   14:32', surf:bar });

  // --- two windows ------------------------------------------------------
  const wins = [
    { x: 92,  y: 96,  w: 560, h: 364, title: 'Documents — 42 items' },
    { x: 700, y: 210, w: 600, h: 430, title: 'notes.txt' },
  ];
  // Icons are their own surfaces rather than children of their window. That
  // is the more useful choice here: it lets folders leave the window.
  const icon = (cx, cy, iw, ih, name, labelDy) => {
    const id = surf('ico' + surfaces.length, 'icon', cx - 16, cy - 6, iw + 50, ih + labelDy);
    chrome.push({ t:'folder', x:cx, y:cy, w:iw, h:ih, surf:id });
    blocks.push({ kind:'name', x:cx + iw / 2, y:cy + labelDy, size:11.5,
                  text:name, align:'center', surf:id });
  };

  wins.forEach((w, n) => {
    const id = surf('win' + n, 'window', w.x, w.y, w.w, w.h);
    chrome.push({ t:'win', ...w, surf:id });
    blocks.push({ kind:'title', x:w.x + 74, y:w.y + 22, size:13, text:w.title, surf:id });

    if (n === 0) {
      const names = ['Projects', 'Archive', 'Invoices', 'Screenshots',
                     'Field notes', 'Scans', 'Receipts', 'Drafts'];
      names.forEach((nm, k) => {
        icon(w.x + 54 + (k % 4) * 128, w.y + 92 + Math.floor(k / 4) * 124, 58, 46, nm, 70);
      });
    } else {
      LOREM.forEach((ln, k) => {
        blocks.push({ kind:'body', x:w.x + 28, y:w.y + 70 + k * 30, size:13.5,
                      text:ln, maxw:w.w - 56, surf:id });
      });
      blocks.push({ kind:'label', x:w.x + 28, y:w.y + w.h - 22, size:11,
                    text:'4 paragraphs · 312 words · modified 2 minutes ago', surf:id });
    }
  });

  // --- desktop icons ----------------------------------------------------
  ['Macintosh HD', 'finalproject', 'rd-notes.md'].forEach((nm, k) => {
    icon(W - 108, 92 + k * 118, 52, 42, nm, 64);
  });

  // number each surface within its own kind, for operators that distribute
  const counts = {};
  for (const s of surfaces) { s.kindIndex = counts[s.kind] = (counts[s.kind] ?? -1) + 1; }
  for (const s of surfaces) s.ofKind = counts[s.kind] + 1;

  return { W, H, chrome, blocks, surfaces };
}

// ---------------------------------------------------------------- layout
//
// Turns text blocks into individually addressable glyphs. Each glyph knows
// where it sits, and also which word and line it belongs to and how wide
// those are — which is what lets a modulator explode a word outward from its
// own centre, or run a wave along one line.
//
// measure(ch, size) -> advance width in px. Supplied by the caller so this
// stays pure: the browser passes a canvas measurer, the tests pass a fixed
// monospace one.

export function layout(blocks, measure, stack, opts = {}) {
  const glyphs = [];
  // The frame this layout is laid out in. A shape selection is authored in
  // 0..1 of the frame, so each glyph has to carry where it sits in that
  // frame; it cannot be recovered from x/y without knowing the size.
  const FW = opts.W || 1024, FH = opts.H || 640;
  let ci = 0, wi = 0, li = 0;

  for (const b of blocks) {
    const { track, lead, grow } = spacingFor(stack, b.kind);
    const sp = measure(' ', b.size);

    // split into words, then wrap to maxw if the block asked for it
    const words = String(b.text).split(/\s+/).filter(Boolean);
    const widths = words.map(w => {
      let t = 0; for (const ch of w) t += measure(ch, b.size) + track;
      return t;
    });

    const lines = [];
    if (b.maxw) {
      let cur = [], curW = 0;
      words.forEach((w, k) => {
        const add = (cur.length ? sp : 0) + widths[k];
        if (cur.length && curW + add > b.maxw) { lines.push(cur); cur = [w]; curW = widths[k]; }
        else { cur.push(w); curW += add; }
      });
      if (cur.length) lines.push(cur);
    } else lines.push(words);

    const lh = (b.size * 1.45) * lead;

    lines.forEach((lineWords, ln) => {
      const idx = lineWords.map(w => words.indexOf(w));
      let lw = 0;
      lineWords.forEach((w, k) => { lw += (k ? sp : 0) + widths[words.indexOf(w)]; });
      const ly = b.y + ln * lh;
      const lx = b.align === 'center' ? b.x - lw / 2
               : b.align === 'right'  ? b.x - lw
               :                        b.x;

      let x = lx;
      lineWords.forEach((word, k) => {
        const ww = widths[words.indexOf(word)];
        const wx = x, wy = ly;
        let i = 0;
        for (const ch of word) {
          const adv = measure(ch, b.size);
          // tracking can accumulate along the run, so spacing opens up as a
          // line or a word proceeds rather than uniformly
          const extra = track * (grow === 'index' ? i + 1 : grow === 'word' ? wi + 1
                               : grow === 'line' ? li + 1 : 1);
          glyphs.push({
            ch, kind:b.kind, size:b.size, surf:b.surf, sem:b.sem,
            x, y:ly, adv,
            nx: x / FW, ny: ly / FH,
            i, ci, wi, li,
            n:word.length,
            wx, wy, ww, lx, ly, lw,
          });
          x += adv + extra;
          i++; ci++;
        }
        wi++;
        if (k < lineWords.length - 1) x += sp;
      });
      li++;
    });
  }
  return glyphs;
}

// A monospace measurer, for tests and as a fallback before fonts load.
export const monoMeasure = (ch, size) => size * 0.6;
