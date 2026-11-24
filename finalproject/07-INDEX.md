# INDEX — everything built so far

Complete inventory of `~/CSVADFall25/Shashank/finalproject`, verified against disk
on 2026-11-23. 50 files. Every count below was read out of the files themselves,
not remembered.

Five groups:

| # | Group | What it is | Where |
|---|-------|-----------|-------|
| 1 | **Written documents** | Research, reading, proposal | `00-` … `06-` |
| 2 | **Figures** | Block diagram, signal map — and their generators | `figures/` |
| 3 | **Signal Control** | The spreadsheet of every signal, bus, rule, parameter | `08-SIGNAL-CONTROL.xlsx`, `08-signal-control-csv/` |
| 4 | **The running system** | Daemon, Patcher, Visualizer, native window | `m0-telemetry/` |
| 4b | **Shapes & drawn computing** | Scanimate blocks, colourisers, drawing-as-filter | [09-SHAPES-AND-DRAWN-COMPUTING.md](09-SHAPES-AND-DRAWN-COMPUTING.md) |
| 4c | **Reaction-diffusion** | Gray-Scott on the GPU, crossfaded against the scanlines | [10-REACTION-DIFFUSION.md](10-REACTION-DIFFUSION.md) |
| 5b | **Not written in these sessions** | `scanimate-lab/` and `bin/fast-sampler` — see the section at the end | below |
| 6 | **M1 — Psychedelic OS** | A second patcher: per-glyph typography under signal control | [11-PSYCHEDELIC-OS.md](11-PSYCHEDELIC-OS.md), `m1-psyche/` |
| 5 | **Tests & evidence** | What is proven, and by what | `m0-telemetry/patch/test-*.mjs`, `viz/test-render.mjs`, `record/` |

---

## 1. Written documents

Read in this order if you are coming back to it cold: `03` → `05` → `06` → `00`.

| File | Lines | What it holds |
|------|-------|---------------|
| `03-START-HERE.md` | 80 | The one-page entry point. Tonight / this week, the ten decisions and when each one has to happen, and a pointer to every other file. |
| `05-PROPOSAL.md` | 156 | The proposal itself. 8 sections: what it does, current state, figures, signals and processing, prior work, schedule, questions, deliverables. |
| `06-PROPOSAL-SECTIONS.md` | 146 | Three drop-in sections written against your own two-objective framing. **A** references in 6 clusters with ★ on the ones that matter most. **B** the 23-row signals-and-processing table covering every class tool. **C** 12 questions for the instructor, grouped Scope / Method / Evidence / Logistics. |
| `00-RESEARCH-MAP.md` | 584 | The deep map. Layer A = the complete macOS data catalog (A1–A10, ending in "the gap you'll hit"). Layer B = telemetry → drivable control signals, including why naive FFT fails on telemetry. Layer C = generative form. Then the 3D-touch parameter space, OS-vs-visualizer comparison, and the clustered reading list. |
| `01-LINKS.md` | 141 | Every citation in `00` §6 as an actual URL, in 7 clusters plus the Apple API docs. |
| `02-LEARNING-PATH.md` | 257 | Stage 0–8 with time estimates, and a "if you only have six weeks" cut. Marks shaders (Stage 3) and interaction engineering (Stage 5) as the real gaps. |
| `04-FEEDBACK-AND-FORM.md` | 217 | The log-polar retina→cortex map, video feedback as a dynamical system, why *micro* dose is about timing not intensity, and safety as an engineering constraint. |
| `13-PATCHER-MANUAL.pdf` | 19 pages | **The manual.** How the model works, how to navigate every control, all 86 operators with their inputs and parameters, the 37 destinations, five worked recipes and a troubleshooting table. The reference section is generated from the live registry by `manual/build.sh`, so it cannot drift from the software. |
| `12-PATCHER-MAP.md` | 118 | **Start here for the patcher.** The four kinds of block, the one rule, the complete contract of what reaches the renderer, and which source supports what. |
| `11-PSYCHEDELIC-OS.md` | 456 | M1: what macOS actually permits for desktop processing (probed), the prior art for FUI and for folders-as-branches, the 10 typography operators, and what is deliberately deferred. |
| `10-REACTION-DIFFUSION.md` | 174 | Gray-Scott on the GPU: the equations, why float textures and a 9-point Laplacian are required, Pearson's six regimes with measured behaviour, the 9 patch destinations, and the 13 GPU tests — including the two bugs they caught. |
| `09-SHAPES-AND-DRAWN-COMPUTING.md` | 277 | The Scanimate mapping, why signed distance fields, the 34 new operators, and the three lineages of prior art for “art as computing” — including the one rigorous path (physical reservoir computing). Marks which citations are verified and which still need chasing. |
| `m0-telemetry/README.md` | 109 | How to run the daemon, what it collects, the endpoints, why the `kind` field is the important one, and findings measured on your machine rather than assumed. |

## 2. Figures

Each diagram has a **generator script**, so none of them is a drawing — they are
computed layouts with assertions that fail the build if labels collide or lanes
overlap. Re-run the script after any change rather than editing the SVG.

| File | What it shows |
|------|---------------|
| `figures/block-diagram.svg` / `.png` | The full model: telemetry daemon → video feedback → rule-based morphogenesis, 21 blocks in 4 columns with 3 feedback lanes. PNG is 3900×1872. |
| `figures/make-block-diagram.js` | 301 lines. Generates the above. Asserts no label crosses a feedback lane and no two return paths share an x. |
| `figures/signal-map.svg` / `.png` | The patch map: all 43 signals, which are wired (25) and which are still free (18). 1620×1367. |
| `figures/make-signal-map.js` | 146 lines. Reads channel metadata out of `telemetryd.js`, so the map cannot drift from the code. |
| `figures/form-constants.png` | The Klüver form constants, for §1 of `04-FEEDBACK-AND-FORM.md`. |
| `figures/make-formconstants.js` | 131 lines. Generates it. |
| ~~`figures/system-diagram.svg`~~ | **Superseded** by `block-diagram`. Safe to delete. |

Re-render any of them:

```sh
cd figures && node make-block-diagram.js    # prints an assertion report
```

## 3. Signal Control — the spreadsheet

`08-SIGNAL-CONTROL.xlsx`, and the same thing as `08-signal-control-csv/*.csv`
because neither Numbers nor Excel is installed on this machine. **Every column
marked `(edit)` is yours to overwrite** — that is the point of the workbook.

| Sheet | Rows | What each row is |
|-------|-----:|------------------|
| README | 18 | How to use the workbook, and what the colours mean. |
| **SIGNALS** | **43** | One measured channel. Subsystem, where it physically lives, `KIND`, unit, hint range, sample rate, source command, and what it currently drives. |
| **BUSES** | **13** | One directed edge of the machine map: from, to, driving channel, what value saturates it, bow, and what physically rides it. |
| **ACTS** | **7** | What ORDINARY WORLD / THE CALL / ORDEAL actually mean, each as a measured trigger condition, first match wins top down. |
| **SYNTH** | **14** | One video-synthesiser knob: range, what drives it, the exact formula in the code, and the artistic effect. |
| **COMPUTATIONS** | **12** | One real computation: its bus path, its signature in the telemetry, and **how you know it finished**. |
| **ARCHITECTURE** | **14** | The real path a byte takes for "read a file, change it, write it back" — layer, latency, and whether we can see that step at all. |
| **RULES** | **14** | Every rule governing layout, shape and movement, with a provenance column: `MEASURED` / `AUTHORED` / `INVENTED`. |
| **PARAMETERS** | **16** | Every magic number in the renderer, in one place, with where it is defined. |

`KIND` is the load-bearing column. It decides which DSP is legal on a channel:

- **level** (22 channels) — filter, STFT, autocorrelate. Never differentiate.
- **rate** (14) — already a derivative. `log1p` first.
- **event** (5) — convolve to an envelope before any spectral work.
- **state** (2) — edges only.

A copy sits at `~/Desktop/visualizer-signal-control/` from when the in-editor
links would not resolve.

## 4. The running system — `m0-telemetry/`

Four parts. The daemon measures, the Patcher decides what the measurements mean,
the Visualizer draws, the native panel keeps it on screen.

### 4a. Telemetry daemon

| File | Lines | Role |
|------|------:|------|
| `telemetryd.js` | 551 | The whole measurement layer. Spawns `vm_stat 1`, `iostat -w 1`, `nettop`, `ioreg`, `top -l 0`, plus FSEvents via `fs.watch`. Serves `/stream` (SSE), `/patch` (GET+POST), the static pages, and records NDJSON. **43 channels**, each tagged with its `kind`. |
| `src/pressure-probe.swift` | 167 | The only native code M0 needs: `NSEvent.pressure`, the analog 0–1 Force Touch signal, which no CLI tool exposes. Three modes, because macOS will not give it to you globally. |
| `bin/pressure-probe` | — | Compiled binary. |
| `scope.html` | 196 | Raw signal scope. Every channel as a strip chart, no interpretation. Use this to check a signal is real before patching it. |
| `record/*.ndjson` | 1 file | One recorded session, 83 KB, for offline work without the daemon running. |

Root-only sources deliberately **excluded**: `powermetrics`, `fs_usage`, IOReport.
Everything runs unprivileged.

### 4b. The Patcher — your TouchDesigner

| File | Lines | Role |
|------|------:|------|
| `patch.html` | 114 | The page. |
| `patch/editor.js` | 382 | The editor: DOM nodes, SVG wires, pan/zoom by CSS transform, palette by category, scrub-on-label for numbers, live scopes, save / revert / load-default / fit, ⌘S. |
| `patch/graph.js` | 245 | The graph engine. `add / remove / connect / disconnect / compile / eval / toJSON / fromJSON`. Kahn topological sort; cycle nodes are appended so a back-edge reads last frame — that is how feedback gets exactly one frame of delay. Also holds `defaultGraph()`. |
| `patch/ops.js` | 353 | **30 operators** in 9 categories, plus the three tables the editor builds its palette from: 43 channels, 12 bus levels, 26 sinks with ranges. |
| `patch/dsp.js` | 311 | The signal processing, written from scratch: `fft` (radix-2 Cooley–Tukey), `spectrum`, `BandResynth` (STFT→iSTFT, 75% overlap-add, now with an optional per-bin mask), `autocorrPeak`, `xcorrLag`, `makeKernel` + `convolveLatest`, `OnePole`, `Envelope`, `OneEuro`, `Slew`, `PeakHold`, `Pink`, `Ring`, `hann`. |
| `patch/sdf.js` | 339 | **The shape language.** 8 primitives, 9 domain transforms, 6 field operations, and a compiler that turns a spec tree into one nested closure. The only implementation of the shape semantics. |
| `patch/shapeops.js` | 369 | **26 shape operators + 2 colourisers.** Every knob is also a jack, so telemetry can drive any shape parameter. |
| `patch/drawops.js` | 205 | **3 drawing-as-computation operators** (drawn transfer, drawn FIR kernel, drawn spectral mask) **+ 3 generators** (drawn ramp, sample & hold, step sequencer). |
| `patch/opkit.js` | 99 | Shared parameter constructors, drawn-curve helpers, colour helpers. Exists so the operator files can share them without a circular import. |
| `patch/package.json` | — | Declares `patch/*.js` as ES modules so Node can run the tests. |
| `patch.json` | 83 nodes, 66 edges | The saved patch. **This file, not the code, decides what every signal means.** |

The 30 operators:

| Category | Count | Operators |
|----------|------:|-----------|
| Sources | 3 | `channel`, `const`, `time` |
| Math & shaping | 7 | `scale`, `curve`, `norm`, `clamp`, `remap`, `abs`, `invert` |
| Combine | 2 | `math2`, `mix` |
| Filters & envelopes | 5 | `lowpass`, `oneeuro`, `envelope`, `slew`, `peakhold` |
| **Class DSP** | 5 | `autocorr`, `spectrum`, `bandresynth`, `convolve`, `xcorr` |
| **Drawing as computation** | 3 | `draw.transfer`, `draw.kernel`, `draw.mask` |
| Logic | 4 | `threshold`, `gate`, `select`, `compare` |
| Generators | 5 | `lfo`, `pink`, `gen.ramp`, `gen.sh`, `gen.seq` |
| **Shapes (SDF)** | 8 | `sdf.circle`, `sdf.box`, `sdf.ngon`, `sdf.star`, `sdf.ring`, `sdf.seg`, `sdf.arc`, `sdf.curve` |
| **Shape transformers** | 11 | `sh.move`, `sh.rotate`, `sh.scale`, `sh.skew`, `sh.squeeze`, `sh.repeat`, `sh.mirror`, `sh.polar`, `sh.twist`, `sh.round`, `sh.onion` |
| **Shape combine** | 5 | `sh.union`, `sh.sub`, `sh.inter`, `sh.blend`, `sh.morph` |
| **Shape render** | 2 | `sh.fill`, `sh.contour` |
| **Colourisers** | 2 | `col.keyer`, `col.ramp` |
| Utility | 1 | `scope` |
| Output | 1 | `out` |

**64 operators in 15 categories.** See [09-SHAPES-AND-DRAWN-COMPUTING.md](09-SHAPES-AND-DRAWN-COMPUTING.md) for what the 34 new ones do and why.

The 26 sinks it can drive: `scan.amp / persp / key / skew / gainR / rowStep / floor`,
`fb.gain / zoom / rot`, `hero.spawnRate / deathProb`, `particle.speed`,
`type.warp`, and `bus.*` emission level for all 12 live buses.

### 4c. The Visualizer

| File | Lines | Role |
|------|------:|------|
| `viz.html` | 35 | The page. |
| `viz/main.js` | 212 | The loop, and nothing else. It evaluates the graph and applies the result — it makes no mapping decisions of its own. Also re-reads the patch on an SSE `patch` event. |
| `viz/topology.js` | 94 | The machine map: 8 nodes (GPU marked `dead`), 13 buses, faults, `HERO_ROUTE`, and `phaseOf()` — the act thresholds. |
| `viz/source.js` | 116 | Draws the 512×320 source raster: machine map + traffic + structural FUI, as luminance and chroma. |
| `viz/scanproc.js` | 116 | The Rutt/Etra scan processor (1972). `screen_y(x,row) = baseline(row) − luma × amplitude`, per scanline, hard-keyed. `deflectAt()` lets the type ride the same field. |
| `viz/feedback.js` | 71 | Video feedback as an iterated map: ping-pong canvases, affine warp, gain < 1. Bilinear sampling supplies the diffusion. |
| `viz/particles.js` | 134 | Two populations. `flow` is anonymous and many, emission rate = measured throughput. `hero` is one named real thing, followed leg by leg along `HERO_ROUTE`. |
| `viz/fui.js` | 263 | The FUI layer: `structural()` into the raster, `overlay()` crisp but field-displaced. Compact mode for the panel. |
| `viz/shapes.js` | 161 | **Distance field → luminance in the raster.** Scanned shapes go in before the scan processor reads it, so they deflect and feed back like a bus; raw shapes composite crisp over the finished frame. |
| `viz/colorizer.js` | 118 | **The colouriser on the end of the chain.** Legacy (the original 2-colour key), keyer (4 luminance bands with modulatable edges), ramp (4-stop gradient with gamma and hue rotation). Holds two rules: alpha follows luminance, and amber still means contention. |
| `viz/rd.js` | 377 | **Gray-Scott reaction-diffusion on the GPU.** Ping-ponged RGBA32F framebuffers, a 9-point Laplacian, and a display shader driven by the same colouriser stop data as the rest of the chain. Crossfaded against the scan processor by `rd.mix`. |
| `viz/palette.js` | 47 | Every colour in one file. Cyan = ordinary path, amber = contention. |
| `viz/package.json` | — | Declares `viz/*.js` as ES modules so Node can run `test-render.mjs`. |

### 4d. The persistent window

| File | Lines | Role |
|------|------:|------|
| `src/hud-panel.swift` | 347 | A borderless `NSPanel` holding a `WKWebView`. `.nonactivatingPanel` so clicking never steals focus, `.canJoinAllSpaces`, `.fullScreenAuxiliary`, `hidesOnDeactivate = false`, `level = .statusBar`. Click-through by default; **⌃⌥V** makes it interactive, then you can drag it, resize from any edge or corner, and use the visualizer's keys. Frame persists in `UserDefaults`, validated against connected screens. |
| `bin/hud-panel` | — | Compiled binary. |

Flags: `--port --w --h --alpha --corner --full --reset`.

## 5. Tests and evidence

| File | Tests | What it proves |
|------|------:|----------------|
| `patch/test-dsp.mjs` | **18** | FFT round-trip identity to 1.8e-7; autocorrelation recovers a 2.5 s burst-train period at r=0.917 and stays at r=0.107 on white noise; cross-correlation recovers a 1.0 s lag at r=0.984 with the right sign; iSTFT passes 0.2 Hz, rejects 8 Hz at 0.000%, amplitude within 0.2%. |
| `patch/test-shapes.mjs` | **71** | Every primitive's distance is exact where it should be; **unit gradient holds at ≥99.9% of 20,000 random points per shape** (the shortfalls are medial axes, which are legitimate); non-uniform scale never overestimates; booleans, morph and the half-resolution field all behave. |
| `patch/test-drawops.mjs` | **36** | A drawn spike is a **pure delay** (proves tap order); a drawn flat kernel is a boxcar settling at exactly 1.0 with **179.9 dB** between 0.05 Hz and 3 Hz; a drawn spectral mask peaks at its drawn passband and leaks **0.001%**; triggers do not fire spuriously on their first evaluation. |
| `rdtest.html` | **13** | Runs in a browser, not Node: U=1/V=0 is genuinely stable so **nothing grows until the machine seeds it**; the field stays bounded with 0 NaN over 3,600 iterations; **coral grows real angular structure (ring sd 0.1329, a blur would be ~0)**; all six regimes survive sustained seeding; dead chemistry stays transparent (6.7% of frame lit, not 100%). Posts results to `/selftest` so they are readable from a terminal. |
| `viz/test-render.mjs` | **29** | **A field circle comes out round in pixels at ratio 1.0000** (the aspect correction is right end to end); chroma round-trips so the scan processor reads back the warm value asked for; additive blending saturates instead of wrapping; contours land on their rings and nowhere between; 3 shapes composite in **7.0 ms**. |

**296 Node tests + 67 browser tests, all passing** (re-run and confirmed 2026-11-23).

Run them:

```sh
cd m0-telemetry
node patch/test-dsp.mjs && node patch/test-shapes.mjs \
  && node patch/test-drawops.mjs && node viz/test-render.mjs
```

> `patch/package.json` and `viz/package.json` exist only to tell Node that those
> `*.js` files are ES modules. Without them the tests cannot import them.
> `telemetryd.js` one level up stays CommonJS and is unaffected.

Separately measured, not in a test file:

- **The visualizer is not fake.** A directory walk plus two CPU burners moved
  `disk.mb_per_s` 11→138, `disk.tps` 1250→3153, `vm.faults` 11186→22590 — and
  those same channels drive emission rate, bus width, node glow and the CPU ring.
- **The patcher reaches the visualizer.** Changing one `remap` ceiling 116→190
  moved `scan.amp` from 98.00 to 157.20 through save → serve → eval. The same
  round trip was re-verified for shapes: a saved patch came back with
  `shapes=1, colorizer=keyer` and the keyer's first band edge driven to 0.271
  by `cpu.busy_pct=62`.
- **Adding shapes did not change the existing image.** The saved `patch.json`
  loads under the new type-checked `fromJSON` with all 83 nodes and 66 wires
  intact and reports `$color: legacy`, which reproduces the original
  two-colour key exactly.
- **The built-in mic exposes 1 channel**, which rules out multi-mic TDOA.
- **A 0.1–0.3 Hz band needs ≈20 s of window**, so it must run decimated and costs
  ≈20 s of latency. This is the substance of instructor question 5.

## How to run the whole thing

```sh
cd ~/CSVADFall25/Shashank/finalproject/m0-telemetry
node telemetryd.js                      # then:
#   http://localhost:7777/viz.html      the visualizer   (G shapes, R chemistry)
#   http://localhost:7777/patch.html    the patcher      (+ scanimate, + chemistry)
#   http://localhost:7777/rdtest.html   the 13 GPU tests
#   http://localhost:7777/scope.html    raw signals
./bin/hud-panel --port 7777 --corner br # the always-on-top panel
```

Recompile the native tools:

```sh
swiftc -O -o bin/hud-panel      src/hud-panel.swift      -framework AppKit -framework WebKit
swiftc -O -o bin/pressure-probe src/pressure-probe.swift -framework AppKit
```

## Two things on disk that these sessions did not write

Both work. Neither is wired into anything. Flagged because they overlap with,
or materially affect, work that is.

### `scanimate-lab/` — a second, standalone Scanimate

Dated 23 Nov 13:55, before this session's work. A self-contained prototype:
`scanimate_lab.html` (one inlined file) built by `build.py` from `core.js`
(block registry, evaluator, paint-a-program compiler), `dsp.js` (fft, fft2,
spectrogram-painter-to-sound via iSTFT, 2-D mask filter), and `ui.js` (rack,
grey feedback renderer, colouriser LUT, four drawing studios).
**All three test suites pass** (`test_dsp`, `test_core`, `test_paint`).

Its own README says the blocks exist "so they can be merged into the patcher
later" and that it shares the patcher's rules (signals 0..1, dependency order,
cycles read the previous frame). **It substantially overlaps what now exists in
`patch/`** — shapes, drawn masks, colourisers, feedback — so there are
currently two Scanimates. Worth a decision: merge its unique parts (fft2, the
2-D mask filter, the paint-a-program compiler, the drawing studios) into the
patcher and retire it, or keep it as a separate sketch.

### `m0-telemetry/bin/fast-sampler` — an unused measurement that matters

Reads kernel counters directly (`host_processor_info`, `host_statistics64`,
`getifaddrs`) instead of parsing the text output of `iostat`/`vm_stat`/`nettop`.
Run today at 20 Hz for 10 s:

```
source   read cost (mean/max)   changed since last read
CPU      41.3 / 72.1 us         100 %
memory    3.9 /  8.6 us          24 %
network  42.5 / 89.1 us          10 %

  CPU busy peak       73 % at 20 Hz  vs      49 % averaged over 1 s
  page faults peak  852760 /s at 20 Hz  vs  43091 /s over 1 s
  bytes in peak     143360 B/s at 20 Hz  vs  10240 B/s over 1 s
```

**The daemon's 1 Hz sampling is hiding a factor of twenty.** CPU counters
genuinely update at every read at 20 Hz, cost 41 microseconds, and need no
root. This is a direct, measured answer to proposal question 5 ("should I
simply sample faster") and an argument that most of the structure the DSP
chain is looking for is currently being averaged away before it arrives.
Nothing uses it yet.

## Open items

**Decisions waiting on you**

1. Proposal question 1 — whether the navigation objective gets cut.
2. Export and share the LLM conversation logs with the instructor.
3. The 18 unwired signals in `signal-map.png`: wire them, or justify leaving them.
4. The `INVENTED` rows in the RULES sheet — keep, change or cut each one.

**Known rough edges**

- Saving a patch calls `init()` on every node, so **all filter and DSP state
  resets**. A 40 s autocorrelation window needs 40 s to refill. Fixable by
  preserving state for nodes whose type and parameters did not change.
- The patcher evaluates its own copy of the graph, so the numbers on its nodes
  are not the visualizer's numbers — same inputs, separate state.
- `figures/system-diagram.svg` is superseded and still referenced nowhere; delete it.
- **The workbook is out of date.** `08-SIGNAL-CONTROL.xlsx` documents 14 SYNTH
  parameters and 14 RULES rows and knows nothing about the 26 shape sinks or
  the 34 new operators. Regenerating it is the obvious next housekeeping job.
- `sdf.curve` (Drawn profile) and `sh.twist` are not exact distance fields, so
  they are poor inputs to deep hollowing. Marked as such in the source.
- No launchd plist, so the daemon and panel do not start at login.
- The GPU node is `dead: true` — macOS exposes no unprivileged GPU telemetry.
