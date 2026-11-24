# Proposal — References, Signals, Questions

Shashank · CSVAD Fall 25

Drop-in sections for the proposal. Written against the two-objective framing:
**(1) a computing visualizer** — telemetry daemon → video feedback (primary) → rule-based
morphogenesis (improviser); **(2) a psychedelic UI** for voice-driven general computing,
laid out by space colonization.

Canonical demo task used throughout: *find every PDF on disk, convert each to three
formats, write each to its own folder, zip each one.* It is a good test case because it is
long, periodic, and touches every subsystem — disk, CPU, memory, filesystem events — in a
fixed order per file.

---

## A. References to prior and inspiring work

★ = read closely, the technique comes directly from it. The rest are cited for position.

### Video feedback as a signal system

| Work | What is taken from it |
|---|---|
| ★ Crutchfield, *Space-Time Dynamics in Video Feedback* (Physica D 10, 1984) | Feedback as an iterated map. The zoom / rotation / gain parameter space and where in it the loop is stable, periodic, or chaotic. This is the parameter map for objective 1. |
| ★ Steina & Woody Vasulka, *The Matter*, *Violin Power* (1970s) | The electronic signal treated as material to be bent, not as a picture of something. Precedent for driving image structure from a non-image source. |
| Ben Laposky, *Oscillons* (1950s); Mary Ellen Bute | Earliest instances of a measured waveform being the image itself rather than being plotted. |
| ★ Hydra (Olivia Jack) | Working reference implementation of chained video feedback with `src(o0)` self-sampling. Fastest way to prototype a feedback topology before committing to a shader. |

### Visual form and altered states

| Work | What is taken from it |
|---|---|
| ★ Bressloff, Cowan, Golubitsky, Thomas & Wiener, *Geometric visual hallucinations, Euclidean symmetry and the functional architecture of striate cortex* (Phil. Trans. R. Soc. B 356, 2001) | The retinocortical map `(r, θ) → (log r, θ)`. A plain grating in that space renders as a tunnel, fan, spiral, or lattice depending only on its orientation. This is the generator for objective 2, and it is why zoom feedback produces tunnels. |
| Klüver, *Mescal and Mechanisms of Hallucinations* (1928/1966) | The four form constants as the target vocabulary: tunnel, fan, spiral, lattice. |
| ★ Suzuki, Roseboom, Schwartzman & Seth, *A Deep-Dream Virtual Reality Platform for Studying Altered Perceptual Phenomenology* (Scientific Reports 7, 2017) | The only rigorous attempt to induce and then *measure* psychedelic-like visual phenomenology computationally. Establishes that the effect can be evaluated rather than asserted — directly relevant to how objective 2 gets assessed. |
| Brion Gysin & Ian Sommerville, *Dreamachine* (1959); Collective Act / Seth, *Dreamachine* (2022) | Flicker at 8–13 Hz as the induction mechanism, and the safety envelope that comes with it. |
| Jordan Belson, *Samadhi* (1967); James Whitney, *Lapis* (1966) | Form-constant animation: tempo, rotational symmetry, how slowly it has to move to read as organic. |

### Morphogenesis and growth

| Work | What is taken from it |
|---|---|
| ★ Runions, Lane & Prusinkiewicz, *Modeling Trees with a Space Colonization Algorithm* (Eurographics 2007) | Branches grow toward an attractor cloud; one attractor per file. The layout engine for objective 2 — [2.1] in my description. |
| Turing, *The Chemical Basis of Morphogenesis* (1952); Gray & Scott (1983) | Blur plus nonlinearity in a feedback loop *is* reaction–diffusion. Lets the same shader serve as both the feedback accumulator and the morphogenesis substrate. |
| Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants* (1990) | Rewriting rules, phyllotaxis, and the branching-angle parameters the rule system exposes. |
| Mordvintsev et al., *Growing Neural Cellular Automata* (Distill 2020) | A learned alternative to hand-written rules, if the rule set proves too brittle. Deferred — see Q2. |

### Interface precedents

| Work | What is taken from it |
|---|---|
| ★ Bederson & Hollan, *Pad++: A Zooming Graphical Interface* (UIST 1994) | Semantic zoom and recursive progressive disclosure, plus the documented failure modes — disorientation, lost context. The thing my UI must beat. |
| *Tron* (1982) — Syd Mead, Richard Taylor, Harrison Ellenshaw | The system rendered as an inhabited place with its own topology, where process state is terrain rather than a progress bar. The operative constraint I take from it is that the visual state must be *readable as the task's state*, not merely correlated with it. |
| Ryoji Ikeda, *datamatics* (2006–) | Measured data presented as raster at full rate without decoration. |
| Arcan / Pipeworld (Björn Ståhl) | Prior art for a working non-conventional desktop shell, and an honest account of what breaks. |

### Voice as continuous input

| Work | What is taken from it |
|---|---|
| ★ Igarashi & Hughes, *Voice as Sound: Using Non-verbal Voice Input for Interactive Control* (UIST 2001) | Voice used as a continuous controller — pitch, loudness, duration — not as a command vocabulary. The core move for objective 2: the words choose the task, the acoustics shape the visual. |
| Harada, Landay, Malkin, Li & Bilmes, *VoiceDraw* (ASSETS 2007) | Vowel quality mapped to direction for continuous 2-D control; evidence that non-speech vocal parameters are learnable as an input channel. |
| Radford et al., *Whisper* (2022) | Local ASR for the command layer only. Not where the signal processing lives. |

### Telemetry access

| Work | What is taken from it |
|---|---|
| `macmon`, `asitop` | How to reach power and frequency counters through IOReport without root, which is the constraint that shaped my channel list. |
| Hermann, Hunt & Neuhoff, *The Sonification Handbook* (2011), ch. 2 and 15 | The parameter-mapping taxonomy. Written for audio, but the distinction between direct mapping, model-based mapping, and continuous vs. discrete excitation is what keeps objective 1 from being arbitrary. |

---

## B. Signals processed and analysed

Four source groups. Sample rates are measured, not nominal.

| Group | Source | Native rate |
|---|---|---|
| **T** Telemetry | 43 channels, 7 unprivileged macOS sources, running daemon | 0.3–5 Hz per source, resampled to a 30 Hz frame |
| **V** Voice | built-in mic, **1 channel** (measured — the array is not exposed) | 44.1 kHz |
| **F** Frame | rendered feedback accumulator, read back from GPU | 60 Hz, 2-D |
| **S** Structure | filesystem graph, `mdls` metadata | event-driven, not a time series |

### Processing

| # | Tool | Signal | Operation | Controls |
|---|---|---|---|---|
| 1 | conditioning | T, all counter channels | differentiate → `log1p` → detrend → Hann → resample to uniform grid | prerequisite for 2–10 |
| 2 | **digital filter** (IIR) | T `cpu.busy_pct`, `net.*` | one-pole envelope follower, separate attack/release | global flow rate; advection gain |
| 3 | **digital filter** (one-euro) | T `in.cursor_*` | adaptive low-pass, speed-dependent cutoff | pointer response; the jitter-vs-lag tradeoff |
| 4 | **STFT** | T `vm.faults_per_s`, `disk.tps` | 256-pt Hann, 50% hop; spectral centroid and flatness | diffusion radius in the feedback kernel |
| 5 | **STFT → iSTFT** | T `net.in_bytes_per_s` | retain 0.1–0.3 Hz only, resynthesize | the slow breathing envelope on zoom rate |
| 6 | **autocorrelation** | T `disk.tps` during the PDF task | find the per-file loop period: *N* files × *T* s each gives a fundamental at 1/*T* | locks morphogenesis branch events to the task's own period, so one new branch grows per file converted |
| 7 | **autocorrelation** | T `in.cursor_speed` | gesture tempo and dwell detection | phase-locks the visual pulse to the user; triggers progressive disclosure |
| 8 | **cross-correlation** + lag search | T `disk.tps` × `vm.faults_per_s` × `cpu.busy_pct` | 0–5 s lag sweep: which subsystem leads | orders visual events *causally* (read → decode → write) instead of firing them simultaneously |
| 9 | **cross-correlation** | T `in.cursor_speed` × `cpu.busy_pct` | does user action precede machine load, or follow it? | sets the sign of the self-referential loop (the renderer's own GPU cost appears in the telemetry driving it) |
| 10 | **convolution** (1-D) | T `fs.events`, `net.retx_per_s` | sparse event train ⊛ exponential decay kernel | continuous excitation from discrete events — each file written becomes a decaying impulse |
| 11 | **STFT** | V mic | 2048-pt, 75% overlap; spectral tilt, centroid, voiced/unvoiced | hue rotation and saturation while speaking |
| 12 | **autocorrelation** | V mic | pitch (f₀) over 50–400 Hz | growth direction / branching angle — rising intonation opens the branch angle |
| 13 | **cepstrum** (FFT → log → iFFT) | V mic | separate source from filter; formant tracking | vowel quality → attractor cloud shape, after *VoiceDraw* |
| 14 | **digital filter bank** | V mic | 3rd-order Butterworth bandpass bank, octave-spaced | per-band energy → per-band displacement of the morphogenesis field |
| 15 | **STFT → iSTFT** | V mic | spectral freeze and time-stretch of the command utterance | the audible/visible "echo" that persists while the task it launched runs |
| 16 | **cross-correlation** (matched filter) | V mic | template-correlate against a recorded onset to detect utterance start under room noise | gates the ASR layer; cheaper than running Whisper continuously |
| 17 | **convolution** (2-D) | F | Gaussian (diffusion) + unsharp (reaction) kernels per frame | makes the accumulator a reaction–diffusion system; this is where feedback and morphogenesis become one operation |
| 18 | **2-D FFT** | F | radially averaged power spectrum; detect collapse (saturation) or flatness (noise) | automatic gain control holding the loop near edge-of-chaos instead of blowing out |
| 19 | **FFT → iFFT** (phase correlation) | F, frames *t* and *t−1* | cross-power spectrum → iFFT → peak = global shift and rotation | optical flow for advection, and a closed-loop check that the achieved warp equals the intended one |
| 20 | **1-D FFT** | F resampled to log-polar | FFT along the angular axis; dominant angular wavenumber | measures, then steers, the symmetry order — literally the number of spiral arms |
| 21 | log-polar / Mellin transform | F | `(r, θ) → (log r, θ)` before filtering | makes zoom-and-rotate a pure translation, so one grating generates all four form constants |
| 22 | Lomb–Scargle | T, event-driven channels | periodogram on non-uniformly sampled data | periodicity estimate for channels that cannot honestly be resampled (see Q4) |
| 23 | — | S filesystem graph | depth, fan-out, content entropy, `mdls` type | space-colonization attractor placement; not a time series, listed for completeness |

**Class-tool coverage:** FFT (18, 19, 20, 13), iFFT (13, 19), STFT (4, 5, 11, 15), iSTFT (5, 15), autocorrelation (6, 7, 12), convolution (10, 17), cross-correlation (8, 9, 16), digital filters (2, 3, 14). Additional tools: cepstral analysis, log-polar/Mellin, Lomb–Scargle, Gray–Scott reaction–diffusion.

**Note on sampling.** Telemetry tops out around 5 Hz per source without root, so its usable analysis band is roughly 0–2.5 Hz. Voice at 44.1 kHz is the only genuinely audio-rate signal in the system, and the only place where windowing, aliasing, and resolution tradeoffs bite in the way the class covers them. That is the strongest technical argument for keeping objective 2's voice layer rather than cutting it.

**On the rule system.** The narrative framing resolves to a finite state machine over the task lifecycle: a task's measured phases (scan → convert → write → compress) each select one parameter regime of the feedback loop, with transitions triggered by the cross-correlation lag structure in row 8. The visual therefore tracks task *state*, not just task *magnitude*. Stated this way it is a control specification, not a story.

---

## C. Questions

**Scope**

1. As described this is three things: a telemetry-driven visualizer, a voice input layer, and a generative UI shell. Which single one should be the final project, with the others reduced to stubs? My own instinct is to keep the visualizer and the voice layer, because together they cover the full tool list, and to reduce the UI to one navigable directory. I would rather cut now than at week five.
2. Should the morphogenesis layer be rule-based as planned, or would you rather see the learned alternative (neural CA)? Rules are debuggable and I can explain every parameter; the learned version is more interesting but becomes a black box in the middle of a signal chain.

**Method**

3. Rows 18–20 analyse the system's *own rendered output* and feed the result back as a control parameter. Is that a legitimate use of the class's tools, or does it read as control engineering rather than signal processing?
4. Telemetry is 0.3–5 Hz and some channels are genuinely event-driven. Is resampling onto a uniform grid before STFT acceptable, or do you want Lomb–Scargle (row 22) on the irregular channels? I can also run the daemon as root and get several sources above 100 Hz, at the cost of the project no longer running on anyone else's machine without privileges.
5. These signals are non-stationary on about a one-second scale, but at 1 Hz a four-second window gives very few bins. Preferred approach — per-channel window lengths, multirate analysis, or wavelets?
6. Is the log-polar transform (row 21) a signal-processing tool in this class's sense, as a coordinate transform applied before filtering in the Mellin manner, or should I present it purely as rendering and not count it?
7. Is phase correlation (row 19) an acceptable substitute for a classical optical-flow method, given that it is built entirely from FFT and iFFT?

**Evidence**

8. What would convince you the signal processing is load-bearing rather than decorative? My plan is two figures: the autocorrelation of `disk.tps` during the PDF task with its peak at the known per-file period, and the same capture rendered with each operation bypassed. The ablation doubles the render work, so I want to know it counts before building it.
9. For objective 2, is there any evaluation you would accept short of the *Hallucination Machine* protocol — self-report on a phenomenology questionnaire — or is "it looks right" acceptable at this scale?

**Logistics**

10. The project is machine-specific: it reads my hardware's counters. Deliverable as a live demo on my machine, a recorded capture, or a version driven by pre-recorded NDJSON so any frame traces back to the measurements that produced it? I can do all three but the third costs a week.
11. You asked for no artistic framing in the proposal, which I have followed. The *Tron* reference does real work — it is the constraint that the visual must be readable as task state rather than merely correlated with load. Keep it as a reference with that justification, or drop it?
12. Photosensitivity: I am holding to ≤3 flashes/s (WCAG 2.3.1), honouring reduced-motion, and capping the 8–13 Hz flicker band that the Dreamachine work deliberately targets. Is there an institutional requirement for exhibition beyond that?
