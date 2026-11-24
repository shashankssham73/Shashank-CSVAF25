# Running it

macOS only. The project reads the live screen two different ways, and both
are macOS APIs with no cross-platform equivalent.

## Requirements

- macOS 13 or later (developed on 15.5)
- Node 18 or later — `node --version`
- Xcode command line tools — `xcode-select --install`
- A Chromium browser for rebuilding the PDFs (optional)

## 1. Build the native helpers

```sh
cd finalproject
./build.sh
```

Five small Swift programs: three that sample machine telemetry, one that
walks the Accessibility tree, one window probe. They are built rather than
committed because macOS quarantines downloaded binaries, and Accessibility
permission is granted **per binary path** — a helper you compiled yourself is
one the system will let you authorise.

## 2. Start the daemon

```sh
node m0-telemetry/telemetryd.js
```

It serves on **127.0.0.1:7777** and `[::1]:7777`, and binds to loopback only —
nothing is exposed to the network. Leave it running.

## 3. Open the patcher

| what | URL |
|---|---|
| **Psychedelic OS patcher** — start here | <http://127.0.0.1:7777/m1/psyche.html> |
| The render on its own, full window | <http://127.0.0.1:7777/m1/view.html> |
| Computing Visualizer (the other half of the project) | <http://127.0.0.1:7777/viz.html> |

Safari or any Chromium browser. Safari is what it was developed against.

## 4. Permissions

Two separate grants, both in **System Settings ▸ Privacy & Security**:

| to use | grant | to |
|---|---|---|
| `capture my screen` | **Screen & System Audio Recording** | your browser |
| `read my screen` | **Accessibility** | `finalproject/m1-desktop/bin/ax-reader` |

Neither is needed for `mock desktop`, which is a synthetic scene — enough to
see the whole system working without granting anything.

## 5. First five minutes

1. In the render pane, click **`mock desktop`**
2. From the presets dropdown choose **`acid bath`**
3. Find the `Constant 1` wired to the `Output` set to `chain.mix` — top-left
   of the patch — and drag its value down to about `0.35`. The desktop
   reappears underneath the chemistry.
4. Try **`melt`** or **`datamosh`** with `capture my screen` for the real thing.

Nothing needs saving: editing the patch updates the render within 160ms.

## Reading rather than running

- `14-PSYCHE-TALK.pdf` — 18 slides, ten minutes, the whole idea
- `13-PATCHER-MANUAL.pdf` — the reference, generated from the live operator
  registry so it cannot drift from the software

## If something does not work

The render window has a **log panel** at the bottom left — capture requests,
failures and their reasons appear there rather than only in the console.
The status line along the bottom of the render says what the source is, how
many things each effect is reaching, and whether the image chain is on.
