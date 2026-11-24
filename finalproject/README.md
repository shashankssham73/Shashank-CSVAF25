# Psychedelic OS — and a Computing Visualizer

Final project, CSVAD Fall 25. Two systems sharing one patching environment.

**M1 — Psychedelic OS** turns the desktop into something you can patch. Your
screen is read as structure or as pixels, pieces of it are selected by rule,
and effects are applied to those pieces — the way a modular synthesiser
treats sound, with the machine's own display as the source.

**M0 — Computing Visualizer** is the other direction: machine telemetry —
processor load, memory pressure, disk and network traffic — rendered as an
image.

→ **[SETUP.md](SETUP.md)** to run it. macOS only.
→ **[14-PSYCHE-TALK.pdf](14-PSYCHE-TALK.pdf)** — 18 slides, ten minutes.
→ **[13-PATCHER-MANUAL.pdf](13-PATCHER-MANUAL.pdf)** — the full reference.

## The model

Every patch in the project is an arrangement of four stages:

```
READ  ──▶  PICK  ──▶  EFFECT  ──▶  OUTPUT
```

| | |
|---|---|
| **READ** | Turn the screen into pieces. Accessibility elements (knows what a word *is*), a grid of tiles, or regions of similar colour. |
| **PICK** | Choose which pieces. By role, by application, by what the text is, by measurement, inside a shape, or combinations of those. |
| **EFFECT** | Do something to them. Typography moves individual letters; layout moves whole windows and tiles; the image chain does scan deflection, video feedback, reaction-diffusion and colour. |
| **OUTPUT** | Hand a number to one of the renderer's dials. The master dial is `chain.mix`: 0 is an untouched screen, 1 is fully transformed, and between the two the real screen is composited back underneath — which is how an effect can run while the text stays readable. |

100 operators, 13 presets.

## Layout

| path | |
|---|---|
| `m0-telemetry/` | the daemon, the telemetry samplers, and `patch/` — the patcher itself, shared by both systems |
| `m0-telemetry/patch/` | the graph engine, 100 operators, the editor |
| `m1-psyche/` | the Psychedelic OS renderer, screen readers, presets |
| `m1-desktop/` | native Swift helpers — Accessibility reader, window probe |
| `manual/` | generators for both PDFs, built from the live registry |
| `figures/`, `*.md` | research notes, proposal, block diagrams |

## State of it

Working: reads the live screen both ways · effects scoped to a chosen window
· everything patchable while it runs · presets save and load · a per-block
live count of how many things each effect is actually reaching.

Not yet: the effect runs in a window showing a processed **copy** of the
screen. Altering the actual desktop needs a native full-screen always-on-top
overlay fed by ScreenCaptureKit with `excludingApplications:` — designed, not
built.

## Tests

```sh
node m1-psyche/test-readers.mjs      # 45 tests over the screen readers
```

Browser test pages live beside the modules they cover (`tiletest.html` and
friends) and post their results back to the daemon.
