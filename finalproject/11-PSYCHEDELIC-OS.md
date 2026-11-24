# The Psychedelic OS — M1

A second patcher, for turning a desktop into something else. Typography first.

Written 2026-11-23. Numbers measured on this machine.

---

## 1. What macOS will actually let you do

Probed, not assumed (`m1-desktop/src/probe.swift`):

```
macOS 15.5 · ScreenCaptureKit available
display            2940x1912 px = 5.6 MP/frame = 337 MP/s at 60fps
Screen Recording   not granted (one prompt)
Accessibility      not granted (one prompt)
overlay window     already built (m0-telemetry/bin/hud-panel)
```

**You cannot hook into other applications' rendering.** The private APIs that
once allowed it (`CGSSetWindowFilter`, CoreImage window filters) are gone, and
an Apple engineer states plainly in the developer forums that there are no
public APIs in this area. So "a plugin that makes the desktop psychedelic" is
necessarily:

```
ScreenCaptureKit  ->  GPU processing  ->  click-through full-screen overlay
                                          (excluded from its own capture)
```

Excluding your own overlay is documented: `SCContentFilter` takes an
`excludingApplications:` list, and Apple's WWDC22 session names the reason —
avoiding the hall-of-mirrors feedback loop.

### The constraint that shapes the whole design

**The more you warp, the less you can click.** Clicks pass through the overlay
to the real, undistorted UI underneath, so a heavily displaced image means
aiming at something that is not where you see it.

Which is the same conclusion `04-FEEDBACK-AND-FORM.md` §3 already reached from
the other direction: a micro-dose is about **timing, not intensity**. The
platform constraint and the thesis agree, and the default patch is built at the
readable end because of it.

## 2. Prior art

Nobody has combined these, but every part is documented.

**Desktop-wide processing.** **Compiz/Beryl** (2006–08, Linux) is the real
precedent: a compositing window manager with a *plugin system* — Wobbly
Windows, Desktop Cube, Burn, Water ripple — composable effects over the whole
desktop. And **Quartz Composer**: Apple shipped a node-based visual patcher
from 2005 to about 2014, used for screen savers and iChat effects. Apple built
this patcher and then killed it. Also **ISF (Interactive Shader Format)**,
shaders with named typed inputs, used by VDMX and Millumin — "signals driving
shader parameters" already standardised — and **Syphon** for moving frames
between Mac apps.

**FUI as a field.** **Mark Coleran** coined the term (*Bourne Identity*).
**GMUNK** did TRON: Legacy. **Ash Thorp** (Ghost in the Shell 2017),
**Territory Studio** (Blade Runner 2049, Ex Machina), **Jayse Hansen** (Iron
Man), **Perception** (Marvel). The archive is **HUDS+GUIS**. The one that
matters most here is **John Underkoffler**: he designed Minority Report's
interface and then actually built it as g-speak at Oblong — the only person who
took FUI from film into a working system, which is this project's ambition.

**Letters driven by signals.** The research lineage is **kinetic typography**
(Lee & Forlizzi, Kinetic Typography Engine, CMU, UIST 2002). The enabling
technology is **variable fonts** (OpenType 1.8, 2016): weight, width and slant
as continuous axes.

**Reading the screen semantically.** The mechanism is the **Accessibility API**
— role, text and screen rectangle for every element in every app. Screen
readers are the original semantic model of a screen; **Hammerspoon** scripts
macOS through it. The theory is semantic zoom: Raskin's *Humane Interface*,
Bederson & Hollan's **Pad++**, both already in `00-RESEARCH-MAP` §6a.

**"Folders popping out of a flower on a branch."** This is published, and the
mapping is almost exactly your sentence: **Kleiberg, van de Wetering & van Wijk,
"Botanical Visualization of Huge Hierarchies," IEEE InfoVis 2001** — directories
are stems, subdirectories are **branches**, sets of files are **fruits**, grown
with Holton's strand model and sized by file size. Related: **BumpTop**
(Agarawala & Balakrishnan, physics desktop, acquired by Google), **Cone Trees**
and the **Hyperbolic Browser** (both Xerox PARC), **Beamtrees** (van Ham & van
Wijk). The growth algorithm to use is **space colonization** (Runions 2007),
already objective 2.1 of the proposal.

## 3. What is built

A second patcher at `/m1/psyche.html`, sharing the engine with the first.

**Shared:** `graph.js`, `ops.js`, `opkit.js`, the editor, the operator
registry, the telemetry stream. **Separate:** the operator palette, the saved
patch (`psyche.json`), and the renderer. An operator built for one patcher is
available in the other, and the editor cannot drift between them — it was
parameterised rather than copied.

### Ten typography operators

| Operator | What it does |
|---|---|
| **Wave** | the bouncy one — a sinusoid displacing each glyph, sine/triangle/square/bounce |
| **Jitter** | per-glyph noise, seeded from glyph identity so scattered text *stays* scattered |
| **Rotate glyphs** | alternate / uniform / ramp / phase |
| **Scale glyphs** | per-glyph size, on either axis |
| **Weight / width / slant** | the variable-font axes |
| **Tracking / leading** | letter and line spacing; can grow along a word or page |
| **Drawn baseline** | a curve you draw becomes the shape of the line |
| **Scatter** | push glyphs away from their word, line, or a point, with swirl |
| **Glyph colour** | per-glyph hue and alpha |
| **Cascade delay** | makes an effect *arrive* along the text instead of happening at once |

### The one idea worth understanding

Every modulator reads **one coordinate** off each glyph and uses it as the
phase of its effect. That single control turns one operator into a dozen:

```
index   position within the word   -> a wave travels along each word
char    position in the whole run  -> one wave crosses all the text
word    which word it belongs to   -> words bounce as units, in sequence
line    which line it sits on      -> the effect ripples down the page
x / y   where it is on screen      -> a wave sweeps across the display
rand    a stable per-glyph hash    -> every letter does its own thing
```

### Two design decisions worth knowing

**Modulators apply top to bottom** by where their nodes sit on the canvas, like
a layer stack. Order matters — a Cascade only delays what comes *after* it —
and evaluation order would have been effectively arbitrary for nodes with no
wires between them. Drag a node up or down to change when it runs.

**A mock desktop, not a screen capture, for now.** Designing typographic
effects against a live screen is miserable: the content changes under you, so
you cannot tell whether the image changed because of your edit or because the
desktop did. `scene.js` generates the same desktop every run — menu bar, two
windows, a folder grid, paragraphs — which makes effects reproducible and
testable. It is also the exact structure the Accessibility API returns, so
swapping in live capture replaces `mockDesktop()` and changes nothing below it.

## 3a2. Layout & orientation — the desktop's furniture

Typography moves letters; these move the things letters sit on. The desktop is
now **14 surfaces**: 2 windows, 11 folder icons, 1 menu bar. A surface is a
rectangle with a pivot at its centre, and transforming one **carries its
contents** — rotating a window rotates its title and its paragraphs, and the
typography stack then runs inside that rotated space.

Icons are their own surfaces rather than children of their window. That is the
more useful choice here: it lets folders leave the window they live in.

| Operator | What it does |
|---|---|
| **Move surfaces** | a wave displacing whole windows and icons |
| **Rotate surfaces** | each turns about its own centre |
| **Scale surfaces** | per-axis, about the centre |
| **Tilt / shear** | reads as perspective without needing any |
| **Spiral** | rotates each surface's *position* about a point, proportional to distance — the desktop winds up |
| **Grid to ring** | lerps every surface from where it belongs onto a circle. At 0 nothing, at 1 a dial, and real arrangements between |
| **Drift** | seeded per-surface noise, stable unless given a rate |
| **Gravity** | collapse the desktop into a pile, or explode it |

Same stack model as typography — phase from `index` / `x` / `y` / `rand`,
targets `all` / `window` / `icon` / `bar`, applied top-to-bottom by node
position. Learned once, used twice.

Precedent: Compiz's Wobbly Windows (2006) is the same idea — a compositing
layer transforming whole windows as physical objects. The difference is that
these are driven by measured signals rather than by the mouse.

Cost: **6.4 microseconds** per frame for 14 surfaces through a 5-deep stack.

## 3a3. Botanical folders — your filesystem as a tree

Kleiberg, van de Wetering & van Wijk, *Botanical Visualization of Huge
Hierarchies* (IEEE InfoVis 2001): **directories are stems, subdirectories are
branches, sets of files are fruit.** Switch the view's source to *my folders
as a tree*.

**The strand model is the part worth getting right.** Each file contributes
one "strand"; a branch carries every strand in its subtree; thickness goes as
the **square root** of the strand count. That is da Vinci's rule — the
children's cross-sections sum to the parent's — and it is why a real tree's
trunk looks proportionate instead of like a wall. Verified: a folder with 32
files against one with 2 gives a thickness ratio of **4.000**, where √(32/2) = 4.

Three operators, every number a jack:

| Operator | Controls |
|---|---|
| **Tree shape** | spread, first length, falloff, thickness, upward bias (phototropism), twist, max depth |
| **Growth** | 0 is a bare root, 1 the whole tree — levels appear in order and the frontier extends partway, so it *grows* rather than blinks |
| **Fruit / flowers** | size, petals, bloom, cluster spread. Petals ≥ 3 turns each berry into a flower |

The data comes from a new read-only `/tree` endpoint: names and sizes only,
depth- and count-limited, and **confined to the directories the daemon already
watches for FSEvents** — so it exposes nothing the telemetry did not already
see and needs no new permission. `/tree?path=/etc` returns 403.

It returns the same scene shape as the mock desktop — chrome, blocks,
surfaces — so **everything downstream works unchanged**: folder names become
glyphs the typography operators can wave, the tree is one `window` surface the
layout operators can tilt, each labelled folder is an `icon` surface that can
drift or ring, and the whole thing goes through the image chain.

Measured on a real `~/Documents`: 58 branches, 137 fruit, 118 label glyphs,
**0.43 ms per frame including a full rebuild**.

## 3a4. Semantic analysis — what the text is, and how it got there

The last item, and the one that needed native code. `getDisplayMedia` gives
pixels; the **Accessibility API** gives structure — the role, text and screen
rectangle of every element in every running application. It is the only route
to per-glyph typography on a real desktop, and a browser cannot reach it.

`m1-desktop/src/ax-reader.swift` walks the tree and emits JSON; the daemon
serves it at `/ax`, cached, because each attribute read is an IPC round trip
to the owning app. Nothing is written, clicked or typed: it reads exactly what
VoiceOver reads.

### How it got there

Every element carries its own path down the hierarchy:

```
Finder > AXWindow > AXSplitGroup > AXScrollArea > AXStaticText
```

That is literally the provenance of a piece of text on screen — which
application put it there, inside which window, nested in what, and how deep.
**Depth is a signal.**

### What it is

Measures computed from the text, no model and no network: length, word count,
**Shannon entropy**, digit / punctuation / capital share, type-token ratio,
and a class — `path`, `url`, `number`, `date`, `time`, `size`, `identifier`,
`sentence`, `word`, `symbol`.

Deliberately *not* here: sentiment, topic, meaning. Those need a model, they
would be wrong often enough to matter, and none is needed for the typography
to respond to what it is rendering.

### The part that makes it useful

**Semantic measures became phase sources.** `entropy`, `depth`, `digits`,
`caps`, `ttr` and `words` now sit alongside `index`, `word`, `line` and `x` in
every typography operator. So:

> *"letters jitter in proportion to the entropy of their sentence"*

is one operator with its phase source set to `entropy` — not a special case in
the renderer. Measured: a run of `aaaaaaaa` (0 bits) sits at phase zero while
`~/notes/final.md` (3.75 bits) displaces by 5.7 px.

**And semantic classes became targets.** A target now matches either the
element's role kind (`menu`, `title`, `body`…) *or* its semantic class, so
"style every path on screen, wherever it is" and "style all the filenames" are
the same kind of control. Verified: `target: path` moved 15 glyphs, every one
of them classified `path`.

The snapshot converts to the same scene shape as the mock desktop and the
botanical tree, so **typography and layout both apply to your real screen** —
one surface per app-and-window, so the layout operators move actual windows.

### Permission

Accessibility, granted once in System Settings → Privacy & Security →
Accessibility, for `m1-desktop/bin/ax-reader`. Until then `/ax` returns a
readable explanation and the view says so rather than failing blank.

## 3b. The image chain

The Psychedelic view now runs the Computing Visualizer's entire image pipeline,
pointed at a desktop instead of a machine map. None of it is new code — the
scan processor, Gray-Scott chemistry, feedback loop, colourisers and SDF shapes
were already built and tested. Two of them had to stop assuming a 512x320
raster, which is the only change they needed.

```
desktop (chrome + glyphs) -> raster 1024x640
       + SDF shapes written in as luminance
              |
   SCAN PROC  ...and/or...  REACTION-DIFFUSION   (crossfaded by rd.mix)
              |
   FEEDBACK   iterated affine warp at gain < 1
              |
   COLOURISER luminance bands or a gradient ramp
              |
            SCREEN
```

**`chain.mix` is the master dose.** It crossfades the whole pipeline against
the crisp desktop — and the dry side is drawn *directly*, never through the
raster, so at mix 0 the text is exactly as sharp as if none of this existed.
Verified: **0 pixels differ.** The usable desktop is one end of a continuous
knob rather than a separate mode, which is the micro-dosing thesis made
operable.

Cost, measured: **5.1 ms per frame (196 fps)** at a 1024x640 raster into a
1280x800 output, with chemistry running. The raster is 1.6 aspect to match
`sdf.ASPECT`, so shapes land un-stretched.

## 3c. Live screen capture

`getDisplayMedia` puts the real desktop into a `<video>`, which draws into a
canvas like any other image. **No native code.** The ScreenCaptureKit bridge I
expected to need is not required for the pixel path — confirmed working in
Safari 18.5 by `/m1/captest.html`, which is why §1's "days of Swift" estimate
was wrong.

The view has a source switch: **mock desktop** or **capture my screen**. It is
a button and not a key because `getDisplayMedia` requires a real user gesture.

**What capture can and cannot drive:**

| | mock desktop | captured screen |
|---|---|---|
| image chain — deflection, chemistry, feedback, colour | yes | **yes** |
| typography — per-glyph waves, scatter, axes | yes | **no** |

A captured screen is pixels. It has no glyphs, no words, no lines, so a
per-glyph modulator has nothing to address — the view says `typography inert`
when live. Recovering that structure means the Accessibility API, which a
browser cannot reach. **That is the real boundary in this project: the browser
can process pixels, and only native code can process structure.**

**On feedback.** Capturing the display you are also showing the result on is a
hall of mirrors. For most software that is a bug to design around; here it is
the video feedback loop of objective 1.a arriving for free. Pick a single
window in the share dialog to avoid it, or the whole screen to get it on
purpose.

## 4. Verified

**142 Node tests** (`m1-psyche/test-text.mjs`) and **54 browser tests**
(`/m1/rendertest.html`, `/m1/chaintest.html`, `/m1/smoke.html`, `/m1/captest.html`).
`smoke.html` imports every module the view and patcher load, so a broken import
path fails with a readable message instead of a blank page.

| | |
|---|---|
| A wave gives every glyph of an 11-letter word its own offset, and restarts at each word boundary | the phase model works |
| Jitter is identical at t=0 and t=7.3 with rate 0 | scattered text does not boil |
| `from: none` + `rate: 0` is a **constant, not zero** | the trap that would make an operator silently do nothing |
| A drawn hump raises the middle of a line by 19.95 px and drops the ends | the drawing really is the baseline |
| A modulator targeted at filenames leaves body text and the menu bar at exactly 0 | targeting works |
| 403 glyphs through an 8-deep stack | **0.264 ms/frame** |
| A wave modulator moves **22,351 pixels** versus the un-modulated frame | the maths reaches the screen |
| Targeting one kind touches 5,026 pixels instead of 22,351 | and targeting reaches it too |
| Full desktop, 6-deep stack | **2.70 ms/frame — 370 fps of headroom** |
| Grid-to-ring puts all 11 icons on one circle, evenly spaced | radii 306.0..306.0, equal angular gaps |
| ...and is a genuine lerp at 0.5, not a snap | verified against the full transform |
| Spiral preserves distance from the centre when pull is 0 | and moves far surfaces more than near ones |
| **A rotated window carries its own text** | 10,174 changed pixels inside the window box — chrome *and* glyphs |
| Targeting icons vs windows, measured in icon regions | 4,511 vs 218 changed pixels |
| 6 typography + 5 layout modulators over the whole desktop | **2.85 ms/frame (351 fps)** |
| **Strand model: 16x the files gives 4x the thickness** | ratio 4.000 against √(32/2) = 4 |
| The tree renders from a real `~/Documents` | 58 branches, 137 fruit, 118 label glyphs |
| Growth is monotone and continuous | 0 → 0 lit pixels, 0.5 → 18,773, 1 → 61,560 |
| Rebuilding and drawing the whole tree every frame | **0.43 ms** |
| Entropy is exact | `aaaaaaaa` = 0 bits, `abababab` = 1.000000, `abcdabcd` = 2 |
| All 14 text classes identified correctly | path, url, number, date, time, size, identifier, sentence, word, symbol |
| **Entropy as a phase source** | 0 bits → 0 px, 3.75 bits → 5.7 px displacement |
| **Semantic targeting** | `target: path` moved 15 glyphs, all of them paths |
| Screen coordinates scale to the canvas | x 300 of 2940 → 149.9 of 1440 |
| Provenance survives into the scene | `Finder>AXWindow>AXStaticText`, depth 5 |
| The image chain paints, and does not resemble the dry desktop | 368,743 of 1,024,000 pixels differ |
| **At `chain.mix` 0 the desktop is pixel-identical to never running the chain** | **0 pixels differ** |
| Chemistry on a desktop differs from deflection alone | 768,277 pixels differ |
| Full chain, fully wet, with chemistry | **5.1 ms/frame (196 fps)** |

### Three bugs the tests caught

- **The modulator stack had no defined order.** Cascade is only meaningful if
  it runs before what it delays, and the topological sort put it wherever.
  Now ordered by node position.
- **Every m1 module 404'd in the browser** while passing in Node. A module
  importing `../m0-telemetry/patch/graph.js` resolves against the filesystem in
  Node and against the URL in the browser, and the two disagreed. Fixed with a
  `/m0-telemetry/` URL alias so both resolve the same way.
- **The daemon was bound to every network interface.** `listen(PORT)` with no
  host offers your CPU, disk, network and the paths of files you open to anyone
  on the same wifi. Now bound to `127.0.0.1`. This was pre-existing, not new.

## 5. Running it

```sh
cd m0-telemetry && node telemetryd.js
#   http://localhost:7777/m1/psyche.html     the Psychedelic OS patcher
#   http://localhost:7777/m1/view.html       the view
#   http://localhost:7777/m1/rendertest.html the 9 browser tests
#   http://localhost:7777/patch.html         the Computing Visualizer patcher
```

In the patcher: **`preview`** docks a live view, and **`+ kinetic type`**,
**`+ image chain`**, **`+ layout`** and **`+ botanical`** add worked patches. In the view: **`B`** bypasses every
typography modulator and **`I`** forces the image chain fully wet — the two
fast ways to see what something is actually contributing.

## 6. Deferred, deliberately

Scoped to typography for the first version. Not built:

- ~~Live screen capture~~ — **built**, see §3c. What remains is the system
  *overlay*: this renders in a browser window, not over every other app. The
  overlay window itself already exists (`bin/hud-panel`), but hosting a
  capturing page inside a `WKWebView` is a separate problem.
- **Semantic analysis** — reading the text of real apps through the
  Accessibility API and asking how it got there. The probe confirms the API is
  reachable; nothing is built on it.
- ~~Layout and orientation operators~~ — **built**, see §3a2.
- ~~Botanical folders~~ — **built**, see §3a3.
- ~~Semantic analysis and the Accessibility path~~ — **built**, see §3a4.

- ~~The image chain~~ — **built**, see §3b.

## 7. Files

| File | Lines | What |
|---|--:|---|
| `m1-desktop/src/ax-reader.swift` | 172 | The Accessibility walker: role, text, rect, path |
| `m1-psyche/semantic.js` | 159 | Entropy, classification, provenance, and the screen-to-scene conversion |
| `m1-psyche/botanical.js` | 147 | The strand-model tree layout |
| `m0-telemetry/patch/botops.js` | 73 | The 3 botanical operators |
| `m0-telemetry/patch/layoutops.js` | 153 | The 8 layout & orientation operators |
| `m0-telemetry/patch/textops.js` | 212 | The 10 typography operators |
| `m1-psyche/modulate.js` | 188 | Per-glyph modulator maths. Pure — no DOM, no canvas, no state |
| `m1-psyche/scene.js` | 159 | The mock desktop and the per-glyph layout pass |
| `m1-psyche/render.js` | 152 | Chrome and glyph drawing, with synthesised weight/width/slant |
| `m1-psyche/main.js` | 162 | The view loop |
| `m1-psyche/defaults.js` | 68 | The starting patch, deliberately gentle |
| `m1-psyche/demos.js` | 63 | The `+ kinetic type` worked example |
| `m1-psyche/capture.js` | 103 | `getDisplayMedia` as a source, letterboxed, with clean teardown |
| `m1-psyche/chain.js` | 142 | The image pipeline pointed at a desktop, with the dry/wet crossfade |
| `m1-psyche/boot-psyche.js` | 26 | Which palette, which patch file, which preview |
| `m1-desktop/src/probe.swift` | 102 | The capability probe |

Also modified for this: `viz/scanproc.js` and `viz/shapes.js` now take their
raster size from what they are handed instead of assuming 512x320, so both
visualizers share them; `patch/ops.js` gained `chain.mix`.

Modified: `patch/editor.js` (parameterised, exports `boot()`),
`patch/ops.js`, `patch/graph.js` (`$text`, node position, stack ordering),
`telemetryd.js` (`/m1/` root, `/m1/patch`, `/m0-telemetry/` alias, loopback bind),
`patch.html` (now boots through `boot-telemetry.js`).

> **Canvas2D cannot set OpenType variation axes.** `ctx.font` takes a CSS font
> shorthand and `font-variation-settings` is not part of it, so weight, width
> and slant are synthesised — weight by stroking the outline over the fill,
> width by scaling, slant by a shear. Continuous, cheap, and it reads correctly,
> but it is not true axis interpolation. The honest version renders text through
> the DOM or a signed-distance-field atlas, and it would not change the patch.
