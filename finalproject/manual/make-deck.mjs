// make-deck.mjs — a ten-minute talk, built from the live registry.
//
// Separate from make-manual.mjs on purpose. The manual is a reference you
// look things up in; this is a deck you stand next to. Different audience,
// different density: one idea per slide, nothing on a slide that the speaker
// would only read aloud.
//
// Counts, operator names and the preset list are read from the software, so
// the deck cannot claim something the tool no longer does.

import { OPS, CATS, DESTS } from '../m0-telemetry/patch/ops.js';
import { OPGUIDE } from '../m0-telemetry/patch/opguide.js';
import fs from 'fs';

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const byCat = c => Object.entries(OPS).filter(([, o]) => o.cat === c);
const N = Object.keys(OPS).length;

const presets = fs.readdirSync('../m1-psyche/presets')
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync('../m1-psyche/presets/' + f, 'utf8')))
  .sort((a, b) => a.name.localeCompare(b.name));

// feedback tunnel, read out as sentences — the "read a patch" slide
const tunnel = presets.find(p => p.name === 'feedback tunnel');
const ids = Object.fromEntries(tunnel.graph.nodes.map(n => [n.id, n]));
const sentences = tunnel.graph.edges.map(e => {
  const a = ids[e.from], b = ids[e.to];
  const av = a.p.v !== undefined ? a.p.v : (a.p.f !== undefined ? a.p.f + 'Hz' : '');
  return [a.type + (av !== '' ? `(${av})` : ''),
          b.type + (b.type === 'out' ? `  →  ${b.p.dest}` : '')];
});

const slides = [];
const S = (cls, html) => slides.push(`<section class="${cls}">${html}</section>`);

// ---------------------------------------------------------------- 1 title
S('title', `
  <div class="eyebrow">CSVAD Fall 25 · final project</div>
  <h1>Psychedelic OS</h1>
  <p class="sub">Turning the whole screen into something you can patch</p>
  <div class="meta">${N} operators · ${presets.length} presets · built this term</div>`);

// ---------------------------------------------------------------- 2 idea
S('big', `
  <h2>The idea</h2>
  <p class="lead">Your desktop already is a signal.</p>
  <p>Every window, every line of text, every pixel of brightness is data
     sitting there, unused. <b>PSYCHE mode</b> treats it as something you can
     read, select and transform — the way a synthesiser treats sound.</p>
  <p class="aside">Not a screensaver. Not a filter. A patchable instrument
     whose input happens to be your own computer.</p>`);

// ---------------------------------------------------------------- 3 two halves
S('split', `
  <h2>Two windows</h2>
  <div class="cols">
    <div><h3>The Patcher</h3>
      <p>Where you build. Blocks on a canvas, wires between them. Nothing is
         typed; everything is dragged and connected.</p></div>
    <div><h3>The Render</h3>
      <p>Where you look. It shows your real screen, processed live, and
         updates as you drag a number — no save, no reload.</p></div>
  </div>
  <p class="aside">Change anything on the left and the right moves within
     a sixth of a second.</p>`);

// ---------------------------------------------------------------- 4 spine
S('spine', `
  <h2>The whole model, in four words</h2>
  <div class="chain">
    <div class="st"><b>READ</b><span>turn the screen into pieces</span></div>
    <div class="ar">→</div>
    <div class="st"><b>PICK</b><span>choose which pieces</span></div>
    <div class="ar">→</div>
    <div class="st"><b>EFFECT</b><span>do something to them</span></div>
    <div class="ar">→</div>
    <div class="st"><b>OUTPUT</b><span>send it to the picture</span></div>
  </div>
  <p class="aside">Every patch in this project is some arrangement of these
     four. If you understand this line, you can read any of them.</p>`);

// ---------------------------------------------------------------- 5 ports
S('ports', `
  <h2>Wires have types</h2>
  <div class="cols three">
    <div><span class="port num"></span><h3>Number</h3>
      <p>A changing value. Load, a wave, a measurement.</p></div>
    <div><span class="port shape"></span><h3>Shape</h3>
      <p>A form you can move, repeat and combine before anything is drawn.</p></div>
    <div><span class="port sel"></span><h3>Selection</h3>
      <p>A rule for <i>which</i> things an effect touches.</p></div>
  </div>
  <p class="aside">A wire between mismatched types is refused. That is the
     patcher stopping you from spending an hour on a dead patch.</p>`);

// ---------------------------------------------------------------- 6 read
S('list', `
  <h2>READ — three ways to see a screen</h2>
  <dl>
    ${byCat('read').map(([t, o]) =>
      `<dt>${esc(o.title)}</dt><dd>${esc(OPGUIDE[t].what)}</dd>`).join('')}
  </dl>
  <p class="aside">Elements need the Accessibility API and know what a word
     <i>is</i>. Grid and regions need only pixels, and work on anything.</p>`);

// ---------------------------------------------------------------- 7 pick
S('list', `
  <h2>PICK — ${byCat('pick').length} ways to choose</h2>
  <div class="cloud">
    ${byCat('pick').map(([, o]) => `<span>${esc(o.title)}</span>`).join('')}
  </div>
  <p class="lead">“Every number on screen, wherever it is.”</p>
  <p>“The filenames in Finder, but not the sidebar.” “Only the busy parts.”
     “Everything inside this circle.” Each of those is one or two blocks.</p>`);

// ---------------------------------------------------------------- 8 effects
S('split', `
  <h2>EFFECT — three families</h2>
  <div class="cols three">
    <div><h3>Typography · ${byCat('text').length}</h3>
      <p>Moves individual letters. Needs real text, so it needs the
         Accessibility reader.</p>
      <p class="small">Wave · Scale · Weight/width/slant · Cascade delay</p></div>
    <div><h3>Layout · ${byCat('layout').length}</h3>
      <p>Moves whole windows, panels or tiles.</p>
      <p class="small">Spiral · Gravity · Ring · Drift · Tilt</p></div>
    <div><h3>Image chain</h3>
      <p>Scan deflection, video feedback, reaction-diffusion, colour.</p>
      <p class="small">The psychedelic part.</p></div>
  </div>`);

// ---------------------------------------------------------------- 9 output
S('big', `
  <h2>OUTPUT — the only block that reaches the picture</h2>
  <p>${DESTS.length} destinations. Each is one dial on the renderer.</p>
  <div class="cloud tight">
    ${DESTS.slice(0, 18).map(d => `<span>${esc(d[0])}</span>`).join('')}
  </div>
  <p class="lead">The one to remember is <code>chain.mix</code>.</p>
  <p>0 = your screen, completely normal. 1 = completely transformed.
     Anywhere between composites the real screen back underneath — which is
     how the effect runs <b>and the text stays readable</b>.</p>`);

// ---------------------------------------------------------------- 10 read a patch
S('code', `
  <h2>Reading a patch: “feedback tunnel”</h2>
  <p class="aside top">Ten wires. That is the entire preset.</p>
  <table>
    ${sentences.map(([a, b]) => `<tr><td class="l">${esc(a)}</td>
      <td class="m">→</td><td class="r">${esc(b.replace(/^out\s+→\s+/, ''))}</td></tr>`).join('')}
  </table>`);

// ---------------------------------------------------------------- 11 grammar
S('grammar', `
  <h2>The grammar — three sentences</h2>
  <div class="rule"><code>Constant → Output</code>
    <span>A dial you set and leave. Most of a preset is this.</span></div>
  <div class="rule"><code>LFO → Remap → Output</code>
    <span>A dial that moves by itself. The Remap translates −1…1 into the
      range that dial actually wants.</span></div>
  <div class="rule"><code>Read → Pick → Effect</code>
    <span>Cut the screen up, choose some pieces, move them.</span></div>
  <p class="aside">Every one of the ${presets.length} presets is built from
     these three and nothing else.</p>`);

// ---------------------------------------------------------------- 12 build
S('steps', `
  <h2>Building one, from empty</h2>
  <ol>
    <li><b>empty</b> — clear the canvas</li>
    <li>Click <b>Constant</b> and <b>Output</b> in the sidebar. Wire them.
        Set the Output's destination to <code>chain.mix</code>, the Constant
        to <code>0.55</code>. Half your screen shows through.</li>
    <li>Add <b>LFO → Remap → Output</b>. Remap out <code>8…70</code>,
        destination <code>scan.amp</code>. Now it breathes.</li>
    <li>Add <b>Gradient ramp</b>. No wires — placing it is enough. Colour.</li>
    <li><b>save preset</b>. Name it. It is in the list.</li>
  </ol>
  <p class="aside">Eight blocks, four wires, about three minutes.</p>`);

// ---------------------------------------------------------------- 13 select
S('big', `
  <h2>Selecting what an effect touches</h2>
  <p class="lead">An effect with nothing wired to its selection input hits
     everything.</p>
  <p>Wire a <b>Pick</b> block into it and it hits only what that rule
     describes. One selection can feed several effects; two selections can be
     combined before they reach any.</p>
  <p>Click something in the <b>inspect</b> panel and the patcher writes that
     element's path into a Pick block for you.</p>
  <p class="aside">Each effect shows a live count — <code>64/663</code> — of
     how many things it is actually reaching. Red when it reaches nothing,
     which is the failure that otherwise looks identical to working.</p>`);

// ---------------------------------------------------------------- 14 presets
S('list', `
  <h2>The ${presets.length} presets</h2>
  <dl class="two">
    ${presets.map(p => `<dt>${esc(p.name)}</dt><dd>${esc((p.note || '').split('.')[0])}.</dd>`).join('')}
  </dl>`);

// ---------------------------------------------------------------- 15 format
S('code', `
  <h2>A preset is just the patch, saved</h2>
  <pre>{ "name": "feedback tunnel",
  "note": "Each frame drawn on top of the last…",
  "graph": {
    "nodes": [ { "id":"a1", "type":"const", "x":60, "y":60, "p":{ "v":1 } } ],
    "edges": [ { "from":"a1", "fo":0, "to":"a2", "ti":0 } ]
  } }</pre>
  <p>A node is a block and its settings. An edge is a wire: <i>from this
     block's output, into that block's input.</i></p>
  <p class="aside">No code, no special format. Anything you can build, you
     can save; anything saved, you can open and take apart.</p>`);

// ---------------------------------------------------------------- 16 traps
S('grammar', `
  <h2>Two rules that bite</h2>
  <div class="rule warn"><code>One Output per destination</code>
    <span>Two blocks writing the same dial fight, and whichever runs last
      silently wins. This made one preset render pure white.</span></div>
  <div class="rule warn"><code>Match the range</code>
    <span><code>fb.zoom</code> lives between 0.999 and 1.006. Feeding it a
      raw 0…1 wave sends it to the moon. That is what the Remap is for.</span></div>`);

// ---------------------------------------------------------------- 17 honest
S('split', `
  <h2>Where it stands</h2>
  <div class="cols">
    <div><h3>Working</h3>
      <p>${N} operators · ${presets.length} presets · reads the live screen
         through the Accessibility API and as pixels · effects scoped to a
         chosen window · everything patchable while it runs.</p></div>
    <div><h3>Not yet</h3>
      <p>The effect runs in a window showing a processed copy of your screen.
         Altering the <i>actual</i> desktop needs a native always-on-top
         overlay with ScreenCaptureKit — designed, not built.</p></div>
  </div>`);

// ---------------------------------------------------------------- 18 close
S('title end', `
  <h1>Patch your own desktop</h1>
  <p class="sub">READ → PICK → EFFECT → OUTPUT</p>
  <div class="meta">Shashank · CSVAD Fall 25</div>`);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Psychedelic OS — talk</title>
<style>
  @page { size: 1280px 720px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#0b0f14; }
  body { font: 20px/1.6 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
         color:#cfe0ea; -webkit-font-smoothing:antialiased; }
  section { width:1280px; height:720px; padding:76px 92px; position:relative;
            page-break-after:always; break-after:page; overflow:hidden;
            background:#0b0f14; display:flex; flex-direction:column;
            justify-content:center; }
  h1 { font-size:68px; line-height:1.05; margin:0 0 18px; color:#fff; font-weight:600;
       letter-spacing:-0.02em; }
  h2 { font-size:40px; margin:0 0 26px; color:#fff; font-weight:600; letter-spacing:-0.01em; }
  h3 { font-size:22px; margin:0 0 8px; color:#d09a4a; font-weight:600; }
  p  { margin:0 0 16px; max-width:62ch; }
  p.lead { font-size:28px; color:#fff; line-height:1.35; }
  p.aside { color:#7d94a4; font-size:17px; border-left:2px solid #2b3744;
            padding-left:14px; margin-top:22px; }
  p.aside.top { margin:0 0 20px; }
  p.small { color:#7d94a4; font-size:16px; }
  b { color:#fff; font-weight:600; }
  i { color:#a8c6d6; }
  code { font-family:ui-monospace, Menlo, monospace; font-size:0.9em;
         background:#151c25; padding:2px 7px; border-radius:4px; color:#8fd9c4; }
  .eyebrow { color:#7d94a4; font-size:15px; letter-spacing:.18em;
             text-transform:uppercase; margin-bottom:26px; }
  .sub { font-size:26px; color:#a8c6d6; }
  .meta { position:absolute; left:92px; bottom:64px; color:#5a7788; font-size:15px;
          letter-spacing:.06em; }
  section.title { background:linear-gradient(145deg,#0b0f14 0%,#141026 55%,#1d1030 100%); }
  section.end   { background:linear-gradient(145deg,#0b0f14 0%,#101d26 55%,#0d2b2a 100%); }

  .cols { display:flex; gap:48px; margin:10px 0 0; }
  .cols > div { flex:1; }
  .cols.three > div { flex:1; }
  .cols p { font-size:18px; }

  .chain { display:flex; align-items:stretch; gap:14px; margin:24px 0 10px; }
  .chain .st { flex:1; background:#121923; border:1px solid #243040; border-radius:10px;
               padding:22px 20px; }
  .chain .st b { display:block; font-size:24px; color:#d09a4a; letter-spacing:.04em;
                 margin-bottom:8px; }
  .chain .st span { font-size:16px; color:#a8c6d6; }
  .chain .ar { align-self:center; color:#46586b; font-size:26px; }

  .port { display:inline-block; width:20px; height:20px; margin-bottom:12px;
          background:#d09a4a; }
  .port.num { border-radius:50%; }
  .port.shape { border-radius:3px; background:#6fb3d9; }
  .port.sel { transform:rotate(45deg); border-radius:2px; background:#c77fa8; }

  dl { margin:0; }
  dl.two { column-count:2; column-gap:52px; }
  dt { color:#fff; font-weight:600; font-size:19px; margin-top:14px; break-after:avoid; }
  dt:first-child { margin-top:0; }
  dd { margin:3px 0 0; color:#a8c6d6; font-size:16.5px; line-height:1.5;
       break-inside:avoid; }

  .cloud { display:flex; flex-wrap:wrap; gap:9px; margin:4px 0 22px; }
  .cloud span { background:#151c25; border:1px solid #243040; border-radius:20px;
                padding:7px 15px; font-size:16px; color:#cfe0ea; }
  .cloud.tight span { font-family:ui-monospace, Menlo, monospace; font-size:14px;
                      padding:5px 11px; color:#8fd9c4; }

  /* align-self, because a section is a flex column and a bare table would
     otherwise stretch to the full slide width, spreading the columns apart. */
  table { border-collapse:collapse; font-family:ui-monospace, Menlo, monospace;
          font-size:17px; align-self:flex-start; }
  td { padding:5px 0; }
  td.l { color:#cfe0ea; padding-right:18px; }
  td.m { color:#46586b; padding-right:18px; }
  td.r { color:#8fd9c4; }

  pre { align-self:flex-start; font-family:ui-monospace, Menlo, monospace; font-size:16px; line-height:1.6;
        background:#121923; border:1px solid #243040; border-radius:10px;
        padding:22px 24px; color:#a8c6d6; margin:0 0 22px; }

  .rule { background:#121923; border:1px solid #243040; border-left:3px solid #d09a4a;
          border-radius:8px; padding:18px 22px; margin-bottom:14px; }
  .rule code { font-size:18px; background:none; padding:0; color:#d09a4a; }
  .rule span { display:block; margin-top:6px; color:#a8c6d6; font-size:17px; }
  .rule.warn { border-left-color:#c7563f; }
  .rule.warn code { color:#e88a74; }

  ol { margin:0; padding-left:26px; max-width:76ch; }
  li { margin-bottom:13px; font-size:19px; color:#cfe0ea; }
  li b { color:#d09a4a; }
</style></head><body>
${slides.join('\n')}
</body></html>`;

fs.writeFileSync('deck.html', html);
console.log(`deck.html — ${slides.length} slides, ${N} operators, ${presets.length} presets`);
