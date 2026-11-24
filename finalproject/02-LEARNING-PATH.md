# Learning path — from where you are to where you can make the §8 decisions

**Link convention:** ✅ = link-checked (see `01-LINKS.md`). ◇ = canonical site I'm
confident in but did not re-verify. Citations without URLs are paywalled classics;
search the title.

## What you already have

From your coursework: FFT/DFT, convolution, filters and filter types, feedback,
raster sonification, DeepDream, p5.js. That is a real foundation and it means you can
**skip most of Stage 2** and treat it as revision. Your gaps, honestly ranked:

1. **Shader programming** — the single biggest one. Everything realtime lives here and
   p5.js at the canvas level will not get you to 60 fps with thousands of elements.
2. **Interaction engineering** — springs, hysteresis, interruption, prefetch. This is
   what separates "a demo" from "feels like Apple built it", and it has nothing to do
   with CNNs.
3. **A systems language** (Swift) — your telemetry and input layers cannot be JS.
4. **Treating CNNs as a controllable medium** rather than a filter you apply.

## How to use this

Eight stages, in order. Each one ends with a **checkpoint** (something you built, not
something you read) and says **which §8 decisions it unlocks**. Do not skip ahead to
the CNN stages — they are the last thing you need, not the first.

Realistic total: **~4 months part-time**. Stages 0–3 are the spine; if you only do
those, you can still ship a strong project.

---

# Stage 0 — Orient (half a day)

Before any theory, go and *feel* the problem space.

1. **Install and use [Eagle Mode](https://eaglemode.sourceforge.net/) for one hour.** ✅
   A real zoomable filesystem browser. You will learn more about why ZUIs fail users in
   an hour of use than in a week of reading. Pay attention to how you get *lost* — that's
   §8 decision #9.
2. Shneiderman, *The Eyes Have It* (1996) — ✅ [PDF](https://webspace.science.uu.nl/~telea001/uploads/VACourse/Shneiderman96.pdf).
   8 pages. "Overview first, zoom and filter, details on demand" is the sentence your
   whole interaction is an elaboration of.
3. Bret Victor, *Inventing on Principle* (talk, 54 min) ◇ and skim *Magic Ink* ◇
   <https://worrydream.com/>. Sets the ambition level.
4. Skim the [Pipeworld announcement](https://arcan-fe.com/2021/04/12/introducing-pipeworld) ✅ —
   someone already built a zoomable dataflow desktop. Know what exists.

**Checkpoint:** write one paragraph answering §8 #10 — what would make this project a
success? Keep it; you'll revise it.
**Unlocks:** #8 (visualizer vs shell), #10 (evaluation criterion).

---

# Stage 1 — See your own machine (1 week)

You have the instrument already. Use it before theorising.

1. Run `node telemetryd.js`, open the scope, and **leave it running for a working day**
   in a second window. Watch it while you compile, browse, export video, idle.
2. Read these man pages in full on your machine — they are the actual API docs for
   Layer A: `man powermetrics`, `man fs_usage`, `man nettop`, `man vm_stat`,
   `man iostat`, `man mdls`, `man latency`.
3. Run `mdls` on 20 different file types (photo, PDF, audio, video, app bundle). This is
   your free per-file feature vector — most people reach for a CNN before noticing it.
4. Record 10 minutes of NDJSON while doing something specific (export a video, run a
   build) and plot the channels offline.
5. *The Sonification Handbook* ✅ <https://sonification.de/handbook/> — **chapters 1–4**.
   Ch. 2 (sonification taxonomy) and the parameter-mapping chapter are the core. This is
   the most important reading in the whole path; it is about mapping data to the senses
   in general, not just to sound.

**Checkpoint:** a one-page table listing the 5–8 channels you believe are load-bearing,
with the *reason* each one is meaningful to a user. That is §8 #3, answered with evidence.
**Unlocks:** #3 (which streams matter), and first draft of #4.

**Install while you're here:** full Xcode (~8 GB, you only have Command Line Tools), and
`pip install numpy scipy matplotlib torch coremltools pillow opencv-python` — you have
none of these.

---

# Stage 2 — Signal processing for non-audio data (3–5 days; mostly revision for you)

You know FFT/DFT/convolution. What you likely haven't met is how badly they behave on
system telemetry, which is non-stationary, heavy-tailed, event-driven and counter-based.

1. Jack Schaedler, *Seeing Circles, Sines and Signals* ◇
   <https://jackschaedler.github.io/circles-sines-signals/> — fast, visual, free. Use it
   to refresh sampling, aliasing and windowing specifically.
2. Julius O. Smith, *Mathematics of the DFT* ◇ <https://ccrma.stanford.edu/~jos/mdft/> —
   reference, not cover-to-cover. Read the windowing and spectral-leakage sections.
3. Re-read **§B1 and §B2 of `00-RESEARCH-MAP.md`** — the five fixes (differentiate
   counters, log-compress, resample to a uniform grid, detrend, window) and the feature
   menu. Apply each one in the scope and watch what changes.
4. New material worth real time: **Takens embedding and recurrence plots.** Eckmann,
   Kamphorst & Ruelle (1987). This turns any 1-D telemetry stream into a 2-D texture and
   a 3-D trajectory — the bridge between your DSP coursework and your attractor sketch.

**Checkpoint:** take one channel (`vm.faults_per_s` is a good one), and produce: a
spectrogram, a recurrence plot, and a 3-D delay embedding. Three images from one signal.
**Unlocks:** the technical half of #4 (parameter vs model-based mapping).

---

# Stage 3 — Realtime graphics and shaders (3–4 weeks) ← **your biggest gap**

Non-negotiable. Everything in Layer C runs here.

1. **[The Book of Shaders](https://thebookofshaders.com/)** ◇ — Patricio Gonzalez Vivo.
   Work through chapters 1–11 *by typing them*, not reading. This is the single highest-
   value resource in this document for you.
2. [Shadertoy](https://www.shadertoy.com/) ◇ — read and modify others' shaders. Study
   anything using "Buffer A": that is **frame feedback**, which is your §B4 topology.
3. Inigo Quilez's articles ◇ <https://iquilezles.org/articles/> — especially distance
   functions, smooth minimum, and palettes. His `cos`-palette function alone will carry
   a lot of your colour work.
4. Then pick your target platform:
   - staying in the browser → [WebGPU Fundamentals](https://webgpufundamentals.org/) ◇
   - going native macOS → Apple's Metal docs + *Metal by Tutorials* (Kodeco, paid)
5. [Hydra](https://hydra.ojack.xyz/) ◇ — live-coded video feedback in the browser. An
   afternoon here teaches feedback intuition faster than any paper.

**Checkpoint:** a shader that takes a value from your M0 `/stream` endpoint (SSE straight
into JS, then a uniform) and visibly, smoothly modulates a full-screen effect at 60 fps.
That is the entire Layer A → Layer C pipeline proven end to end.
**Unlocks:** nothing in §8 directly — but without it you cannot build M2, and every later
decision is untestable.

---

# Stage 4 — Generative form (2 weeks)

Now the flower/tree/climber vocabulary.

1. Shiffman, *The Nature of Code* ◇ <https://natureofcode.com/> — free, and it's p5.js,
   your current stack. Chapters on vectors, forces, particle systems, autonomous agents,
   fractals, cellular automata.
2. Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants* ◇
   <http://algorithmicbotany.org/papers/abop/abop.pdf> — free. **Chapter 1 (L-systems)
   and the phyllotaxis section.** Don't read all 228 pages; mine it.
3. Runions, Lane & Prusinkiewicz, *Modeling Trees with a Space Colonization Algorithm* ✅
   [paper](https://algorithmicbotany.org/papers/colonization.egwnp2007.html) — **the key
   one for your idea.** Branches grow *toward attractors*; put one attractor per file and
   the tree literally grows to reach its children.
4. Karl Sims, *Reaction-Diffusion Tutorial* ◇ <https://www.karlsims.com/rd.html> —
   implement Gray–Scott as a shader. Good Stage-3 practice too.
5. Sage Jenson's physarum write-up ◇ <https://cargocollective.com/sagejenson/physarum>,
   backed by Jones (2010) ✅ — an agent model of **transport networks**, i.e. a literal
   model of data moving between components.

**Checkpoint:** a folder on your disk rendered as a space-colonization tree, where
branching comes from real directory structure and leaf placement uses phyllotaxis. Static,
no telemetry, no CNN.
**Unlocks:** #1 (form from content vs system state) — you can now try both and look.

---

# Stage 5 — Interaction engineering (2 weeks) ← **this is M2, and it is the hard part**

No new maths. This is where projects like yours usually die.

1. Nielsen, *Response Times: The 3 Important Limits* ◇
   <https://www.nngroup.com/articles/response-times-3-important-limits/> — 0.1 s / 1 s / 10 s.
2. **Springs, not easing curves.** Read any good explainer on damped-harmonic-oscillator
   animation; the property you need is *interruptibility mid-flight*, which is what
   "resize as they happen" actually requires. Apple's `CASpringAnimation` docs ◇, or
   `react-spring`'s documentation on the physics ◇.
3. Kurtenbach & Buxton, *The Limits of Expert Performance Using Hierarchic Marking Menus*
   (CHI '93) — can an expert do it without looking? The toy/tool dividing line.
4. Robertson et al., *Data Mountain* (UIST '98) — spatial memory is why determinism beats
   randomness. Read before answering #6.
5. Accot & Zhai, steering law (CHI '97); Grossman & Balakrishnan, *The Bubble Cursor*
   (CHI '05) — targeting and trajectory cost.
6. Re-read **§4 of `00-RESEARCH-MAP.md`** — the full knob list — and decide each knob.

**Checkpoint:** the bloom interaction, standalone. Hover or force-touch a folder, children
expand with staggered springs, interruptible, hysteresis on open/close, thumbnails
prefetched, **under 100 ms to first pixel**. No telemetry. No CNN. If this doesn't feel
fast, nothing later will save it.
**Unlocks:** #6 (determinism), #9 (how to get back out).

---

# Stage 6 — CNNs as a controllable medium (2–3 weeks)

Only now. Note that DeepDream is 2015 and its look is instantly dated; the useful
descendants are below.

1. Zeiler & Fergus, *Visualizing and Understanding Convolutional Networks* ◇
   [arXiv:1311.2901](https://arxiv.org/abs/1311.2901) — what layers actually represent.
2. Olah et al., *Feature Visualization*, Distill 2017 ◇
   <https://distill.pub/2017/feature-visualization/> — the rigorous version of DeepDream.
3. Mordvintsev et al., *Differentiable Image Parameterizations*, Distill 2018 ◇
   <https://distill.pub/2018/differentiable-parameterizations/> — includes **CPPNs**,
   which are resolution-independent and so solve your "resize as they happen" problem.
4. *Growing Neural Cellular Automata*, Distill 2020 ◇ <https://distill.pub/2020/growing-ca/>
   and *Self-Organising Textures*, Distill 2021 ✅ <https://distill.pub/selforg/2021/textures/>.
   **"A flower growing out of a folder" is close to literally what these papers do**, at
   ~8k parameters and ~1 ms/step.
5. Johnson et al., *Perceptual Losses* ◇ [arXiv:1603.08155](https://arxiv.org/abs/1603.08155) —
   realtime-capable stylization (~10–30 ms at 512 px).
6. Akten, *Learning to See* ✅ [arXiv:2003.00902](https://arxiv.org/abs/2003.00902) — the
   closest existing artwork to what you're describing; read the thesis framing too.
7. **Deployment:** `coremltools` ◇ <https://coremltools.readme.io/> — convert PyTorch to
   Core ML and run on the ANE. Measure the latency yourself; don't trust a blog post.

**Checkpoint:** MobileNet or CLIP, converted to Core ML, embedding a `qlmanage` thumbnail
in **under 10 ms on the ANE**, with that embedding driving the growth parameters from
Stage 4. Then measure: can it run in-frame, or must it be async?
**Unlocks:** #2 (CNN placement) — answered with a measurement, not a guess.

---

# Stage 7 — macOS systems programming (3 weeks)

Needed to turn the prototype into something that lives on the machine.

1. Swift language basics ◇ <https://www.hackingwithswift.com/> (free, 100 Days of Swift)
   or Apple's Swift book. You need maybe 20% of the language.
2. AppKit essentials: `NSWindow` levels, `NSApplication.presentationOptions` for the
   full-screen shell, `NSEvent` monitors. **Start from `src/pressure-probe.swift`** —
   it's a working 170-line AppKit program with all three input strategies in it.
3. The Apple docs listed at the end of `01-LINKS.md` — `NSEvent.pressure`, `stage`,
   `pressureChange(with:)`, ScreenCaptureKit, `QLThumbnailGenerator`, `NSMetadataQuery`.
4. **Read the source of [`macmon`](https://github.com/vladkens/macmon)** ◇ — how to get
   power/thermal data *without sudo* via the private IOReport framework. This is the
   difference between a demo needing `sudo` and one that doesn't.
5. Read [`yabai`](https://github.com/koekeishiya/yabai)'s docs ◇ on SIP — a concrete map
   of what macOS will and won't let you do to the window system.
6. Learn the TCC permission model, entitlements, and code signing. Each permission you
   require is a user who says no.

**Checkpoint:** your Stage-5 bloom running as a native Swift app with real analog
`NSEvent.pressure` input, full-screen presentation mode, reading real thumbnails.
**Unlocks:** #5 (research vs shippable), #7 (macOS vs Linux).

---

# Stage 8 — The Apple-grade bar (ongoing, from Stage 5 onward)

1. Apple Human Interface Guidelines ◇ — read the macOS sections properly, including
   **Reduce Motion**. Your entire aesthetic needs a static fallback.
2. Instruments: Time Profiler, Metal System Trace, Energy Log. Requires full Xcode.
3. Re-read **§7a of `00-RESEARCH-MAP.md`** and hold yourself to the numbers: idle ≈ 0%,
   p99 frame < 16.67 ms, memory < 150 MB, VoiceOver-navigable, degrades under
   `thermalState`.
4. Accessibility: run your UI with VoiceOver on and keyboard only.

---

# If you only have six weeks

Stage 0 (half day) → Stage 1 (3 days) → Stage 3 shaders (2 weeks, non-negotiable) →
Stage 4 form (1 week) → Stage 5 interaction (2 weeks). Ship the bloom with
space-colonization layout and one telemetry channel modulating it. Skip CNNs entirely
and say so deliberately — a fast, beautiful, coherent interaction with no CNN beats a
slow one with a CNN bolted on, and the §8 #2 decision stays open for next term.
