// make-manual.mjs — builds the manual from the live operator registry.
//
// The reference section is generated, never written by hand, so it cannot
// drift from the software. Descriptions come from patch/opdocs.js, which is
// the same file the patcher uses for its hover text: one source, two
// outputs. Run it, then print the HTML to PDF.

import { OPS, CATS, DESTS } from '../m0-telemetry/patch/ops.js';
import { OPDOCS } from '../m0-telemetry/patch/opdocs.js';
import fs from 'fs';

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const KIND = {
  source:'signal', math:'signal', combine:'signal', filter:'signal', dsp:'signal',
  draw:'signal', logic:'signal', gen:'signal', util:'signal', rd:'signal',
  text:'modulator', layout:'modulator',
  shape:'geometry', xform:'geometry', shapeop:'geometry',
  render:'sink', color:'sink', bot:'sink', out:'sink',
};
const KINDNOTE = {
  signal:'Numbers in, numbers out. These have an output port and must end at a sink.',
  geometry:'Make or transform a shape — a field, not a number. Square ports.',
  modulator:'No output port. Adds a behaviour to a stack the renderer walks. Applies top to bottom by node position.',
  sink:'Ends a chain by handing something to the renderer.',
};

let ops = '';
for (const [cat, label] of CATS) {
  const list = Object.entries(OPS).filter(([, o]) => o.cat === cat);
  if (!list.length) continue;
  const kind = KIND[cat] || 'signal';
  ops += `<h3 class="grp">${esc(label)} <span class="kindtag ${kind}">${kind}</span></h3>`;
  ops += `<p class="kindnote">${esc(KINDNOTE[kind])}</p>`;
  for (const [type, op] of list) {
    const ins = op.ins.map(p => esc(p.label || p.k) + (p.shape ? ' <i>(shape)</i>' : '')).join(', ');
    const outs = op.outs.map(p => esc(p.label || p.k) + (p.shape ? ' <i>(shape)</i>' : '')).join(', ');
    const ps = op.params.map(p => {
      if (p.type === 'num') return `<b>${esc(p.label)}</b> ${p.min}–${p.max}`;
      if (p.type === 'sel') return `<b>${esc(p.label)}</b> ${p.options.map(esc).join(' / ')}`;
      if (p.type === 'col') return `<b>${esc(p.label)}</b> colour`;
      if (p.type === 'curve') return `<b>${esc(p.label)}</b> <i>drawn curve</i>`;
      return `<b>${esc(p.k)}</b>`;
    }).join(' &middot; ');
    ops += `<div class="op">
      <div class="opname"><span class="dot" style="background:${op.color}"></span>${esc(op.title)}
        <code>${esc(type)}</code></div>
      <div class="opdesc">${OPDOCS[type] || ''}</div>
      <div class="opio">${ins ? `<span class="io">in</span> ${ins}` : '<span class="io">in</span> —'}
        ${outs ? `&nbsp;&nbsp;<span class="io">out</span> ${outs}` : '&nbsp;&nbsp;<span class="io">out</span> none (sink)'}</div>
      ${ps ? `<div class="oppar">${ps}</div>` : ''}
    </div>`;
  }
}

const destGroups = {};
for (const d of DESTS) {
  const p = d[0].split('.')[0];
  (destGroups[p] ??= []).push(d);
}
let dests = '';
for (const [g, ds] of Object.entries(destGroups)) {
  dests += `<tr><td class="dg" colspan="3">${esc(g)}</td></tr>`;
  for (const d of ds) {
    dests += `<tr><td><code>${esc(d[0])}</code></td><td class="rng">${d[1]} – ${d[2]}</td><td>${esc(d[3])}</td></tr>`;
  }
}

const nOps = Object.keys(OPS).length;
const today = new Date().toISOString().slice(0, 10);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Patcher Manual</title>
<style>
@page { size: A4; margin: 17mm 15mm 16mm; }
* { box-sizing: border-box; }
body { font: 10.2pt/1.52 "Helvetica Neue", Helvetica, Arial, sans-serif; color:#15191e; margin:0; }
code, .mono { font-family: Menlo, ui-monospace, monospace; font-size: 9pt; }
h1 { font-size: 26pt; margin: 0 0 4pt; letter-spacing:-.4pt; }
h2 { font-size: 14pt; margin: 20pt 0 6pt; padding-bottom:3pt; border-bottom:1.2pt solid #15191e;
     page-break-after: avoid; }
h3 { font-size: 11pt; margin: 13pt 0 4pt; page-break-after: avoid; }
h3.grp { margin-top: 15pt; }
p { margin: 0 0 6pt; }
.lede { color:#55606c; font-size:10.5pt; }
.cover { page-break-after: always; padding-top: 42mm; }
.cover .sub { font-size: 13pt; color:#55606c; margin-top:6pt; }
.cover .meta { margin-top: 26pt; font-size:9.3pt; color:#6b7784; line-height:1.9; }
.cover .big { margin-top: 30pt; display:flex; gap:26pt; }
.cover .big div { font-size:9.3pt; color:#55606c; }
.cover .big b { display:block; font-size:21pt; color:#15191e; font-weight:600; }
table { width:100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 9.3pt; }
th { text-align:left; border-bottom:1pt solid #15191e; padding:3pt 5pt; font-size:8.6pt;
     text-transform:uppercase; letter-spacing:.5pt; }
td { border-bottom:.4pt solid #dde2e8; padding:3pt 5pt; vertical-align:top; }
td.dg { background:#f2f5f8; font-weight:600; font-size:8.6pt; text-transform:uppercase; letter-spacing:.5pt; }
td.rng { white-space:nowrap; color:#55606c; font-family:Menlo,monospace; font-size:8.4pt; }
pre { background:#f4f6f9; border-left:2.5pt solid #c3ccd6; padding:7pt 9pt; margin:6pt 0 9pt;
      font-family:Menlo,monospace; font-size:8.5pt; line-height:1.45; white-space:pre-wrap;
      page-break-inside: avoid; }
.op { page-break-inside: avoid; margin: 0 0 7pt; padding-left: 9pt; border-left: 2pt solid #e4e9ee; }
.opname { font-weight:600; font-size:10pt; }
.opname code { color:#7a8694; font-weight:400; margin-left:5pt; }
.dot { display:inline-block; width:7pt; height:7pt; border-radius:1.5pt; margin-right:5pt; }
.opdesc { color:#333c46; margin:1pt 0 2pt; }
.opio, .oppar { font-size:8.6pt; color:#6b7784; font-family:Menlo,monospace; }
.oppar { margin-top:1pt; }
.io { text-transform:uppercase; letter-spacing:.5pt; font-size:7.4pt; color:#9aa5b1; }
.kindtag { font-size:7.6pt; text-transform:uppercase; letter-spacing:.7pt; padding:1.5pt 5pt;
           border-radius:2pt; vertical-align:2pt; margin-left:5pt; font-weight:600; }
.kindtag.signal{background:#dcebf7;color:#1c4e73}
.kindtag.geometry{background:#dff0e4;color:#1f5a33}
.kindtag.modulator{background:#f6e2ee;color:#71265a}
.kindtag.sink{background:#fae0da;color:#7d2d1c}
.kindnote { font-size:8.8pt; color:#6b7784; margin:0 0 6pt; }
.key { display:inline-block; border:.8pt solid #8b96a2; border-radius:2.5pt; padding:0 4pt;
       font-family:Menlo,monospace; font-size:8.4pt; background:#fff; }
.note { background:#fff8e6; border-left:2.5pt solid #d9a441; padding:6pt 9pt; margin:7pt 0;
        font-size:9.3pt; page-break-inside:avoid; }
.warn { background:#fdeeea; border-left:2.5pt solid #c4553a; padding:6pt 9pt; margin:7pt 0;
        font-size:9.3pt; page-break-inside:avoid; }
.two { column-count:2; column-gap:13pt; }
.pb { page-break-before: always; }
</style></head><body>

<div class="cover">
  <h1>The Patcher</h1>
  <div class="sub">A manual for the Computing Visualizer and the Psychedelic OS</div>
  <div class="big">
    <div><b>${nOps}</b>operators</div>
    <div><b>${CATS.length}</b>groups</div>
    <div><b>${DESTS.length}</b>destinations</div>
    <div><b>4</b>kinds of block</div>
  </div>
  <div class="meta">
    Generated ${today} from the running software.<br>
    The reference section is produced from the operator registry itself, so it
    cannot drift from what the program actually does.<br><br>
    <b>Start the daemon:</b> <code>cd m0-telemetry &amp;&amp; node telemetryd.js</code><br>
    <b>Psychedelic OS:</b> <code>localhost:7777/m1/psyche.html</code><br>
    <b>Computing Visualizer:</b> <code>localhost:7777/patch.html</code>
  </div>
</div>

<h2>1 &nbsp; What this is</h2>
<p>Two systems that share one engine.</p>
<p><b>The Computing Visualizer</b> turns your machine's own telemetry into an
image: 43 measured channels, a Rutt/Etra scan processor, a video feedback
loop, Gray-Scott chemistry on the GPU.</p>
<p><b>The Psychedelic OS</b> points the same machinery at a desktop instead of
a machine map, and adds per-glyph typography, surface layout, and a botanical
view of your filesystem.</p>
<p>Each has its own patcher page and its own saved patch, but they share the
graph engine, the operator registry and the editor. An operator built for one
is available in the other.</p>

<h2>2 &nbsp; How a patch becomes an image</h2>
<pre>  telemetry (43 channels, SSE)
        |
   YOUR PATCH          numbers are conditioned, analysed, combined
        |
        +--&gt; 37 named destinations     scan.amp, fb.gain, rd.mix, chain.mix ...
        +--&gt; $shapes                   fields to draw
        +--&gt; $color                    the colouriser
        +--&gt; $text                     the typography stack
        +--&gt; $layout                   the surface stack
        +--&gt; $bot                      the tree's geometry
        |
   THE RENDERER        source raster -&gt; scan processor and/or chemistry
                       -&gt; feedback -&gt; colouriser -&gt; screen</pre>
<p>That list is the whole contract. Everything a patch can produce is one of
those six things, and the patcher's top bar shows which of them you are
currently sending.</p>

<h2>3 &nbsp; The four kinds of block</h2>
<table>
<tr><th>Kind</th><th>What it does</th><th>Output port?</th></tr>
<tr><td><span class="kindtag signal">signal</span></td><td>Makes or shapes a number</td><td>yes</td></tr>
<tr><td><span class="kindtag geometry">geometry</span></td><td>Makes or transforms a shape (a field)</td><td>yes, <b>square</b> ports</td></tr>
<tr><td><span class="kindtag modulator">modulator</span></td><td>Describes a behaviour for every letter or window</td><td><b>no</b></td></tr>
<tr><td><span class="kindtag sink">sink</span></td><td>Hands something to the renderer</td><td><b>no</b></td></tr>
</table>
<p><b>The one rule: signals flow left to right and must end at a sink.</b>
A chain that ends in mid-air does nothing. There are four ways to end: an
<i>Output</i> node, a <i>Fill</i> or <i>Contour</i>, a <i>colouriser</i>, or
any typography or layout block.</p>
<div class="warn"><b>The one surprise.</b> Typography and layout modulators
apply <b>top to bottom by where their nodes sit on the canvas</b>, like a
layer stack. Drag a node up or down to change when it runs. A <i>Cascade
delay</i> only affects the modulators <i>below</i> it.</div>
<div class="note">Square ports carry shapes, round ports carry numbers. The
editor refuses a wire between them and tells you why.</div>

<h2>4 &nbsp; Navigating the patcher</h2>
<table>
<tr><th>Action</th><th>How</th></tr>
<tr><td>Pan / zoom</td><td>drag the background &middot; scroll wheel</td></tr>
<tr><td>Add an operator</td><td>click it in the palette. Hover for what it does</td></tr>
<tr><td>Find an operator</td><td>type in <b>filter operators</b> &mdash; matches name, group and id. <span class="key">esc</span> clears</td></tr>
<tr><td>Wire</td><td>drag from a port to a port</td></tr>
<tr><td>Cut a wire</td><td>click the wire</td></tr>
<tr><td>Change a number</td><td>type in it, or <b>drag its name left/right</b> to scrub. Hold shift for fine</td></tr>
<tr><td>Draw a curve</td><td>drag inside the green box. Double-click smooths, shift-double-click resets</td></tr>
<tr><td>Delete</td><td>select, then <span class="key">delete</span></td></tr>
<tr><td>See the whole patch</td><td><b>outline</b> &mdash; every chain as text, source to sink. Click a line to jump to it</td></tr>
<tr><td>Arrange it</td><td><b>tidy</b> &mdash; columns are dependency depth. Rows keep their order, so modulator order is preserved</td></tr>
<tr><td>Live preview</td><td><b>preview</b> docks a view that follows your edits with no save</td></tr>
<tr><td>Save / undo</td><td><span class="key">cmd S</span> or <b>save</b> &middot; <b>revert</b> returns to the last saved version</td></tr>
</table>
<div class="note"><b>Where an edit shows up.</b> The preview pane, the floating
panel and any open visualizer tab all follow your edits <i>live, without
saving</i>. Only the file on disk waits for save. One consequence: a live push
rebuilds every node, so a 40-second analysis window needs 40 seconds to refill
after each edit.</div>

<h2>5 &nbsp; Navigating the view</h2>
<table>
<tr><th>Key</th><th>Does</th></tr>
<tr><td><span class="key">I</span></td><td>Force the image chain fully on. Use when no patch is driving <code>chain.mix</code> and nothing seems to happen</td></tr>
<tr><td><span class="key">B</span></td><td>Bypass every modulator &mdash; the fast A/B against plain text</td></tr>
<tr><td><span class="key">T</span></td><td>Text on / off</td></tr>
<tr><td><span class="key">D</span></td><td>Synthetic demo data, when the daemon is not running</td></tr>
<tr><td><span class="key">space</span></td><td>Pause</td></tr>
</table>
<p>In the Computing Visualizer: <span class="key">F</span> feedback,
<span class="key">S</span> scan processor, <span class="key">G</span> shapes,
<span class="key">R</span> chemistry, <span class="key">C</span> clear,
<span class="key">[</span> <span class="key">]</span> feedback gain.</p>

<h3>The floating panel</h3>
<p><code>./bin/hud-panel --view psyche</code> puts a view above every other
window, on every Space, surviving other apps going fullscreen.</p>
<table>
<tr><td><span class="key">ctrl opt V</span></td><td>Make it interactive (it is click-through by default)</td></tr>
<tr><td><span class="key">cmd return</span></td><td>Maximise / restore</td></tr>
<tr><td>arrows</td><td>Move &middot; shift-arrows resize &middot; option-arrows by one pixel</td></tr>
<tr><td>menu bar &#9673;</td><td>View, Size, Opacity, Reset position, Reload, Quit</td></tr>
</table>
<div class="note">If it comes back smaller than you asked for, it is restoring
a remembered frame. Pass <code>--reset</code>.</div>

<h2>6 &nbsp; The four sources</h2>
<p>The Psychedelic view can be pointed at four things, and they do not carry
the same information.</p>
<table>
<tr><th></th><th>mock</th><th>tree</th><th>read my screen</th><th>capture</th></tr>
<tr><td>Image chain (deflection, chemistry, feedback, colour)</td><td>yes</td><td>yes</td><td>yes</td><td>yes</td></tr>
<tr><td>Shapes (SDF)</td><td>yes</td><td>yes</td><td>yes</td><td>yes</td></tr>
<tr><td>Layout &amp; orientation</td><td>yes</td><td>yes</td><td>yes</td><td>yes</td></tr>
<tr><td>Typography (per glyph)</td><td>yes</td><td>yes</td><td>yes</td><td><b>no</b></td></tr>
<tr><td>Semantic phase sources and targets</td><td>&mdash;</td><td>&mdash;</td><td>yes</td><td><b>no</b></td></tr>
<tr><td>Botanical</td><td>&mdash;</td><td>yes</td><td>&mdash;</td><td>&mdash;</td></tr>
</table>
<div class="warn"><b>Capture is pixels.</b> A captured screen has no glyphs, no
words, no elements, so the typography operators have nothing to address. For
letters on your real desktop use <b>read my screen</b>, which goes through the
Accessibility API and carries structure. The browser can process pixels; only
native code can process structure.</div>

<h2 class="pb">7 &nbsp; Recipes</h2>

<h3>Make the desktop dissolve as the machine works</h3>
<pre>cpu.busy_pct -&gt; Scale (x0.01) -&gt; Low pass (0.5 Hz)
             -&gt; Remap (0.08..0.70 -&gt; 0..0.9) -&gt; Output [chain.mix]</pre>
<p>At idle the desktop is crisp and usable; under load it goes through the whole
image chain. That gradient is the micro-dose: the readable desktop is one end
of a continuous knob, not a separate mode.</p>

<h3>A wave that travels along every word</h3>
<pre>cpu.busy_pct -&gt; Scale -&gt; Low pass -&gt; Remap (-&gt; 2..16) -&gt; Wave [amplitude]
Wave: phase from = index, phase scale = 0.6</pre>
<p><b>Phase from</b> is the one control worth understanding. <code>index</code>
restarts at every word, so the wave runs along words. <code>word</code> makes
whole words bob in sequence. <code>line</code> ripples down the page.
<code>entropy</code> makes dense text move more than repetitive text.</p>

<h3>Draw a filter</h3>
<pre>disk.tps -&gt; Drawn kernel (FIR) -&gt; Scope</pre>
<p>Draw in the green box. The drawing is the impulse response: left is now,
right is the past. Flat is a boxcar average, falling is an exponential
smoother, a bump at the right edge is an echo. Measured: a flat drawing gives
179.9 dB between 0.05 Hz and 3 Hz.</p>

<h3>Let memory pressure disturb the page</h3>
<pre>vm.pageouts_per_s -&gt; Normalise (ref 900) -&gt; Envelope (120 / 3000 ms)
                  -&gt; Remap (-&gt; 0..0.22) -&gt; Scatter [amount]</pre>
<p>Pressure, not load. Something going wrong should not look like something
merely being busy.</p>

<h3>Grow your filesystem</h3>
<pre>disk.tps -&gt; Normalise -&gt; Low pass -&gt; Remap (-&gt; 0.35..1) -&gt; Growth [amount]
cpu.busy_pct -&gt; ... -&gt; Fruit / flowers [bloom]</pre>
<p>Switch the view source to <i>my folders as a tree</i>. Directories are stems,
subdirectories are branches, files are fruit. Thickness follows the square root
of the files in a subtree &mdash; da Vinci's rule.</p>

<h2>8 &nbsp; When something looks wrong</h2>
<table>
<tr><th>What you see</th><th>Why</th></tr>
<tr><td>Nothing happens at all</td><td><code>chain.mix</code> is 0. Press <span class="key">I</span>, or wire it</td></tr>
<tr><td>A flat grey wash</td><td>Was a bug in dense sources; the scan processor now compensates automatically. If it returns, lower <code>scan.density</code></td></tr>
<tr><td>Infinite nested windows</td><td>Capturing the screen you are showing the result on. Pick a single window in the share dialog</td></tr>
<tr><td>A block does nothing</td><td>It may not be connected. Check <b>outline</b>: anything you built that is missing from that list is wired to nothing</td></tr>
<tr><td>An operator with no input seems dead</td><td>Not necessarily &mdash; <code>phase from: none</code> with <code>rate: 0</code> is a constant, not a zero. The outline marks these <i>fixed</i></td></tr>
<tr><td>An analysis value is stuck at 0</td><td>Long windows need to refill. A 40 s autocorrelation needs 40 s, and every save or live edit restarts it</td></tr>
<tr><td>Typography does nothing on a capture</td><td>Correct. Pixels have no glyphs. Use <i>read my screen</i></td></tr>
</table>

<h2 class="pb">9 &nbsp; Destinations</h2>
<p>The ${DESTS.length} named sinks an <i>Output</i> node can write to.</p>
<table><tr><th>Destination</th><th>Range</th><th>What it does</th></tr>${dests}</table>

<h2 class="pb">10 &nbsp; Operator reference</h2>
<p class="lede">All ${nOps} operators, generated from the registry.</p>
${ops}

</body></html>`;

fs.writeFileSync(new URL('./manual.html', import.meta.url), html);
console.log('manual.html written —', html.length, 'bytes,', nOps, 'operators,', DESTS.length, 'destinations');
