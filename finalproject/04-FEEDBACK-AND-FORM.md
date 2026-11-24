# Video feedback, form constants, and designing a "micro-dose" UI

The goal: an interface whose visual field is slightly, continuously *off* — enough to
alter how computing feels, not enough to stop you working. That is a precise design
target and it is mostly about **rates of change relative to perceptual thresholds**,
not about intensity.

---

## 1. The one idea worth knowing: the retina→cortex map is log-polar

In 1926 Heinrich Klüver catalogued what people actually see under mescaline, and found
only four recurring geometries — he called them **form constants**:

> **I.** tunnels and funnels **II.** spirals **III.** lattices, honeycombs, checkerboards
> **IV.** cobwebs

The same four show up in migraine aura, flicker stimulation, pressure phosphenes,
hypnagogia and near-death reports. That is suspicious: it means they come from the
visual system's own structure, not from any particular cause.

Bressloff, Cowan, Golubitsky, Thomas & Wiener (2001) explained it. Two facts combine:

1. **The map from retina to primary visual cortex (V1) is approximately log-polar.**
   A point at retinal angle θ and radius r lands in cortex at roughly `(log r, θ)`.
2. **V1 under destabilisation spontaneously forms stripe and spot patterns** — the same
   Turing instability you already know from reaction-diffusion.

Run those together: **plain stripes in cortex become concentric rings, spirals, or rays
in the visual field, depending only on the stripe angle.** Hexagons in cortex become
honeycombs and lattices. The form constants are just Turing patterns seen through a
logarithmic lens.

**What this gives you concretely:** if you want imagery that feels native to the visual
system rather than merely decorative, do not draw spirals. Generate a simple pattern in
log-polar space and transform it back to screen space. The spiral emerges.

```glsl
// screen -> cortical (log-polar) coordinates
vec2 p = (uv - 0.5) * 2.0;
float r = length(p);
float a = atan(p.y, p.x);
vec2 cortex = vec2(log(r + 1e-3), a);   // <- generate your pattern HERE

// a single straight stripe in `cortex` renders as a logarithmic spiral on screen.
// stripe angle controls which form constant you get:
//   stripes along log r   -> concentric rings / tunnel
//   stripes along a       -> rays / fan
//   oblique               -> spiral, pitch set by the angle
//   hexagonal lattice     -> honeycomb
float stripes = sin(cortex.x * K1 + cortex.y * K2);
```

This is the single highest-leverage trick in this document. It also explains why zooming
feedback produces tunnels: **a constant zoom per frame is a constant translation in
log-polar space.** Video feedback is literally drifting the cortical image sideways.

---

## 2. Video feedback as a dynamical system

Each frame: sample the previous frame through a transform, add new content, apply a
nonlinearity. That is an iterated map, and its behaviour is set by the transform's fixed
point and gain.

```
frame[n+1] = f( warp(frame[n]) * gain + input )
```

| Component | What it does | Useful range (per frame, 60 fps) |
|---|---|---|
| **scale** | >1 outward tunnel, <1 inward tunnel | 0.990 – 1.015 |
| **rotation** | spiral arm pitch | 0.1° – 1.5° |
| **gain / decay** | how long trails persist; ≥1 saturates to white | 0.90 – 0.99 |
| **blur radius** | the diffusion term | 0.5 – 2 px |
| **sharpen / contrast** | the reaction term; this is what keeps it alive | slight |
| **hue rotation** | colour cycling | 0.2° – 2° |
| **displacement field** | curl noise or optical flow advection | small |
| **nonlinearity** | `tanh`, soft clamp, or palette remap | essential |

**Blur + sharpen + feedback ≈ reaction-diffusion.** Diffusion from the blur, reaction
from the nonlinearity. You already know this system; it's Gray–Scott wearing a different
coat. Edge-of-chaos is where gain is just below the point of saturation.

Crutchfield's *Space-Time Dynamics in Video Feedback* (1984) is the rigorous treatment
and has the bifurcation diagrams: <https://vasulka.org/archive/eigenwelt/pdf/191-207.pdf>

---

## 3. What makes it a *micro*-dose: timing, not intensity

This is the whole design problem. Four rules:

**Stay under the detection threshold.** Motion slower than roughly **0.5°/s of rotation**
or **1%/s of scale** is not consciously seen as motion, but *is* noticed as "something
changed" when you look back. That gap — unseen while happening, obvious in retrospect —
is the micro-dose feeling.

**Modulate at breathing rate.** Envelope everything with a slow oscillator at
**0.1–0.3 Hz** (6–18 cycles/min, human respiration). Interfaces that breathe read as
alive rather than animated. Apple's sleep-light pulse is this.

**Use 1/f noise, not sine waves.** Periodic modulation reads as mechanical within about
three cycles. Pink-noise modulation of the same parameters reads as organic and never
quite repeats. This one change does more than any amount of extra effects.

**Let it accumulate on dwell and reset on motion.** Feedback gain creeps up the longer
the cursor is still, and snaps back when you move. The display intensifies only when
you stop and stare, which is also *self-limiting* — you can't get lost in it while
working, and it's inherently safe.

Afterimages are the other half: the **motion aftereffect** (stare at drift, look away,
the world drifts back) and chromatic adaptation make the effect persist past the screen.
Subtle opponent-colour drift (slow cyan↔red bias) produces this well.

**Avoid inducing the McCollough effect** — orientation-contingent colour adaptation from
prolonged coloured gratings. It can last days. Don't hold a static coloured grating on
screen for minutes.

---

## 4. Coupling it to the computing — the part that's yours

Anyone can write a feedback shader. The thing only you are building is feedback **driven
by the machine's own activity and the user's own hand**. Suggested mappings:

| Driver | Feedback parameter | Why |
|---|---|---|
| cursor velocity | advection strength / displacement | the image follows your hand |
| dwell time (cursor still) | feedback gain, slowly rising | stare → it deepens |
| scroll delta | rotation per frame | your scroll winds the spiral |
| slide distance (your tap-and-slide) | zoom rate, i.e. tunnel speed | direct control of depth |
| `cpu.busy_pct` | blur radius / diffusion | a busy machine smears |
| `vm.faults_per_s` | impulse injections into the field | page faults as sparks |
| `net.retx_per_s` | glitch / displacement spikes | retransmits as stutters |
| `pwr.batt_temp_c` | hue bias | slow thermal drift of colour |
| idle (no input) | drift toward a stronger attractor | the machine daydreams |

The self-referential loop is the good one: **your renderer's own GPU load appears in the
telemetry that drives the renderer.** Keep the loop gain below 1 or add a low-pass on the
feedback path, or it oscillates. (Or let it oscillate at a frequency you choose.)

---

## 5. Safety, as an engineering constraint

Not optional — this is a UI people will stare at for hours.

- **Flicker:** 15–25 Hz full-field flicker is peak photosensitive-seizure risk.
  **Never flash more than 3 times per second** over a large area (WCAG 2.3.1). Alpha-band
  (8–13 Hz) flicker is the classic Dreamachine effect and the one to be most careful with:
  if you use it at all, keep contrast very low and area small.
- **Respect `prefers-reduced-motion`.** Ship a genuinely static fallback, not a slower
  version. Also required by the §7a Apple-grade bar.
- **Large-field optic flow causes motion sickness.** Full-screen zoom/rotation is exactly
  the stimulus used to induce it in labs. Keep strong flow off-centre or windowed.
- Give the user one obvious, always-available intensity control (your sketch #5 already
  has this: "you can control the intensity"). Default it low.

---

## 6. What to look at — six things, not sixty

1. **Hydra** <https://hydra.ojack.xyz/> — live-coded video feedback in the browser. **Do
   this tonight, one hour.** Nothing else teaches feedback intuition this fast.
2. **Bressloff et al., "Geometric Visual Hallucinations, Euclidean Symmetry and the
   Functional Architecture of Striate Cortex"** (Phil. Trans. R. Soc. B, 2001). Skim for
   the log-polar argument and the pattern figures; skip the group theory.
3. **Crutchfield, "Space-Time Dynamics in Video Feedback"** (1984) —
   <https://vasulka.org/archive/eigenwelt/pdf/191-207.pdf>. You already had this one.
4. **Shadertoy, anything using "Buffer A"** — that *is* frame feedback. Read five, fork one.
5. **Brion Gysin & Ian Sommerville, the Dreamachine** (1959) — flicker-induced closed-eye
   form constants. Read the history, build nothing at 15–25 Hz.
6. **James Whitney, *Lapis* (1966)** — 10 minutes, on YouTube. Mandala/form-constant
   animation done by hand, decades before shaders, and still better than most of what
   gets posted today. Also look at Jordan Belson.

---

## 7. Tonight, in Hydra

Paste into <https://hydra.ojack.xyz/> and change the numbers — that *is* the exercise.
These are starting points, not finished looks.

```javascript
// 1 — spiral tunnel. The whole thing is scale + rotate + decay.
src(o0)
  .scale(1.012)
  .rotate(0.008)
  .color(0.99, 1.0, 1.01)
  .add(osc(20, 0.05, 1).mask(shape(4, 0.08, 0.1)), 0.06)
  .out(o0)
```

```javascript
// 2 — breathing: the same thing enveloped at respiration rate (0.15 Hz)
src(o0)
  .scale(() => 1.004 + 0.008 * Math.sin(time * 0.9))
  .rotate(0.006)
  .modulate(noise(2, 0.05), 0.004)
  .add(osc(12, 0.03, 1.1).mask(shape(60, 0.12, 0.3)), 0.05)
  .out(o0)
```

```javascript
// 3 — cursor-driven: move the mouse, the field follows. This is the seed of
// the real thing — swap mouse for your tap-and-slide, then for telemetry.
src(o0)
  .scale(1.009)
  .rotate(() => (mouse.x / width - 0.5) * 0.03)
  .modulate(noise(3, 0.1), () => 0.002 + (mouse.y / height) * 0.01)
  .add(osc(15, 0.02, 1).mask(shape(4, 0.1, 0.2)), 0.05)
  .out(o0)
```

Then the real exercise: replace `mouse.x` with a value from your own daemon.
`new EventSource('http://localhost:7777/stream')` works straight from the Hydra page.
