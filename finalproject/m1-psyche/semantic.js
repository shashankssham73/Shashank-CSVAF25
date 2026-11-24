// semantic.js — what a piece of text IS, and how it got on screen.
//
// Two halves, matching the two halves of the question.
//
// WHAT IT IS. Measures computed from the text itself, no model required and
// no network: length, word count, Shannon entropy, the share of digits,
// punctuation and capitals, lexical diversity, and a coarse class. These are
// real quantities, cheap, and — the point — they become SIGNALS. "Letters
// jitter in proportion to the entropy of their sentence" is then one operator
// with its phase source set to entropy, not a special case in the renderer.
//
// HOW IT GOT THERE. The Accessibility API hands back each element's path down
// the hierarchy:
//
//     Finder > AXWindow > AXSplitGroup > AXScrollArea > AXStaticText
//
// which is the provenance of that text: which application put it there,
// inside which window, nested in what, and how deep. Depth is a signal too.
//
// Deliberately NOT here: sentiment, topic, meaning. Those need a model, they
// would be wrong often enough to matter, and none of them is needed to make
// the typography respond to what it is rendering.

// Shannon entropy over characters, in bits. A real measure of how
// unpredictable the text is: "aaaaaa" is near 0, a hash is near 6.
export function entropy(s) {
  if (!s || s.length < 2) return 0;
  const f = new Map();
  for (const c of s) f.set(c, (f.get(c) || 0) + 1);
  let h = 0;
  for (const n of f.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

const RE = {
  url:   /^(https?:\/\/|www\.)\S+$/i,
  // `[~.]?\/?` rather than `[~/.]?` so a leading "~/" matches: the single
  // optional character could take the ~ or the / but not both.
  path:  /^[~.]?\/?(?:[\w .\-]+\/)+[\w .\-]*$/,
  time:  /^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i,
  date:  /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/,
  num:   /^[\s\d.,%$£€+\-()]+$/,
  ident: /^[A-Za-z_][\w.$-]*$/,
  size:  /^[\d.]+\s?(B|KB|MB|GB|TB|bytes|items?)$/i,
};

// A coarse class, in the order the tests have to run: a path is also made of
// identifiers, a size is also a number.
export function classify(s) {
  const t = (s || '').trim();
  if (!t) return 'empty';
  if (RE.url.test(t))  return 'url';
  if (RE.time.test(t)) return 'time';
  if (RE.date.test(t)) return 'date';
  if (RE.size.test(t)) return 'size';
  if (RE.path.test(t) && t.includes('/')) return 'path';
  if (RE.num.test(t) && /\d/.test(t)) return 'number';
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 4) return 'sentence';
  if (words.length === 1 && RE.ident.test(t)) return 'identifier';
  if (!/[A-Za-z]/.test(t)) return 'symbol';
  return 'word';
}

export function analyse(text, extra = {}) {
  const s = String(text || '');
  const words = s.split(/\s+/).filter(Boolean);
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const uniq = new Set(words.map(w => w.toLowerCase()));
  return {
    kind:    classify(s),
    len:     s.length,
    words:   words.length,
    entropy: entropy(s),
    digits:  s.length ? (s.match(/\d/g) || []).length / s.length : 0,
    punct:   s.length ? (s.match(/[^\w\s]/g) || []).length / s.length : 0,
    caps:    letters ? (s.match(/[A-Z]/g) || []).length / letters : 0,
    // Type-token ratio: lexical diversity. Meaningless below a few words, so
    // it reports 1 there rather than a number that looks informative.
    ttr:     words.length >= 4 ? uniq.size / words.length : 1,
    depth:   extra.depth || 0,
    role:    extra.role || '',
    app:     extra.app || '',
    path:    extra.path || '',
  };
}

// AX roles are many and the typography family targets a handful of kinds, so
// they are collapsed to the same vocabulary the mock desktop uses.
const ROLE_KIND = {
  AXMenuBarItem:'menu', AXMenuItem:'menu', AXMenu:'menu',
  AXWindow:'title', AXTitleUIElement:'title',
  AXTextArea:'body', AXTextField:'body', AXStaticText:'body',
  AXButton:'label', AXCheckBox:'label', AXRadioButton:'label',
  AXPopUpButton:'label', AXTab:'label', AXToolbar:'label',
  AXCell:'name', AXRow:'name', AXOutline:'name', AXList:'name', AXImage:'name',
};

// Turns an /ax snapshot into the same scene shape as the mock desktop and the
// botanical tree, so every downstream operator works on it unchanged — this
// is the whole reason to normalise rather than special-case.
export function axScene(ax, W, H, opts = {}) {
  const chrome = [], blocks = [], surfaces = [];
  if (!ax || !ax.elements || !ax.elements.length) return { W, H, chrome, blocks, surfaces };

  const sw = (ax.screen && ax.screen.w) || W;
  const sh = (ax.screen && ax.screen.h) || H;
  const kx = W / sw, ky = H / sh;
  const minLen = opts.minLen ?? 1;
  const maxEl  = opts.maxEl ?? 400;

  const surf = (id, kind, x, y, w, h) => {
    surfaces.push({ id, kind, x, y, w, h, cx:x + w/2, cy:y + h/2,
                    i:surfaces.length, kindIndex:0, ofKind:1 });
    return id;
  };

  // One surface per window, so the layout operators can move real windows.
  const winOf = new Map();
  for (const e of ax.elements) {
    const key = e.app + '\u0000' + e.window;
    if (winOf.has(key)) continue;
    const same = ax.elements.filter(q => q.app === e.app && q.window === e.window);
    const x0 = Math.min(...same.map(q => q.x)) * kx, y0 = Math.min(...same.map(q => q.y)) * ky;
    const x1 = Math.max(...same.map(q => q.x + q.w)) * kx, y1 = Math.max(...same.map(q => q.y + q.h)) * ky;
    const id = surf('axw' + surfaces.length, 'window', x0, y0, Math.max(1, x1-x0), Math.max(1, y1-y0));
    winOf.set(key, id);
    chrome.push({ t:'win', x:x0, y:y0, w:Math.max(1,x1-x0), h:Math.max(1,y1-y0),
                  title:e.window, surf:id });
  }

  let n = 0;
  for (const e of ax.elements) {
    if (n >= maxEl) break;
    const text = (e.text || '').replace(/\s+/g, ' ').trim();
    if (text.length < minLen) continue;
    n++;
    const sem = analyse(text, { depth:e.depth, role:e.role, app:e.app, path:e.path });
    const kind = ROLE_KIND[e.role] || 'label';
    // Size follows the element's own height, so a heading stays a heading.
    const size = Math.max(8, Math.min(26, e.h * ky * 0.56));
    blocks.push({
      kind, sem,
      x: e.x * kx + 3,
      y: e.y * ky + Math.min(e.h * ky * 0.72, size * 1.05),
      size, text,
      maxw: Math.max(40, e.w * kx - 6),
      surf: winOf.get(e.app + '\u0000' + e.window),
    });
  }

  const counts = {};
  for (const s of surfaces) s.kindIndex = counts[s.kind] = (counts[s.kind] ?? -1) + 1;
  for (const s of surfaces) s.ofKind = counts[s.kind] + 1;

  return { W, H, chrome, blocks, surfaces,
           stats: { elements: ax.elements.length, shown: n, windows: surfaces.length,
                    scanned: ax.scanned, ms: ax.ms, truncated: ax.truncated } };
}
