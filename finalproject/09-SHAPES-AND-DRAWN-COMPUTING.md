# Shapes, the colouriser, and drawing as computation

Two additions to the patcher, and the prior art for the second one.

Written 2026-11-23. Everything in the "what exists" sections is running code with
tests; the prior-art section marks what was verified against a source this
session and what is from memory and still needs a citation chased.

---

## 1. Scanimate, and why it maps onto what you already had

Lee Harrison III's Scanimate (Computer Image Corporation, 1969) is the right
reference for this, and the useful discovery is that **your existing chain is
already its architecture**:

| Scanimate (1969) | Your system |
|---|---|
| High-contrast artwork shot by a ~945-line monochrome camera | `viz/source.js` — the 512×320 luminance raster |
| Deflection signals passed through an analogue computer so the operator *bends* the image | `viz/scanproc.js` — Rutt/Etra vertical deflection |
| Output **always monochrome** | same: the raster carries luma and chroma, not colour |
| A **colouriser** that "takes certain shades of grey and turns it into color as well as transparency" | was a 2-colour warm/cool key; now `viz/colorizer.js` |
| Layers accumulated by re-recording pass over pass between two VTRs | `viz/feedback.js` — the ping-pong loop |

So nothing architectural was missing. Three *things* were:

1. **artwork to put in** → 8 shape primitives + 11 transformers + 5 combiners
2. **a real colouriser** → luminance keyer and gradient ramp
3. **motion generators** → drawn ramp, sample & hold, step sequencer

> **Sourcing caveat.** The claims in that table come from Wikipedia, whose own
> banner says its sourcing is unclear. The two authoritative sources were
> unreachable on 2026-11-23: the Ohio State *Critical History of Computer
> Graphics and Animation* chapter 12 returned HTTP 403, and `scanimate.com`
> (which hosts Dave Sieg's SIGGRAPH 98 article "Scanimation in the Analog
> Days") refused the connection. **The patch-panel module names and whether the
> machine was cord-patchable are still unknown.** Worth retrying before you cite
> any of this.

## 2. Why signed distance fields

A shape here is not a path and not a bitmap. It is a function returning the
distance to the nearest edge — negative inside, zero on the edge, positive
outside. That single choice is what makes shapes *patchable*:

```
booleans are arithmetic     union = min(a,b)   subtract = max(a,-b)
blending is continuous      a smooth-min whose radius is a modulation target
contours are free           slice the same field at d = 0, 0.05, 0.10, 0.15
morphing is a lerp          mix two fields and the shape tweens between them
nothing ever pops           every parameter is continuous, so every parameter
                            is a legal destination for a telemetry channel
```

The last line is the real reason. A path-based shape has almost nothing you can
safely modulate: change a polygon's vertex count and it jumps. In a distance
field, `sides`, `blend radius` and `morph t` are all continuous, so a channel
can drive them without the image snapping.

**Verified property.** A real distance field has unit gradient almost
everywhere, and that is what makes contours and hollowing behave rather than
tear. `patch/test-shapes.mjs` measures it over 20,000 random points per shape:

```
circle 100.00%   hexagon 99.98%   pentagon 99.98%   star 99.98%
box     99.98%   ring    99.96%   capsule  99.96%   arc   100.00%
union  100.00%   subtract 99.95%  onion    99.91%   polar×5 99.92%
```

The shortfalls are all on **medial axes** — the interior skeleton where the
nearest-edge choice flips, which a box, ring and capsule legitimately have. Not
a defect; the correct measurement is the fraction, not the maximum.

Non-uniform scale is deliberately *not* a true distance field (an ellipse has
no closed-form distance). It is guaranteed only never to *overestimate*, which
is the property contours depend on — also tested.

## 3. What was added

**34 new operators**, taking the patcher from 30 to 64.

| Group | Count | Operators |
|---|--:|---|
| **Shapes (SDF)** | 8 | Circle, Box, N-gon, Star, Ring, Segment, Arc, **Drawn profile** |
| **Shape transformers** | 11 | Move, Rotate, Scale, Skew, **Squeeze**, Repeat, Mirror, Polar array, Twist, Inflate, Hollow |
| **Shape combine** | 5 | Union, Subtract, Intersect, **Blend** (smooth-min), **Morph** |
| **Shape render** | 2 | Fill, **Contour** (concentric rings from one field) |
| **Colourisers** | 2 | **Luma keyer** (4 bands, modulatable edges), Gradient ramp |
| **Drawing as computation** | 3 | **Drawn transfer**, **Drawn kernel (FIR)**, **Drawn spectral mask** |
| **Generators** | 3 | **Drawn ramp**, Sample & hold, Step sequencer |

Three design decisions worth knowing:

- **Every knob is also a jack.** A shape's radius, a blend's fillet radius, a
  colour band's edge — all are inputs with parameter fallbacks, so any of the
  43 telemetry channels can drive any of them. That is the entire point of
  rebuilding Scanimate rather than drawing shapes in code.
- **Position is a parameter; motion is a chain.** Primitives place themselves
  with static x/y and movement comes from `Move`/`Rotate`, so a moving shape is
  a patch and not a special case.
- **Shapes enter the raster, not the screen.** A `scanned` shape is written in
  as luminance *before* the scan processor reads it, so it is deflected,
  colourised and fed back exactly like a bus is. A `raw` shape composites crisp
  over the finished frame instead. The switch is per shape.

### Colour keeps its meaning

`viz/colorizer.js` holds two rules on purpose:

1. **Alpha follows luminance.** A band's alpha *scales* a luminance-derived
   opacity instead of replacing it, so faint parts of the image stay faint.
2. **Amber still means contention.** In every mode the chroma channel pulls the
   result toward the warning colour. Colour is never decorative in this project
   — if something is amber, something is wrong — and that had to survive you
   repainting the whole palette.

With no colouriser node in the patch it runs in `legacy` mode, reproducing the
original two-colour key exactly. **Your saved `patch.json` renders identically
to before** — verified: 83 nodes, 66 wires, nothing dropped, `$color: legacy`.

---

## 4. Drawing as computation — what is real and what is a metaphor

You asked whether anything like "art as a new type of computing" exists. It
does, in **three lineages that make genuinely different claims.** Keeping them
apart matters, because one of them is a metaphor and one is a measurement.

### ① Drawing as the program — the picture is source code

*Verified this session:* Toby Schachman's **Recursive Drawing** (2012, NYU ITP
thesis) reimplements the textual language Context Free as direct manipulation,
so you work with the program's graphical output in real time rather than through
a compiler. His **Apparatus** (2015, with Joshua Horowitz) crosses a vector
editor with a dataflow spreadsheet, replaces loops with "spreads" where a value
can be in superposition, and holds relationships consistent with a numerical
solver. **Cuttle** is its stated successor. **Dynamicland/Realtalk** makes
programs physical objects, where arranging them in space is itself programming;
one documented example picks ink colour off sticky notes with a laser pointer.
**Paper Programs** is a smaller browser recreation of the camera-and-projector
idea.

*From memory, citation not yet chased:* Sutherland's **Sketchpad** (1963) began
it — draw, assert constraints, let the solver compute. **Rocky's Boots** (1982)
had children wiring logic gates by hand. Schachman's **Shadershop** builds
mathematical functions by dragging them. Bret Victor's **Drawing Dynamic
Visualizations** (2013) is the closest single thing to your description: draw a
picture, bind its properties to data, and the drawing *is* the program.

### ② Computing in a medium — the picture is the computer

*From memory, citations not yet chased.* Andrew Adamatzky's **reaction–diffusion
computers** and **collision-based computing**: reagents in a Belousov–Zhabotinsky
dish, where propagating waves collide and the collisions compute logic gates,
Voronoi diagrams and shortest paths. His **Physarum machines** solve mazes with
slime mould. **Cellular automata** are the clean case — Life and Rule 110 are
Turing-complete, so a *drawn* pattern of gliders and guns is a program
executing. And the **optical 4f correlator**: a lens performs a two-dimensional
Fourier transform physically, so a mask you draw and place in its Fourier plane
*is* a filter. That last one is the same mathematics as `draw.mask` below.

### ③ Drawn control signals — the direct ancestors

*From memory, citations not yet chased.* Daphne Oram's **Oramics** (1957) read
control voltages off shapes drawn on 35mm film. Murzin's **ANS synthesiser**
read sound off a drawing scratched into glass. Xenakis's **UPIC** (1977) took a
drawing as both score and timbre. Norman McLaren drew optical sound directly.
This lineage is exactly "a drawing is a control signal," and it is ~70 years old.

### What is now implemented, and proven

Three operators where the drawing is **literally the coefficient vector**, with
no interpretation step. All tested in `patch/test-drawops.mjs`:

| Operator | The drawing is | Measured result |
|---|---|---|
| **Drawn transfer** | the lookup table | a diagonal is the identity to 1.1e-16 |
| **Drawn kernel (FIR)** | the impulse response | a drawn spike is a **pure delay** (proves tap order); a flat drawing is a boxcar whose step response settles at exactly 1.0; passes 0.05 Hz at 0.98 and rejects 3 Hz at 0.00002 — **179.9 dB of separation** |
| **Drawn spectral mask** | the frequency response | output peaks at the drawn passband (0.1953 Hz for 0.2 Hz in); **0.001%** of energy survives past the drawing's right edge; an all-ones drawing passes signal at amplitude 1.029; an all-zero drawing silences it exactly |

Drawing a curve really is designing a filter. That is not a metaphor — the 32
points under your pointer are resampled to the tap vector and convolved.

### ④ The rigorous version — your feedback loop is already a reservoir

The strongest claim available to you, and it is nearly free.

In **physical reservoir computing**, you inject a signal into a nonlinear
dynamical system with memory, read out its state, and train **only a linear
readout**. Tanaka et al., *Recent Advances in Physical Reservoir Computing: A
Review* (arXiv:1808.04962) is the survey. It has been done in photorefractive
crystals, in optomechanical systems **read out by a video camera** (PNAS 2025),
and in buckets of water.

**Your video feedback loop satisfies the definition already:**

- *nonlinearity* — the hard colour key and the `lighter` composite
- *memory* — the one-frame delay in the ping-pong
- *high-dimensional state* — every pixel

So you could inject telemetry, read out N pixel patches, train a linear readout,
and **classify or predict something with an accuracy number** — say, which of
the 12 computation types in your workbook is running, or whether a task will
finish. At that point "my art performs computation" stops being a metaphor and
becomes a row in a results table. Built almost entirely from what exists.

This is the single highest-value thing left on the project, and it is an
experiment, not a build.

---

## 5. Files

| File | Lines | What |
|---|--:|---|
| `patch/sdf.js` | 339 | The shape language: 8 primitives, 9 domain transforms, 6 field operations, and a **compiler** that turns a spec tree into one nested closure (1.8× faster than interpreting it, and the only implementation, so the readable and fast paths cannot drift) |
| `patch/shapeops.js` | 369 | 26 shape operators + 2 colourisers |
| `patch/drawops.js` | 205 | 3 drawing-as-computation operators + 3 generators |
| `patch/opkit.js` | 99 | Shared parameter constructors, curve helpers, colour helpers |
| `viz/colorizer.js` | 118 | Legacy / keyer / ramp, with the two colour rules |
| `viz/shapes.js` | 161 | Distance field → luminance in the raster; scanned and raw routes |
| `patch/test-shapes.mjs` | — | **71 tests** |
| `patch/test-drawops.mjs` | — | **36 tests** |
| `viz/test-render.mjs` | — | **29 tests** |

Modified: `patch/ops.js` (composes the libraries), `patch/graph.js` (carries
shapes and colour; **type-checks wires**), `patch/dsp.js` (BandResynth takes a
per-bin mask), `viz/scanproc.js`, `viz/source.js`, `viz/main.js`, `patch.html`,
`patch/editor.js` (curve and colour widgets).

**154 tests pass across all four suites.**

### Running it

```sh
cd m0-telemetry && node telemetryd.js
#   http://localhost:7777/patch.html   -> "+ scanimate demo" builds a working chain
#   http://localhost:7777/viz.html     -> press G to toggle shapes
```

The demo button adds 18 nodes below your existing patch and wires nothing to
your scalar sinks, so it cannot fight the patch you already have. What it
builds: `cpu.busy_pct` → star radius; a drawn ramp → rotation; `cpu.busy_pct` →
squeeze; star blended with a ring; 4 concentric contours; `cpu.busy_pct` → the
keyer's first band edge; and `disk.tps` through a drawn FIR kernel into a scope.
Everything in it is a measurement or a drawing — nothing is a constant that
happens to look nice.

## 6. Known limits

- **Wires are type-checked now.** Shape ports are square; a shape cannot drive
  a number and vice versa. The editor says why it refused. `fromJSON` also drops
  type-mismatched edges, so a hand-edited `patch.json` degrades instead of
  silently reading zero.
- **Shape feedback is bounded, not unbounded.** A shape routed back into its own
  transformer would nest one level deeper every frame; past 24 levels the
  wrapper becomes a pass-through, and the nesting **freezes** rather than
  snapping back to one copy (which is what it did in the first version, and it
  visibly pulsed).
- **Cost.** Three shapes composite into the 512×320 raster in **7.0 ms**. Each
  shape's field is evaluated at a fraction of raster resolution and read back
  bilinearly — distance fields tolerate that, with the reconstructed contour
  moving well under one raster cell. The `field res` parameter is per shape.
- **`draw.mask` is slow by nature.** At 512 points and 10 Hz it is roughly 50 s
  behind its input. Resolving 0.1 Hz requires having watched for 10 s; this is
  a property of the method, and it is the substance of proposal question 5.
- **`Drawn profile` and `Twist` are not exact distance fields.** Their gradients
  are wrong on steep slopes, so they are fine for fills and single contours and
  poor for deep hollowing. Marked as such in the source.
- **Still unfixed:** saving a patch re-runs `init()` on every node, so all
  filter and DSP state resets. A 40 s autocorrelation window needs 40 s to
  refill. The curve editor deliberately does *not* reset state on a redraw —
  the kernel and mask operators detect a changed drawing and rebuild only their
  coefficients — but a numeric parameter change still wipes history.
- **The workbook is now out of date.** `08-SIGNAL-CONTROL.xlsx` documents 14
  SYNTH parameters and 14 RULES rows; there are 26 shape sinks and 34 new
  operators it knows nothing about.
