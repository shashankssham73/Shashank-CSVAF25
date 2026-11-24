# Reaction-diffusion

Gray-Scott on the GPU, crossfaded against the Rutt/Etra scan processor.

Written 2026-11-23. Every number below is measured by `m0-telemetry/rdtest.html`
running on this machine, not quoted from a paper.

---

## 1. What it is

Two notional chemicals on a grid. U is fed in everywhere at rate **F**; V eats U
and converts it into more V; V is removed at rate **F + k**. Both diffuse, V at
about half the rate of U:

```
dU/dt = Du·∇²U − U·V²  +  F·(1 − U)
dV/dt = Dv·∇²V + U·V²  −  (F + k)·V
```

That diffusion asymmetry is the whole trick. It is Turing's 1952 morphogenesis
instability, and it is why a perfectly uniform field spontaneously grows spots,
stripes and branches — structure out of nothing but two rates.

This was **already the plan**, specified in your own notes long before this
session:

- `00-RESEARCH-MAP.md:312` — "Reaction–diffusion (Gray–Scott) | spots, stripes,
  Turing patterns | GPU-cheap | **feed rate F / kill rate k ← telemetry**"
- `02-LEARNING-PATH.md:146` — "implement Gray–Scott as a shader"
- `01-LINKS.md:59` — Karl Sims, *Reaction-Diffusion Tutorial*
- `05-PROPOSAL.md:88` — blur as the diffusion term, nonlinearity as the reaction term

## 2. Three decisions

**It crossfades, it does not replace.** `rd.mix` is a patch destination like any
other. At 0 the image is exactly what it was before this existed; at 1 the scan
processor is silent and only the chemistry shows. Anything between is both. So
the machine can dissolve its own scanlines into chemistry as it gets busy —
which is what the demo patch does.

**Travellers seed it.** The chemistry is seeded by the finished source raster:
machine map, shapes, and every particle. A traveller moving along a bus injects
V where it passes, so throughput becomes something that makes patterns *grow*
rather than a dot sliding along a line. An idle bus injects nothing and its
patterns starve. One dose per frame — the injection runs on the first iteration
only, so a frame of traffic is a frame of chemistry.

**Coral is the default.** F = 0.0545, k = 0.0620: branching filaments that creep
outward from a seed and stop when they meet themselves. It reads as something
*building*, which is what a computation doing work should look like.

## 3. Why the GPU

16 iterations a frame over 163,840 cells is 2.6 million cell updates per frame,
about 160 million a second. Hopeless in JavaScript; nothing for a fragment
shader. The state lives in an **RGBA32F** texture and never comes back to the
CPU — the output canvas composites straight into the chain with `drawImage`,
GPU to GPU.

Two details that matter:

- **Float state is required.** 8-bit quantises the concentrations so coarsely
  that patterns freeze instead of growing. The code takes `RGBA32F`, falls back
  to `RGBA16F`, and disables itself with a readable reason if neither exists.
  Measured here: `RGBA32F | WebKit WebGL`.
- **A 9-point Laplacian, not 5-point.** The diagonal weights (0.05) matter. With
  a 5-point stencil the patterns grow along the grid axes and look pixelated.

## 4. Verified on the GPU

`rdtest.html` posts its results to the daemon so they can be read from a
terminal. **13 of 13 pass.** The ones worth quoting:

| Test | Result |
|---|---|
| U = 1, V = 0 is genuinely stable | unseeded field stays at V max 0.0 — **nothing grows until the machine seeds it** |
| Field stays bounded over 3,600 iterations | V 0.0000..0.4188, U 0.295..1.000, **0 NaN** |
| Coral grows real structure, not a blur | ring standard deviation **0.1329** (a diffusing blob would be ~0) |
| All six regimes alive under sustained seeding | coral 0.042 · mitosis 0.006 · worms 0.007 · solitons 0.006 · waves 0.005 · uskate 0.102 |
| The regime set spans distinct families | widest pair (waves/uskate) differs by **182%** of its own magnitude |
| Dead chemistry stays transparent | **6.7%** of the frame lit, not 100% |

### Two things the tests caught

**The decay default was wrong.** `rd.decay` compounds *per iteration*, so 0.004
at 16 iterations a frame starved every pattern in under a second. Gray-Scott
already removes V at rate F + k; extra decay is rarely wanted. **Default is now
0**, and the parameter is labelled as per-iteration.

**The colouriser was washing the whole frame.** Every colouriser mode has a
~0.1 alpha floor so faint parts stay faintly visible. The scan processor never
hits it on empty ground because it skips segments below `scan.floor` — but the
RD shader runs on *every* pixel, so dead chemistry tinted the entire image. Now
there is a coverage floor (`rd.floor`) and sub-threshold pixels `discard`.
Measured: 40,960 lit pixels → 2,728.

### Two honest limits

- **Mitosis and solitons look alike.** They differ by only 6% structurally —
  F = 0.0367/0.0300, k = 0.0649/0.0620, both spot-forming. The big visual jumps
  are coral ↔ spots ↔ uskate, not between neighbours.
- **Mitosis and waves die on a single dose.** They need sustained seeding to
  persist. Under real traffic that is the normal condition, but if the machine
  goes idle those two regimes vanish while coral, worms, solitons and uskate
  keep going.

## 5. The nine destinations

All are ordinary patch sinks, drivable from any of the 43 channels:

| Destination | Range | What it does |
|---|---|---|
| `rd.mix` | 0 – 1 | **scanlines ↔ chemistry.** 0 is the old image exactly |
| `rd.feed` | 0.005 – 0.09 | F. With k, decides which organism grows |
| `rd.kill` | 0.03 – 0.075 | k |
| `rd.inject` | 0 – 3 | how hard traffic seeds the reaction |
| `rd.iters` | 0 – 40 | simulation steps per frame |
| `rd.decay` | 0 – 0.01 | extra starvation, **per iteration** — usually leave at 0 |
| `rd.gain` | 0 – 6 | output brightness |
| `rd.floor` | 0 – 0.4 | below this the chemistry is invisible |
| `rd.diffV` | 0.1 – 1.0 | V's diffusion rate. **This asymmetry is what makes patterns at all** — set it to 1.0 and they disappear |

Plus one operator, **`rd.regime`** (palette → Reaction-diffusion): two named
regimes and a `blend` input, outputting F and k. The space between two named
points is continuous and mostly interesting, which is why it has an input and
is not a dropdown.

Pearson's regimes, as implemented:

| Name | F | k | Character |
|---|---|---|---|
| coral | 0.0545 | 0.0620 | branching filaments creeping outward |
| mitosis | 0.0367 | 0.0649 | blobs that grow and split, then split again |
| worms | 0.0580 | 0.0650 | winding channels filling space into a maze |
| solitons | 0.0300 | 0.0620 | discrete spots that hold shape and bounce |
| waves | 0.0140 | 0.0540 | travelling wavefronts |
| uskate | 0.0620 | 0.0609 | gliders that crawl and collide |

> `uskate` is the one worth knowing about for the proposal: its gliders collide
> and interact, which is the substrate Adamatzky calls **collision-based
> computing**. See §4 of `09-SHAPES-AND-DRAWN-COMPUTING.md`.

## 6. Running it

```sh
cd m0-telemetry && node telemetryd.js
```

- **`+ chemistry`** in the patcher wires the demo: `cpu.busy_pct` → `rd.mix`
  (chemistry fades in as the machine works), `cpu.busy_pct` → regime blend
  (coral when calm, toward mitosis under load), `disk.tps` → `rd.inject`.
  Measured: at 70% CPU `rd.mix` = 0.93 and F has walked to 0.0420; at idle
  `rd.mix` = 0 and F is back to coral's 0.0540.
- **`R`** in the visualizer toggles the chemistry on by hand, for when there is
  no `rd.mix` in the patch yet. **Shift-R** wipes the field back to U=1, V=0.
- **`/rdtest.html`** re-runs the 13 GPU tests and prints them in the page.
  It also posts to `/selftest`, which appends one JSON line to
  `m0-telemetry/selftest.log` so the results can be read from a terminal.

The status line in the visualizer shows `RD 93% · 16 iter` when it is running,
or `RD OFF: <reason>` if the GPU path failed to start.

## 7. Files

| File | Lines | What |
|---|--:|---|
| `viz/rd.js` | 377 | The simulator. Two GLSL programs (Gray-Scott update, display), ping-ponged float framebuffers, the regime table. The display shader reads the **same** colouriser stop data `viz/colorizer.js` uses, passed as uniforms, so the two cannot describe different palettes. |
| `rdtest.html` | — | 13 GPU tests, unrunnable in Node |

Modified: `viz/main.js` (the crossfade), `viz/fui.js` (stage readout),
`viz/colorizer.js` (exposes the two hues to the shader), `patch/ops.js`
(9 destinations), `patch/drawops.js` (`rd.regime`), `patch/graph.js` (`rdDemo`),
`patch.html` + `patch/editor.js` (the button), `telemetryd.js` (`/selftest`).
