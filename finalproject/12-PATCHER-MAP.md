# The patcher, on one page

86 operators is too many to meet all at once. There are only **four kinds of
block**, and once you can tell them apart the palette stops being a list and
becomes a map.

---

## The four kinds

| Kind | What it does | Has an output wire? | Categories |
|---|---|---|---|
| **SIGNAL** | makes or shapes a number | yes | Sources, Math & shaping, Combine, Filters & envelopes, DSP, Drawing as computation, Logic, Generators, Utility |
| **GEOMETRY** | makes or transforms a *shape* (a field, not a number) | yes, on **square** ports | Shapes (SDF), Shape transformers, Shape combine |
| **MODULATOR** | describes a *behaviour* for every letter or window | **no** | Typography, Layout & orientation |
| **SINK** | hands something to the renderer | **no** | Output, Shape render, Colourisers, Botanical |

### The one rule

**Signals flow left to right and must end at a sink.** A chain that ends in
mid-air does nothing. There are only four ways to end:

```
  ... -> Output            writes a number to one of 37 named destinations
  ... -> Fill / Contour    draws a shape into the image
  ... -> Luma keyer/Ramp   sets the colours
  ... -> any Typography or Layout block   adds a behaviour to the stack
```

Typography and Layout blocks have **no output port at all**. That is not a
mistake: they are not in the signal path, they are instructions. Which leads
to the one surprise in the whole system —

> **Modulators apply top to bottom by where their nodes sit on the canvas.**
> Drag a node up or down to change when it runs. A Cascade delay only affects
> the modulators *below* it.

---

## What actually reaches the visualizer

This is the complete contract. Everything a patch can produce is one of these
six things, and the patcher's top bar shows which of them you are currently
sending.

**1. Thirty-seven named scalar destinations**, written by `Output` nodes:

```
scan      amp persp key skew gainR rowStep floor density
fb        gain zoom rot
rd        mix feed kill inject iters decay gain floor diffV
chain     mix
bus       net_in net_out disk_in disk_out fault cow
          pagein pageout compress decomp input fsev
hero      spawnRate deathProb       particle  speed       type  warp
```

**2. `$shapes`** — the fields Fill and Contour asked for
**3. `$color`** — the colouriser configuration
**4. `$text`** — the typography stack, in top-to-bottom order
**5. `$layout`** — the surface stack, in top-to-bottom order
**6. `$bot`** — the botanical tree's geometry

---

## Finding things

Type in the **filter box** at the top of the palette. It matches the
operator's name, its group, and its internal id, so `wave`, `colour` and `txt`
all find what you would expect. Escape clears it.

## Where it shows up

| | updates when |
|---|---|
| **preview pane** (`preview` button) | as you edit — no save |
| **floating panel** (`bin/hud-panel`) | as you edit — no save |
| **`open visualizer`** tab | as you edit — no save |
| `patch.json` / `psyche.json` on disk | only on **save** |

An edit is broadcast to every open window over the telemetry stream. **Save**
writes it to disk; **revert** pulls the last saved version back.

> One consequence worth knowing: a live push rebuilds every node, so filter
> and analysis state restarts. A 40-second autocorrelation window needs 40
> seconds to refill after each edit.

## Which source supports what

The Psychedelic view has four sources, and they do not all carry the same
information.

```
                                          mock   tree   screen   capture
  Image chain (scan, feedback, chemistry)  yes    yes     yes      yes
  Shapes (SDF)                             yes    yes     yes      yes
  Layout & orientation                     yes    yes     yes      yes
  Typography (per glyph)                   yes    yes     yes      NO
  Semantic phase sources and targets        —      —      yes      NO
  Botanical                                 —     yes      —        —
```

**Capture is the odd one.** A captured screen is pixels: no glyphs, no words,
no elements. The image chain can process it and the typography cannot. For
letters on your *real* screen use **read my screen**, which goes through the
Accessibility API and carries structure.

## Two keys worth knowing

In the view: **`I`** forces the image chain fully on (useful when no patch is
driving `chain.mix`), **`B`** bypasses every modulator. Both are the fast way
to see what something is actually contributing.
