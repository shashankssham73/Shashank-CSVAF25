# Psychedelic OS — and a Computing Visualizer

Final project, CSVAD Fall 25. Two systems sharing one patching environment.

**M1 — Psychedelic OS** turns the desktop into something you can patch. Your
screen is read as structure or as pixels, pieces of it are selected by rule,
and effects are applied to those pieces — the way a modular synthesiser
treats sound, with the machine's own display as the source.

**M0 — Computing Visualizer** is the other direction: machine telemetry —
processor load, memory pressure, disk and network traffic — rendered as an
image.

---

## Quick start

**macOS only.** Needs Node 18+ and the Xcode command line tools
(`xcode-select --install`). No `npm install` — there are no dependencies.

```sh
git clone \
  https://github.com/shashankssham73/Shashank-CSVAF25.git
cd Shashank-CSVAF25/finalproject

./build.sh                          # compiles 6 small Swift helpers
node m0-telemetry/telemetryd.js     # serves on 127.0.0.1:7777, loopback only
```

Then open **<http://127.0.0.1:7777/m1/psyche.html>** in Safari or any
Chromium browser.

### …or run it over the whole desktop

```sh
./psyche.sh              # the effect over everything, click-through
./psyche.sh --patcher    # …and the patcher too, to change it live
```

A click-through window covering the display shows your real screen with the
patch applied. Quit from the menu bar icon, or `pkill -f hud-panel`.

This needs **Screen Recording** granted (one prompt, the first time). It is
granted to the daemon's helper, not to the browser — and because
ScreenCaptureKit can exclude named applications, the overlay is left out of
its own capture, so the effect does not photograph itself.

In the render pane click **`mock desktop`**, pick **`acid bath`** from the
presets dropdown, and drag the `Constant` wired to the `chain.mix` `Output`
down to about `0.35`. That is the system working.

**No permissions are needed for that.** `mock desktop` is a synthetic scene.
The two live-screen sources each need one grant, in System Settings ▸ Privacy
& Security:

| to use | grant | to |
|---|---|---|
| `whole screen` / `./psyche.sh` | Screen & System Audio Recording | whatever launches it (Terminal) |
| `capture my screen` | Screen & System Audio Recording | your browser |
| `read my screen` | Accessibility | `m1-desktop/bin/ax-reader` |

If 7777 is taken: `node m0-telemetry/telemetryd.js --port 7788`.

→ **[SETUP.md](SETUP.md)** — the same thing with more detail and troubleshooting.
→ **[14-PSYCHE-TALK.pdf](14-PSYCHE-TALK.pdf)** — 18 slides, ten minutes.
→ **[13-PATCHER-MANUAL.pdf](13-PATCHER-MANUAL.pdf)** — the full reference.

---

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

Whole-screen PSYCHE mode works: `./psyche.sh` puts the processed screen over
the real one in a click-through overlay, with that overlay excluded from the
capture so there is no picture-inside-a-picture. `m1-desktop/src/screen-feed.swift`
does the capture; the existing renderer does all the processing, so every
operator and preset works there unchanged.

Not yet: the overlay covers one display, not several.

## Tests

```sh
node m1-psyche/test-readers.mjs      # 45 tests over the screen readers
```

Browser test pages live beside the modules they cover (`tiletest.html` and
friends) and post their results back to the daemon.
