#!/usr/bin/env node
// Block diagram of the full model: sources -> DSP -> state -> render -> output,
// with the four closed loops marked. Emits figures/block-diagram.svg
// Layout is computed, not hand-placed, and asserted collision-free at the end.

const fs = require('fs');
const path = require('path');

const W = 1560;
let H = 0;   // computed from the layout once blocks are placed

const C = {
  ink:   '#14171c',
  mute:  '#6b7280',
  rule:  '#ccd2dc',
  panel: '#ffffff',
  wash:  '#f6f7f9',
  sense: '#1d4ed8',
  dsp:   '#6d28d9',
  state: '#a4560a',
  form:  '#0b7a6a',
  out:   '#be185d',
  loop:  '#d9541c',
};

const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
const SANS = "-apple-system,'Helvetica Neue',Arial,sans-serif";

// ---------------------------------------------------------------- layout model

const TITLE_H = 15;   // baseline advance for a block title
const LINE_H  = 13;   // baseline advance for a body line
const PAD     = 9;    // inner padding of a block
const GAP     = 11;   // vertical gap between blocks
const HEAD_H  = 30;   // group header strip

const columns = [
  { key: 'sense', x: 40,   w: 230, label: 'A · SENSE',      color: C.sense },
  { key: 'dsp',   x: 310,  w: 300, label: 'B · ANALYSE',    color: C.dsp   },
  { key: 'state', x: 650,  w: 250, label: 'C · STATE',      color: C.state },
  { key: 'form',  x: 940,  w: 300, label: 'D · FORM',       color: C.form  },
  { key: 'out',   x: 1280, w: 240, label: 'E · OUT',        color: C.out   },
];

// blocks[columnKey] = [ {title, lines, tag} ]
const blocks = {
  sense: [
    { title: 'MIC', lines: ['1 ch x 44.1 kHz', 'array not exposed'] },
    { title: 'TELEMETRY DAEMON', lines: ['43 ch / 7 sources', '0.3-5 Hz -> 30 Hz frame', '~2% of one core'] },
    { title: 'POINTER', lines: ['cursor / scroll / click', 'slide distance = 0..1'] },
    { title: 'FILESYSTEM GRAPH', lines: ['depth / fan-out / mdls', 'event-driven'] },
    { title: 'SOURCES  (no privileges)', lines: [
      'vm_stat . iostat . nettop',
      'ioreg . FSEvents . top',
      '+ native input probe',
      'root-only paths excluded',
    ]},
  ],
  dsp: [
    { title: 'AUDIO-RATE DSP   44.1 kHz', tag: 'V', lines: [
      'STFT 2048 / 75%  -> tilt, centroid',
      'autocorrelation  -> f0  (50-400 Hz)',
      'cepstrum FFT-log-iFFT -> formants',
      'Butterworth bank -> band energy',
      'matched filter   -> utterance onset',
      'STFT -> iSTFT    -> spectral freeze',
    ]},
    { title: 'CONTROL-RATE DSP   30 Hz', tag: 'T', lines: [
      'condition: d/dt, log1p, detrend, Hann',
      'IIR envelope / one-euro filter',
      'STFT 256 / 50%   -> centroid, flatness',
      'STFT -> iSTFT    -> 0.1-0.3 Hz breath',
      'autocorrelation  -> task loop period',
      'cross-corr + lag -> causal order',
      '1-D convolution  -> event envelope',
      'Lomb-Scargle     -> irregular channels',
    ]},
  ],
  state: [
    { title: 'ASR  (Whisper)', lines: ['command layer only', 'gated by matched filter'] },
    { title: 'TASK EXECUTOR', lines: ['find PDFs -> convert x3', '-> write -> zip'] },
    { title: 'TASK FSM', lines: ['scan / convert / write / zip', 'transitions from lag', 'structure (cross-corr)'] },
    { title: 'PARAMETER VECTOR', lines: ['zoom . rotation . gain', 'blur . hue . branch angle', 'one regime per phase'] },
  ],
  form: [
    { title: 'LOG-POLAR TRANSFORM', lines: ['(r, th) -> (log r, th)', 'zoom+rotate becomes', 'pure translation'] },
    { title: 'VIDEO FEEDBACK ACCUMULATOR', tag: 'PRIMARY', lines: ['affine warp of frame t-1', '+ gain + nonlinearity'] },
    { title: '2-D CONVOLUTION', lines: ['Gaussian = diffusion', 'unsharp  = reaction', '-> Gray-Scott substrate'] },
    { title: 'MORPHOGENESIS  (rules)', lines: ['space colonization', 'phyllotaxis / L-system', 'attractors <- filesystem', 'improvises on the feedback'] },
    { title: 'COMPOSITE', lines: ['+ thumbnails, labels', 'flash limiter <= 3/s'] },
  ],
  out: [
    { title: 'DISPLAY', lines: ['60 Hz'] },
    { title: 'FRAME READBACK', lines: ['GPU -> CPU, decimated'] },
    { title: '2-D FFT', lines: ['radial power spectrum', '-> AGC, edge of chaos'] },
    { title: 'PHASE CORRELATION', lines: ['FFT -> iFFT -> peak', '-> measured optical flow'] },
    { title: '1-D FFT  (angular)', lines: ['dominant wavenumber', '-> symmetry order'] },
  ],
};

// measure + place
const placed = [];
const colTop = 92;
for (const col of columns) {
  let y = colTop + HEAD_H + GAP;
  for (const b of blocks[col.key]) {
    const h = PAD + TITLE_H + b.lines.length * LINE_H + PAD - 2;
    placed.push({ ...b, col: col.key, color: col.color, x: col.x, w: col.w, y, h });
    y += h + GAP;
  }
  col.bottom = y - GAP;
}
const colBottom = Math.max(...columns.map(c => c.bottom));

// loop lanes below everything
const laneY = [];
const LANE0 = colBottom + 46;
for (let i = 0; i < 4; i++) laneY.push(LANE0 + i * 34);
const fy = laneY[3] + 44;          // footer baseline
H = fy + 17 + 26;                  // canvas height follows the content

// ---------------------------------------------------------------- svg emitters

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const out = [];
const P = s => out.push(s);

P(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">`);
P(`<defs>`);
for (const [name, col] of Object.entries({ ink: C.ink, loop: C.loop, mute: C.mute })) {
  P(`<marker id="ah-${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
    + `<path d="M0,0.5 L9.5,5 L0,9.5 z" fill="${col}"/></marker>`);
}
P(`</defs>`);
P(`<rect width="${W}" height="${H}" fill="${C.panel}"/>`);

// title
P(`<text x="40" y="38" font-size="19" font-weight="700" fill="${C.ink}">Block diagram — telemetry- and voice-driven feedback visualizer</text>`);
P(`<text x="40" y="60" font-size="12.5" fill="${C.mute}">Solid = forward signal path.  Dashed orange = closed loop.  Bracketed codes are the operation numbers in the signals table.</text>`);

// column headers + wash
for (const col of columns) {
  P(`<rect x="${col.x}" y="${colTop}" width="${col.w}" height="${colBottom - colTop}" fill="${C.wash}" stroke="${C.rule}" rx="6"/>`);
  P(`<rect x="${col.x}" y="${colTop}" width="${col.w}" height="${HEAD_H}" fill="${col.color}" rx="6"/>`);
  P(`<rect x="${col.x}" y="${colTop + HEAD_H - 6}" width="${col.w}" height="6" fill="${col.color}"/>`);
  P(`<text x="${col.x + 11}" y="${colTop + 20}" font-size="12" font-weight="700" fill="#fff" letter-spacing="1.4">${esc(col.label)}</text>`);
}

// blocks
for (const b of placed) {
  P(`<rect x="${b.x + 10}" y="${b.y}" width="${b.w - 20}" height="${b.h}" fill="#fff" stroke="${C.rule}" rx="4"/>`);
  P(`<rect x="${b.x + 10}" y="${b.y}" width="3.5" height="${b.h}" fill="${b.color}" rx="1.5"/>`);
  let ty = b.y + PAD + 11;
  P(`<text x="${b.x + 21}" y="${ty}" font-size="11" font-weight="700" font-family="${MONO}" fill="${C.ink}">${esc(b.title)}</text>`);
  if (b.tag) {
    const tw = b.tag.length * 6.6 + 12;
    P(`<rect x="${b.x + b.w - 20 - tw - 6}" y="${b.y + 6}" width="${tw}" height="15" rx="7.5" fill="${b.color}" opacity="0.14"/>`);
    P(`<text x="${b.x + b.w - 20 - tw - 6 + tw / 2}" y="${b.y + 17}" font-size="9" font-weight="700" font-family="${MONO}" fill="${b.color}" text-anchor="middle">${esc(b.tag)}</text>`);
  }
  for (const ln of b.lines) {
    ty += LINE_H;
    P(`<text x="${b.x + 21}" y="${ty}" font-size="9.8" font-family="${MONO}" fill="${C.mute}">${esc(ln)}</text>`);
  }
}

// ------------------------------------------------- forward arrows between cols
function arrow(x1, y1, x2, y2, color, marker, dash) {
  P(`<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="${color}" stroke-width="1.6"`
    + (dash ? ` stroke-dasharray="${dash}"` : '') + ` marker-end="url(#ah-${marker})"/>`);
}
function label(x, y, t, color, anchor = 'middle', size = 9.5) {
  P(`<text x="${x}" y="${y}" font-size="${size}" font-family="${MONO}" fill="${color}" text-anchor="${anchor}">${esc(t)}</text>`);
}

const byCol = k => placed.filter(b => b.col === k);
const mid = b => b.y + b.h / 2;
const S = byCol('sense'), D = byCol('dsp'), T = byCol('state'), F = byCol('form'), O = byCol('out');

// A -> B : mic to audio DSP, telemetry+pointer to control DSP
arrow(S[0].x + S[0].w - 10, mid(S[0]), D[0].x + 10, mid(S[0]), C.ink, 'ink');
label((S[0].x + S[0].w + D[0].x) / 2, mid(S[0]) - 6, 'waveform', C.mute);
for (const src of [S[1], S[2]]) {
  const yEnd = mid(D[1]) + (src === S[1] ? -14 : 14);
  P(`<path d="M${src.x + src.w - 10},${mid(src)} C${src.x + src.w + 20},${mid(src)} ${D[1].x - 10},${yEnd} ${D[1].x + 10},${yEnd}" fill="none" stroke="${C.ink}" stroke-width="1.6" marker-end="url(#ah-ink)"/>`);
}
label(290, mid(D[1]) - 24, '43 ch', C.mute, 'end');

// A(filesystem) -> D(morphogenesis): routed through the empty band below the
// B and C blocks, up the C/D gutter, entering morphogenesis 18px below the
// parameter bundle so the two arrivals stay distinguishable.
const fsB = S[3], morph = F[3];
const runY = colBottom - 28, upX = 925, enterY = mid(morph) + 18;
P(`<path d="M${fsB.x + fsB.w - 10},${mid(fsB)} C${fsB.x + fsB.w + 22},${mid(fsB)} ${fsB.x + fsB.w + 30},${runY} ${fsB.x + fsB.w + 52},${runY} L${upX},${runY} L${upX},${enterY} L${morph.x + 10},${enterY}" fill="none" stroke="${C.ink}" stroke-width="1.4" stroke-dasharray="1 3" marker-end="url(#ah-ink)"/>`);
label(620, runY - 8, 'directory structure -> attractor cloud  (not a time series)', C.mute, 'middle', 9.5);

// B -> C
arrow(D[0].x + D[0].w - 10, mid(D[0]), T[0].x + 10, mid(T[0]), C.ink, 'ink');
label((D[0].x + D[0].w + T[0].x) / 2, mid(T[0]) - 7, 'onset gate', C.mute);
P(`<path d="M${D[1].x + D[1].w - 10},${mid(D[1])} C${D[1].x + D[1].w + 20},${mid(D[1])} ${T[2].x - 20},${mid(T[2])} ${T[2].x + 10},${mid(T[2])}" fill="none" stroke="${C.ink}" stroke-width="1.6" marker-end="url(#ah-ink)"/>`);
label(628, mid(T[2]) + 26, 'lag', C.mute, 'end');

// B -> C param vector (feature stream)
P(`<path d="M${D[1].x + D[1].w - 10},${mid(D[1]) + 30} C${D[1].x + D[1].w + 24},${mid(D[1]) + 30} ${T[3].x - 24},${mid(T[3])} ${T[3].x + 10},${mid(T[3])}" fill="none" stroke="${C.ink}" stroke-width="1.6" marker-end="url(#ah-ink)"/>`);
// C internal spine
for (let i = 0; i < T.length - 1; i++) {
  arrow(T[i].x + T[i].w / 2, T[i].y + T[i].h, T[i].x + T[i].w / 2, T[i + 1].y, C.mute, 'mute');
}

// C -> D : parameter vector drives every render stage
for (const f of [F[0], F[1], F[2], F[3]]) {
  P(`<path d="M${T[3].x + T[3].w - 10},${mid(T[3])} C${T[3].x + T[3].w + 18},${mid(T[3])} ${f.x - 26},${mid(f)} ${f.x + 10},${mid(f)}" fill="none" stroke="${C.form}" stroke-width="1.5" opacity="0.85" marker-end="url(#ah-ink)"/>`);
}
label(920, mid(T[3]) - 46, 'params', C.form, 'middle');

// D internal spine
for (let i = 0; i < F.length - 1; i++) {
  arrow(F[i].x + F[i].w / 2, F[i].y + F[i].h, F[i].x + F[i].w / 2, F[i + 1].y, C.mute, 'mute');
}
// morphogenesis <-> feedback: they share the convolution
P(`<path d="M${F[3].x + F[3].w - 16},${mid(F[3])} C${F[3].x + F[3].w + 8},${mid(F[3])} ${F[1].x + F[1].w + 8},${mid(F[1])} ${F[1].x + F[1].w - 16},${mid(F[1])}" fill="none" stroke="${C.form}" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#ah-ink)"/>`);

// D -> E, routed orthogonally up the gutter instead of as a long diagonal
{
  const gx = 1258;
  P(`<path d="M${F[4].x + F[4].w - 10},${mid(F[4])} L${gx},${mid(F[4])} L${gx},${mid(O[0])} L${O[0].x + 10},${mid(O[0])}" fill="none" stroke="${C.ink}" stroke-width="1.6" marker-end="url(#ah-ink)"/>`);
}
// E internal
for (let i = 0; i < O.length - 1; i++) {
  arrow(O[i].x + O[i].w / 2, O[i].y + O[i].h, O[i].x + O[i].w / 2, O[i + 1].y, C.mute, 'mute');
}

// ------------------------------------------------------------------ loop lanes
const MONO_ADV = 6.0;   // advance per char at font-size 10

const lanes = [
  // i, from, to, label, anchor.  Return x values are all distinct so the
  // descending verticals never coincide; labels are anchored away from them.
  { i: 0, from: O[2].x + 30,  to: F[1].x + 40,  anchor: 'middle',
    text: 'L1  frame spectrum -> AGC + warp check  [ops 18-20]' },
  { i: 1, from: T[1].x + 60,  to: S[1].x + 40,  anchor: 'end',
    text: 'L2  task execution -> real machine load -> telemetry  (signal IS the work)' },
  { i: 2, from: F[0].x + 8,   to: S[1].x + 120, anchor: 'end',
    text: 'L3  renderer GPU/power cost -> telemetry  (self-referential)' },
  { i: 3, from: O[0].x + 120, to: S[0].x + 200, anchor: 'middle',
    text: 'L4  human: sees display -> speaks / slides -> new task   [ops 7, 9]' },
];

for (const L of lanes) {
  const y = laneY[L.i];
  L.y = y;
  L.lx = L.anchor === 'end' ? L.from - 10 : (L.from + L.to) / 2;
  const w = L.text.length * MONO_ADV;
  L.span = L.anchor === 'end' ? [L.lx - w, L.lx] : [L.lx - w / 2, L.lx + w / 2];
  P(`<path d="M${L.from},${colBottom} L${L.from},${y} L${L.to},${y} L${L.to},${colBottom}" fill="none" stroke="${C.loop}" stroke-width="1.7" stroke-dasharray="7 5" marker-end="url(#ah-loop)"/>`);
  P(`<text x="${L.lx}" y="${y - 7}" font-size="10" font-family="${MONO}" font-weight="700" fill="${C.loop}" text-anchor="${L.anchor}">${esc(L.text)}</text>`);
}

// footer legend
P(`<text x="40" y="${fy}" font-size="10.5" font-family="${MONO}" fill="${C.mute}">V = 44.1 kHz audio-rate path, the only Nyquist-comfortable signal in the system.   T = 0.3-5 Hz control-rate path, usable band 0-2.5 Hz without root.</text>`);
P(`<text x="40" y="${fy + 17}" font-size="10.5" font-family="${MONO}" fill="${C.mute}">Objective 1 = columns A-B-D-E.  Objective 2 adds the voice path (A.MIC -> B.V -> C.ASR) and the morphogenesis layout in D.</text>`);
P(`<text x="${W - 40}" y="${fy + 17}" font-size="10" font-family="${MONO}" fill="${C.rule}" text-anchor="end">figures/make-block-diagram.js</text>`);

P(`</svg>`);

const svg = out.join('\n');
const dst = path.join(__dirname, 'block-diagram.svg');
fs.writeFileSync(dst, svg);

// ------------------------------------------------------------- sanity checking
let bad = 0;
for (let i = 0; i < placed.length; i++) {
  for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    if (a.col !== b.col) continue;
    if (a.y < b.y + b.h && b.y < a.y + a.h) { bad++; console.error('OVERLAP', a.title, b.title); }
  }
}
for (const b of placed) {
  if (b.y + b.h > colBottom) { bad++; console.error('OVERFLOW', b.title); }
  const longest = Math.max(b.title.length, ...b.lines.map(l => l.length));
  const needed = 21 - 10 + longest * 6.05 + 8;   // mono advance at 9.8px ~= 5.9
  if (needed > b.w - 20) { bad++; console.error('TOO WIDE', b.col, b.title, Math.round(needed), '>', b.w - 20); }
}

// Every loop lane runs a dashed vertical down from colBottom to its own lane.
// A label must not sit on top of one, so check each label's span against every
// vertical that actually descends past that label's y.
const verticals = lanes.flatMap(L => [{ x: L.from, y: L.y }, { x: L.to, y: L.y }]);
for (const L of lanes) {
  for (const v of verticals) {
    if (v.y < L.y) continue;                       // stops above this lane
    if (v.x > L.span[0] - 6 && v.x < L.span[1] + 6) {
      bad++; console.error('LABEL CROSSES LANE', L.text.slice(0, 12), 'at x=' + v.x);
    }
  }
}
const retX = lanes.map(L => L.to);
if (new Set(retX).size !== retX.length) { bad++; console.error('COINCIDENT RETURN VERTICALS', retX); }

console.log(`blocks=${placed.length} colBottom=${colBottom} lastLane=${laneY[3]} footer=${fy + 17} canvasH=${H} problems=${bad}`);
if (bad) process.exit(1);
