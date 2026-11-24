# Scanimate Lab (standalone prototype)

Open `scanimate_lab.html` in Chrome or Safari. Nothing to install.

Source files (so the blocks can be merged into the patcher later):
- `dsp.js`   fft, fft2, spectrogram painter to sound (iSTFT), 2D mask filter
- `core.js`  block registry (sources, shapes, transformers, palettes), evaluator, paint-a-program compiler
- `ui.js`    rack, renderer (grey feedback + colorizer LUT), four drawing studios
- `build.py` inlines the three JS files into `template.html` -> `scanimate_lab.html`

Tests (node): `node test_dsp.js`, `node test_core.js`, `node test_paint.js`.
Browser test: `node pw_test.js` (needs playwright).

Rules shared with the patcher: signals are 0..1; each parameter maps 0..1 to its own range;
nodes run in dependency order; a cycle reads the previous frame.
Telemetry blocks are MOCK. To use real values call `CORE.Tele.set('cpu.busy_pct', 0..1)`.
