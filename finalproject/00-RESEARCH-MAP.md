# Organic Shell / Computational Visualizer — Research & Parameter Map

Target machine (probed 2026-11-11): MacBook Air M3, 8-core CPU (4P+4E), 10-core GPU,
16 GB unified memory, macOS 15.5 (24F74), **SIP enabled**, Command Line Tools only
(no full Xcode), built-in 2560x1664 @ 60 Hz. Working medium so far: p5.js / JS.

Three hard numbers that constrain everything below:
- **16.67 ms** frame budget (60 Hz, no ProMotion on the M3 Air).
- **~100 ms** is the perceptual "instant" threshold (Card/Robertson/Mackinlay); **~1 s**
  is the "uninterrupted flow" threshold. Your hover-to-bloom must land under 100 ms.
- **Unified memory**: CPU/GPU share 16 GB with zero-copy. This is a gift for
  signal→texture pipelines and a trap for memory-hungry CNNs.

---

# 0. The frame

Everything you described decomposes into three layers with a clean contract between them.
Keep them separable or the project becomes unshippable.

```
  LAYER A — SENSE            LAYER B — TRANSFORM          LAYER C — FORM
  ──────────────            ───────────────────          ──────────────
  OS telemetry               feature extraction           growth algorithms
  filesystem structure  ──►  FFT / filters / envelopes ──►  L-systems, phyllotaxis
  input (pressure, flow)     correlation, feedback          CNN / NCA / dream
  pixel + video feedback     normalization & mapping        Metal / WebGPU render
        │                            │                            │
        └──────────── feedback loop: rendered pixels re-enter A ───┘
```

The feedback arrow is the interesting part and the part most projects skip. Crutchfield's
video-feedback work (see §6) is the rigorous version of "point the camera at the screen."

**Decisions that are yours, not mine** — I've laid out the full option space for each but
deliberately not picked: (1) which telemetry streams are *semantically* load-bearing vs.
decorative, (2) whether form is *derived* from content or *driven* by system state,
(3) whether the CNN is in the realtime loop or precomputes a lookup, (4) OS-shell vs.
visualizer, (5) how much randomness is honest vs. noise. §8 lists them as a checklist.

---

# 1. LAYER A — The complete data catalog

Columns: **Source** | **How to get it** | **Native rate** | **Privilege** | **Signal character**

"Signal character" = what it looks like as a time series, which determines what DSP is
appropriate. This is the column most people ignore and then wonder why their FFT is garbage.

## A1. Static structure — the filesystem as a graph

You need this for the folder-bloom interaction. It is the *skeleton*; telemetry is the *weather*.

| Source | How | Rate | Privilege | Character |
|---|---|---|---|---|
| Directory tree, sizes, counts | `readdir`, `NSFileManager`, Node `fs.opendir` | on demand | user | static graph; branching factor is your bloom's fan-out |
| Rich metadata (50+ attrs) | `mdls <file>`, `NSMetadataQuery` | on demand | user (Spotlight TCC for some dirs) | categorical + scalar; *the richest free dataset on the machine* |
| Spotlight queries | `mdfind -onlyin DIR "query"` | on demand | user | set membership → clustering |
| UTI / content type | `mdls -name kMDItemContentType`, `UTType` | on demand | user | categorical → species of plant |
| Thumbnails / previews | `qlmanage -t -s 512`, `QLThumbnailGenerator` | ~10–200 ms each | user | **image** → feed to CNN for form selection |
| Extended attributes | `xattr -l`, `ls -l@` | on demand | user | tags, quarantine, provenance |
| Access/modify/create times | `stat -f` | on demand | user | → temporal decay, wilting, fruit ripeness |
| File content entropy | compute: `xz -9 \| wc -c` ratio, or Shannon | ~ms/MB | user | scalar 0–1 → texture roughness, "aliveness" |
| Git state (if repo) | `git log --numstat`, `git blame` | on demand | user | authorship + churn → growth rings |
| App bundle structure | `/Applications/*.app/Contents/` | on demand | user | software-as-organism decomposition |
| Launch Services / frecency | `lsregister -dump`, `~/Library/Preferences` | on demand | user | usage frequency → prominence |

`mdls` is genuinely underused. Run `mdls` on a photo and you get EXIF, GPS, camera, color
space, pixel dims; on audio you get tempo, key, bitrate; on a PDF you get page count and
author. That is a free, structured, per-file feature vector — no CNN needed for a lot of it.

## A2. Process & scheduler — "what the computer is doing"

| Source | How | Rate | Privilege | Character |
|---|---|---|---|---|
| Per-process CPU% | `top -l N -stats`, `ps`, `host_processor_info` | 1–10 Hz | user | spiky, heavy-tailed, non-stationary |
| Thread counts, states | `ps -M`, `proc_pidinfo` | 1–10 Hz | user | integer steps |
| Context switches, syscall counts | `taskinfo`, `sc_usage` | 1–100 Hz | **root** | high-rate impulse train → audify directly |
| Mach task info | `task_info()`, `proc_pid_rusage` | on demand | user (own procs) / root | counters, differentiate before use |
| Run queue depth / load avg | `sysctl vm.loadavg`, `uptime` | 1 Hz (5s smoothed) | user | already low-passed; too slow for visuals |
| Process tree / parentage | `ps -axo pid,ppid,comm` | on demand | user | graph → root system of the plant |
| App lifecycle events | `NSWorkspace` notifications | event-driven | user | discrete events → triggers |

`proc_pid_rusage` is the best per-process source available *without root*: gives you
user/system time, bytes read/written, energy impact, interrupt wakeups. On Apple Silicon it
also reports P-core vs E-core time separately — that's a free "effort" signal.

## A3. CPU / GPU / ANE / power — the physical substrate

| Source | How | Rate | Privilege | Character |
|---|---|---|---|---|
| Package/core power (W) | `sudo powermetrics --samplers cpu_power,gpu_power` | up to **~1 kHz** (`-i 1`) | **root** | the single best signal on the machine: continuous, physical, correlated with everything |
| P/E cluster residency, freq | `powermetrics --samplers cpu_power` | 1–1000 Hz | root | state occupancy → categorical over time |
| GPU residency & freq | `powermetrics --samplers gpu_power` | 1–1000 Hz | root | bursty |
| ANE power | `powermetrics --samplers ane_power` | 1–1000 Hz | root | near-zero until you run Core ML — **self-referential signal** |
| Raw IOReport channels | `IOReportCreateSubscription` (private framework) | ~100 Hz+ | user! | what `asitop`/`macmon` use; no sudo; undocumented |
| Thermal sensors | `IOHIDEventSystemClient` (private) | ~1 Hz | user | slow drift → seasonal/background modulation |
| Battery instantaneous amperage | `ioreg -rn AppleSmartBattery` (19 keys present on your machine) | ~1 Hz | user | whole-system energy proxy, no sudo |
| Fan RPM | n/a — **M3 Air is fanless** | — | — | (noted: you lose this signal entirely) |
| Thermal pressure | `NSProcessInfo.thermalState`, `kern.thermalstate` | event | user | 4-level categorical |

**Your single most important constraint here:** `powermetrics` requires root and spawns a
process; you cannot ship that in a consumer app. IOReport (used unprivileged by `macmon`,
`asitop`) is the real path, but it is a private framework — fine for an art/research project,
blocked for App Store. Decide early which world you're in.

## A4. Memory & VM

| Source | How | Rate | Privilege | Character |
|---|---|---|---|---|
| Page stats (free/active/inactive/wired/compressed) | `vm_stat`, `host_statistics64` | up to 100 Hz | user | slow-moving levels, step changes on alloc |
| Page faults, pageins, COW faults | `vm_stat` deltas | 100 Hz | user | **impulse train — ideal for audification** |
| Swap / compressor | `sysctl vm.swapusage`, `vm.compressor_*` | 1 Hz | user | slow, threshold-y |
| Per-process footprint | `footprint <pid>`, `proc_pid_rusage` | on demand | user/root | levels |
| Heap structure | `heap <pid>` | on demand (expensive) | root-ish | categorical histogram — zone sizes |
| Memory pressure | `kern.memorystatus_vm_pressure_level` | event | user | 3-level |

Your page size is **16384 bytes** (confirmed by probe). Page-fault counts are the closest
thing you have to a free-running high-frequency pulse train from the memory system.

## A5. Storage I/O & filesystem events — "data moving"

| Source | How | Rate | Privilege | Character |
|---|---|---|---|---|
| Every file op, system-wide | `sudo fs_usage -w` | **event, up to 10k/s** | **root** | the firehose; pure event stream w/ path, pid, bytes, duration |
| Filesystem change notifications | FSEvents API, `fswatch` | event, coalesced ~1s | user | debounced; good for structure updates, bad for rhythm |
| Per-volume throughput | `iostat -d -w 1` | 1 Hz | user | levels |
| Disk latency distribution | `sudo latency`, `iosnoop`-style DTrace | event | root | **latency histogram → timbre**; this is where "how data is transformed/packaged/moved" lives |
| VFS-level traces | DTrace `io:::start` / `syscall::*` | event | root + SIP off for most probes | richest; SIP blocks you today |
| Endpoint Security events | `EndpointSecurity.framework` | event | **Apple-granted entitlement** + TCC | production-grade `fs_usage`; needs provisioning from Apple |

**This is the answer to your "flow of data across the computer's components" question.** The
honest hierarchy on macOS 15.5 with SIP on:
1. `fs_usage` as root — works today, gives you path + pid + bytes + duration per op. **Start here.**
2. `ktrace`/kdebug — the underlying mechanism; `fs_usage`, `latency`, `sc_usage` are all
   consumers of it. You can write your own kdebug consumer for a custom event subset.
3. DTrace — broadest, but SIP blocks the useful probes. Disabling SIP is a real option for a
   research machine; understand you're trading your machine's security posture for it.
4. EndpointSecurity — the only *shippable* path, and it requires Apple to grant you an
   entitlement. Months of lead time.

## A6. Network — "packaging and moving data elsewhere"

| Source | How | Rate | Privilege | Character |
|---|---|---|---|---|
| Per-process bytes in/out | `nettop -P -L 1 -x` | up to ~10 Hz | **user — confirmed working on your machine** | per-app counters; differentiate for rate |
| Per-connection RTT, retx, dupe, OOO, cwnd | `nettop -x` columns | ~1 Hz | user | **this is the "packaging" signal**: retransmits, out-of-order, congestion window |
| Packet capture | `tcpdump`, `libpcap` | per-packet, µs timestamps | root | the real firehose; payload sizes → amplitude, IAT → rhythm |
| Interface counters | `netstat -ib` | poll | user | cumulative |
| DNS resolutions | `log stream --predicate 'subsystem == "com.apple.network"'` | event | user | discrete semantic events — "reaching out" |
| NetworkExtension filter | `NEFilterDataProvider` | per-flow | entitlement + TCC | shippable packet inspection |

I confirmed `nettop -P -L 1 -x` runs **without sudo** on your machine and emits
`bytes_in,bytes_out,rx_dupe,rx_ooo,re-tx,rtt_avg,rcvsize,tx_win,cc_algo` per process. That
column set is a ready-made multichannel signal: throughput (level), RTT (slow continuous),
retransmits (impulses), congestion window (sawtooth — literally TCP's AIMD sawtooth, a
beautiful native waveform).

## A7. Graphics pipeline / windows / compositor

| Source | How | Rate | Privilege | Character |
|---|---|---|---|---|
| Window list, titles, bounds, layer | `CGWindowListCopyWindowInfo` | poll ~60 Hz | Screen Recording TCC for titles | geometric; the "shape" of your desktop |
| Full UI element tree | `AXUIElement` Accessibility API | on demand | Accessibility TCC | **hierarchical semantic tree of every app's UI** — hugely underused |
| Screen pixels | `ScreenCaptureKit` (`SCStream`) | up to display rate, zero-copy IOSurface | Screen Recording TCC | **video signal — your pixel feedback source** |
| Frame timing / vsync | `CADisplayLink` (macOS 14+) | 60 Hz | user | your clock |
| GPU counters | Metal `MTLCounterSampleBuffer`, Instruments | per-encoder | user (needs Xcode for Instruments) | per-draw timing |
| Metal HUD | `MTL_HUD_ENABLED=1` env var | per-frame | user | free FPS/latency overlay on any app |
| Display brightness / color | `CoreDisplay`, `CGDisplay*` | poll | user | scalar |
| Dock/Space/Mission Control state | private `SkyLight`/`CGS*` (yabai's approach) | event | SIP-dependent | window-management hooks |

**Note for you specifically:** you have Command Line Tools, not full Xcode. Instruments, the
Metal debugger, GPU frame capture, and signing with entitlements all need the full Xcode
install (~8 GB). Budget for that.

## A8. Input — the 3D-Touch dimension

This is the core of your idea and the news is good.

| Source | How | Rate | Privilege | Character |
|---|---|---|---|---|
| **Trackpad pressure** | `NSEvent.pressure` (0.0–1.0 float) | ~120 Hz | user | **continuous analog** — the real 3D Touch equivalent |
| **Force Touch stage** | `NSEvent.stage` (0,1,2), `stageTransition` | event | user | discrete detents + fractional transition |
| Pressure behavior config | `NSEvent.setPressureConfiguration`, `NSPressureBehavior` | — | user | `.primaryDeepClick`, `.primaryGeneric`, `.primaryAccelerator` |
| Haptic output | `NSHapticFeedbackManager` | event | user | **output channel** — close the loop physically |
| Raw multitouch: all fingers, x/y, ellipse major/minor, angle, per-finger pressure | private `MultitouchSupport.framework` (`MTDeviceCreateList`, `MTRegisterContactFrameCallback`) | **~125 Hz** | user, private API | the full contact blob — finger area, orientation, velocity |
| Cursor position/velocity | `CGEventTap`, `NSEvent` global monitor | 60–1000 Hz | Accessibility/Input Monitoring TCC | **continuous 2D** — your scroll/hover driver |
| Scroll wheel w/ momentum phase | `NSEvent.phase`, `momentumPhase`, `scrollingDelta` | ~120 Hz | user | phase machine: began/changed/ended + inertia |
| Keystroke timing | `CGEventTap` | event, µs | Input Monitoring TCC | rhythm; **privacy-sensitive, handle carefully** |
| Gyro/accel | n/a on Mac | — | — | (not available) |
| Ambient light sensor | `IOHIDEventSystem`, `AppleLMUController` | ~1 Hz | user | slow drift |
| Camera | `AVFoundation`, `Vision` (face/hand pose) | 30–60 Hz | Camera TCC | your "hands-free HCI" and eye-tracking note |

**`NSEvent.pressure` is the single highest-value input on this list for you.** Apple's Force
Touch trackpad reports genuine continuous pressure, 0–1, at trackpad polling rate. Your
"micro-dosing / tripping" note and your "intensity control" note (sketch #5) both map onto
it directly. `MultitouchSupport` gives you finger *contact area* too — press harder, finger
flattens, ellipse grows. That's a second, independent pressure channel for free.

## A9. Audio

| Source | How | Rate | Privilege | Character |
|---|---|---|---|---|
| Mic input | Core Audio / AVAudioEngine | 44.1–48 kHz | Mic TCC | true audio-rate |
| **System output tap** | `CATapDescription` / Core Audio taps (macOS 14.2+) | 48 kHz | TCC | capture what the machine is playing — no BlackHole needed |
| Per-app audio activity | `AudioObjectGetPropertyData` | poll | user | level |

The system-output tap API (macOS 14.2+) is new and relevant: your visualizer can hear the
computer without a virtual-device hack.

## A10. The gap you'll hit

What you **cannot** get on macOS, so stop looking: per-instruction traces, cache
miss/hit counters without Instruments' privileged counters, DRAM bus activity, PCIe-level
transfer events, per-core temperature on Apple Silicon at useful rates, and any pre-SIP-era
kernel introspection. If data at that resolution is essential to the concept, your honest
options are (a) run the visualizer against a **Linux** box with eBPF/perf, or (b) run against
an **emulator/VM** you instrument fully, or (c) accept macOS's resolution ceiling.

---

# 2. LAYER B — Signal processing: telemetry → drivable control signals

You know FFT/DFT, convolution, filters, feedback. Here's the part that's specific to
*system telemetry*, which behaves nothing like audio.

## B1. Why naive FFT fails on telemetry

System signals are: **non-stationary** (regime changes, not steady tones), **heavy-tailed**
(a single event can be 1000x the median), **irregularly sampled** (events, not frames),
**counter-based** (cumulative — must differentiate), and **sparse** (long silences).

Fixes, in order of importance:
1. **Differentiate counters** before anything else. `bytes_in` is cumulative; you want `d/dt`.
2. **Compress dynamic range**: `log1p(x)` or `x^0.3`. Non-negotiable for CPU%, I/O, network.
3. **Resample events onto a uniform grid** before FFT (or use Lomb–Scargle for irregular data).
4. **Detrend / high-pass** to remove DC and slow drift, or your spectrum is one giant bin 0.
5. **Window** (Hann) and use short windows — 1–4 s, hop 1 frame. Regimes change fast.

## B2. Feature extraction menu

Per stream, the features you can derive — each is a potential visual driver:

| Family | Features | Good for |
|---|---|---|
| Level | mean, RMS, peak, percentile, envelope follower (attack/release) | size, brightness, thickness |
| Rate | first difference, EWMA rate, Poisson intensity λ | growth speed, flow |
| Spectral | magnitude spectrum, centroid, spread, flatness, rolloff, flux | color, texture roughness, "mood" |
| Time-freq | STFT spectrogram, CQT, wavelet (Morlet/Daubechies), scalogram | **the 2D image you feed a CNN** |
| Statistical | variance, skew, kurtosis, entropy, Hurst exponent | chaos/order axis |
| Event | inter-arrival time distribution, burstiness B = (σ−μ)/(σ+μ), Fano factor | rhythm, stutter |
| Correlation | cross-correlation, coherence, transfer entropy, Granger causality | **"which component causes which"** — your data-flow map |
| Dimensional | PCA, UMAP, t-SNE over multichannel telemetry | the latent space you navigate |
| Nonlinear | phase-space embedding (Takens), recurrence plots, Lyapunov exponent | your "spatio-temporal attractors" note |

**Takens embedding + recurrence plots deserve special attention** given your attractor sketch:
take one scalar telemetry stream, embed it as (x(t), x(t−τ), x(t−2τ)), and you get a 3D
trajectory — a literal strange attractor *made of your computer's behavior*. Recurrence plots
turn any 1D signal into a 2D texture, which is then CNN-feedable. This is the most direct
bridge between "signal processing" and "weird visual" in your whole stack.

## B3. The mapping taxonomy (from sonification, applies identically to visuals)

From Hermann/Hunt/Neuhoff's *Sonification Handbook*, the four canonical strategies — pick
consciously, don't drift:
1. **Audification/visification** — raw samples straight to the medium. (Your raster sonification.)
2. **Parameter mapping** — feature → visual parameter. Easy, and the one that becomes arbitrary.
3. **Model-based** — build a virtual physical/biological system, let data *excite* it. The data
   perturbs a plant-growth model rather than setting its parameters. **This is what makes your
   flower idea coherent rather than decorative.**
4. **Earcons/icons** — discrete symbolic events.

Mapping hygiene that separates good from bad here: **polarity** (more = more, consistently),
**perceptual scaling** (visual size is perceived ~ area^0.7, not linearly; use CIELAB/OKLab
for color, not RGB), **orthogonality** (two data channels must not collide on one perceptual
channel), and **a legend** — even in art, the viewer should be able to *learn* the mapping.

## B4. Feedback topologies — the thing you explicitly asked about

| Topology | Mechanism | Reference |
|---|---|---|
| Video feedback | render → capture frame → warp/filter → blend into next frame | Crutchfield 1984 |
| Pixel-rate feedback | fragment shader samples previous frame texture | any Shadertoy "buffer A" |
| Optical-flow feedback | compute flow between frames, advect the next frame by it | Farnebäck / RAFT |
| Resonant/physical | model mass-spring or reaction-diffusion, inject data as force | Gray-Scott RD |
| CNN feedback | DeepDream the frame, feed the dream back as input | gradient ascent loop |
| Human-in-loop | user's pressure/motion changes system load → changes telemetry → changes visuals | **your most interesting loop** |

That last one is the strongest idea in your notes and you didn't name it: **the UI's own
rendering consumes GPU, which shows up in GPU telemetry, which drives the UI.** A genuinely
self-referential interface. ANE power is even cleaner — it's ~0 until *your own* CNN runs.
Design the gain carefully or it oscillates; that's a control-theory problem (add damping, a
low-pass on the feedback path, or deliberately let it oscillate at a chosen frequency).

**Stability note:** every feedback loop here needs a gain < 1 somewhere, or clamping.
Crutchfield's paper is literally about the bifurcation structure of this.

---

# 3. LAYER C — Generative form

## C1. Growth algorithms (the flower/tree/climber vocabulary)

Non-CNN, fast, controllable, and far more likely to look *designed* than a raw CNN:

| Algorithm | What it gives | Cost | Data hook |
|---|---|---|---|
| **L-systems** | branching plants, grammar-defined | trivial | rule probabilities, angles, depth ← folder depth/branching |
| **Space colonization** (Runions 2007) | realistic trees/venation that grow *toward attractors* | cheap | **place an attractor per file — the tree grows to reach its children** |
| **Phyllotaxis** (golden angle 137.5°) | sunflower/leaf packing | trivial | n items → perfect non-overlapping radial layout |
| **Differential growth** | curling, rippling, coral/leaf edges | medium | growth rate ← activity |
| **Reaction–diffusion** (Gray–Scott) | spots, stripes, Turing patterns | GPU-cheap | feed rate F / kill rate k ← telemetry |
| **Physarum / slime mold agents** (Jones 2010) | **transport networks between nodes** | GPU-cheap | **literally a model of data moving between components** |
| **Strange attractors** (Lorenz, Clifford, De Jong) | your sketch's dense spirals | trivial | parameters ← telemetry |
| **Neural Cellular Automata** (Mordvintsev 2020) | learned growth — a *trained* organism that regenerates | small net, GPU | **"flower born out of a folder" — this is exactly the paper** |
| **Boids / flocking** | swarm transitions | cheap | cohesion ← correlation |
| **Force-directed graph** | the fallback; honest but generic | medium | edges ← actual dependency |

My read: **space colonization + phyllotaxis for layout, physarum for the data-flow layer,
NCA for the bloom animation** is the combination that matches your sketches most closely.
That's an observation, not a decision — see §8.

## C2. Model options, with realistic M3 latency

| Model | Role | Realtime on M3? | Notes |
|---|---|---|---|
| **MobileNetV3 / EfficientNet-lite** (Core ML, ANE) | thumbnail → feature vector → form params | **yes, ~1–5 ms on ANE** | your sketch's "CNN for shape/form selection" |
| **CLIP ViT-B/32** (Core ML) | semantic embedding of file content | ~10–20 ms | gives you a *meaningful* latent space to map to form |
| **DeepDream** (gradient ascent on Inception layers) | texture hallucination | 50–500 ms/frame | too slow per-frame at full res; run at 256px or precompute |
| **Fast style transfer** (Johnson 2016) | realtime stylization | **yes, ~10–30 ms @ 512px** | the realtime-capable "dream" |
| **Neural Cellular Automata** | growth animation | **yes, ~1 ms/step** | tiny net (~8k params), runs in a shader |
| **CPPN** (Differentiable Image Params, Distill) | infinite-resolution procedural texture from a tiny net | **yes** | resolution-independent — good for your "resize as they happen" |
| **Feature visualization / lucid** | *what* a layer sees | offline | use to build your form vocabulary, not at runtime |
| **Diffusion (SD-Turbo etc.)** | image synthesis | ~200ms–1s/frame | **not realtime for UI**; precompute only |
| **Optical flow (RAFT-small)** | motion field from video feedback | ~20–50 ms | or use classical Farnebäck for 5 ms |
| **Vision framework** (hand pose, face, saliency) | hands-free HCI, eye proxy | 10–30 ms | built into macOS, free, no model shipping |

**The latency budget forces an architecture decision**: CNN *cannot* be in the 16 ms frame
loop at high resolution. Three valid answers — (a) tiny nets on ANE only (MobileNet/NCA/CPPN),
(b) CNN runs async at 5–10 Hz and its output is a slowly-varying control signal that cheap
shaders interpolate between, (c) CNN precomputes a **lookup table / codebook** offline and
runtime is pure table lookup. (b) and (c) are how shipping products do it.

**Note on "DeepDream or better":** DeepDream is 2015 and its aesthetic is extremely dated and
instantly recognizable. Successors worth your time: *Differentiable Image Parameterizations*
(Distill 2018) generalizes it properly; *Self-Organising Textures* (Distill 2021) is NCA
trained with a DeepDream-style objective and is **both newer and faster**; CLIP-guided
optimization gives you semantic control DeepDream never had.

---

# 4. The interaction: full parameter space of the "3D-touch bloom"

Your sketch #3 (nested rounded squares, dashed expansion, arrow) is progressive disclosure
with semantic zoom. Here is the complete set of knobs. Decide each one deliberately.

**Trigger**
- Modality: hover-dwell | scroll-over | trackpad pressure | force-click stage | key-modifier +
  hover | gaze | hand pose
- Threshold: pressure value, dwell ms, scroll delta accumulation
- Hysteresis: open at 0.6, close at 0.4 — **essential**, or it flickers
- Intent prediction: cursor velocity + direction (a decelerating cursor = intent to land)

**Expansion**
- Geometry: radial/pie | phyllotaxis spiral | tree branch | force-directed | grid-morph | organic blob
- Fan-out: how many children shown (all | top-k by relevance | log-scaled)
- Overflow: scroll | cluster into "+37 more" | shrink | fisheye-distort
- Depth: how many levels alive simultaneously (your sketch shows 3+ nested)
- Persistence: do parents stay visible (focus+context) or collapse (drill-down)?
- Coordinate frame: anchored to cursor | anchored to item | screen-stable

**Motion**
- Easing: spring (mass/stiffness/damping) vs cubic-bezier — **springs, because they're
  interruptible mid-flight**, which is what "resize as they happen" requires
- Stagger: per-child delay (growth looks alive with 10–30 ms stagger)
- Duration: 150–400 ms is the window where it reads as *fast* and still legible
- Interruption policy: what happens when the user moves before the animation finishes

**Content / semantic zoom**
- LOD ladder: icon → thumbnail → thumbnail+metadata → preview → live content
- What is a "fruit" (the focused item) vs "leaf" (sibling) vs "climber" (path)?
- Preview fidelity vs cost: `qlmanage` thumbnails are 10–200 ms — **must be prefetched**

**Navigation**
- Commit: click | pressure stage 2 | dwell | gesture flick
- Back/undo: how do you un-descend? (this is where ZUIs historically fail users)
- Marking-menu style muscle memory: can an expert do it without looking? (Kurtenbach's work
  shows this is the difference between a toy and a tool)

**Performance**
- Prefetch policy: on hover, speculatively load children *and* grandchildren of the nearest 3
- Cache: thumbnail pyramid, LRU, memory ceiling
- Cancellation: when the cursor leaves, kill in-flight work immediately
- Render path: one draw call per bloom via instancing, not N draw calls

**The randomness question** (your "weird, slightly random" ask)
- Seeded-deterministic per item (same folder blooms the same way every time) vs
  per-session random. **Deterministic is almost certainly right** — users build spatial memory,
  and randomness that breaks recall is the single fastest way to make a UI hostile. Keep
  randomness in *texture/ornament*, keep *topology/position* stable. (See Data Mountain, §6:
  spatial memory is the whole reason that interface worked.)

---

# 5. Direction 1 (OS/shell) vs Direction 2 (visualizer)

## 5a. What "a new OS UI" actually means on macOS 15.5 + SIP enabled

What you **cannot** do: replace Finder, replace WindowServer/the compositor, draw below
other apps' windows, intercept all input system-wide without TCC, or ship any of the private
frameworks above through the App Store.

What you **can** do, in increasing order of ambition:
1. **Full-screen app** that *is* the shell while focused (`NSApplication.presentationOptions`
   to hide Dock/menubar). 90% of the experience, 10% of the pain. **Start here.**
2. **Floating overlay** at a high window level, click-through where transparent
   (`NSWindow.level = .screenSaver`, `ignoresMouseEvents`) — a Spotlight-style summoned layer.
3. **Finder integration** — Finder Sync extension (badges/menus), QuickLook extension
   (custom previews), Quick Actions. Narrow but genuinely *in* the OS.
4. **Window manager** — `yabai`-style using private SkyLight/CGS APIs. Full window control
   requires partially disabling SIP on modern macOS.
5. **Actual alternative OS shell** — this means **Linux**. The real reference is **Arcan**
   (Björn Ståhl), a display server built specifically for non-conventional desktops, with
   *Pipeworld* (a zoomable, cell/dataflow-based desktop) and *Safespaces* (3D/VR desktop) as
   working proof. If you are serious about "a new type of OS", Arcan or a Wayland compositor
   (wlroots / Smithay in Rust) is where that work actually happens.

## 5b. Honest comparison

| | Visualizer | OS/shell |
|---|---|---|
| Time to something real | weeks | months–years |
| Telemetry access | full (you can require sudo) | constrained (must be unprivileged) |
| Evaluation | aesthetic; easy to demo | usability; needs real users, real tasks |
| Failure mode | pretty but meaningless | meaningful but unusable |
| Power cost | you don't care | **you care enormously — see §7** |
| Risk | low | high |

They are not exclusive and you already said the visualizer is a component of the OS. The
sequencing that protects you: **build the visualizer first as the "instrument panel," build
the bloom interaction second as a standalone app, merge third.** Each stage is independently
demo-able and gradeable.

---

# 6. Reading list, clustered

## 6a. Zoomable UIs, focus+context, progressive disclosure — your interaction's lineage
- Furnas, "Generalized Fisheye Views" (CHI 1986) — the founding focus+context paper.
- Bederson & Hollan, "Pad++: A Zooming Graphical Interface" (UIST 1994); also Pad++ → Jazz → Piccolo toolkits.
- Perlin & Fox, "Pad: An Alternative Approach to the Computer Interface" (SIGGRAPH 1993).
- Lamping, Rao & Pirolli, "A Focus+Context Technique Based on Hyperbolic Geometry" (CHI 1995).
- Robertson, Mackinlay & Card, "Cone Trees" (CHI 1991).
- Robertson et al., "Data Mountain" (UIST 1998) — spatial memory in document management.
- Shneiderman, "The Eyes Have It" (1996) — overview first, zoom+filter, details on demand.
- Card, Robertson & Mackinlay, "The Information Visualizer" (CHI 1991) — the 0.1/1/10 s thresholds.
- Jef Raskin, *The Humane Interface* (2000) + the Archy/THE project — ZUI as a whole OS.
- **Eagle Mode** — an actual working zoomable filesystem/OS browser. Download and use it; it
  will teach you more in an hour than any paper.
- **BumpTop** (Agarawala & Balakrishnan, CHI 2006) — physics-based desktop; later acquired by Google.
- Kurtenbach & Buxton, "The Limits of Expert Performance Using Hierarchic Marking Menus" (CHI 1993).
- Grossman & Balakrishnan, "The Bubble Cursor" (CHI 2005); Accot & Zhai, steering law (CHI 1997).
- Pirolli & Card, "Information Foraging" (Psych Review 1999) — *why* progressive disclosure works.
- Willett, Heer & Agrawala, "Scented Widgets" (InfoVis 2007) — cues about what's inside before you open it. **Directly your problem.**

## 6b. Visualization of computation / system state
- **Arcan** display server + **Pipeworld** + **Safespaces** (Björn Ståhl) — the most serious
  existing attempt at a reimagined desktop. Read the "Arcan vs Wayland/X" essays.
- Plan 9 from Bell Labs — "everything is a file," the cleanest existing model of a computer
  as a uniform namespace you could visualize.
- Smalltalk-80 / Self / Morphic — live, directly-manipulable object worlds.
- Bret Victor: *Magic Ink*, *Media for Thinking the Unthinkable*, *Stop Drawing Dead Fish*, Dynamicland.
- Engelbart, "Mother of All Demos" (1968); Apple's *Knowledge Navigator* (1987) and Sun's *Starfire* (1994) — UI fiction done seriously.
- `htop` / `glances` / `asitop` / `macmon` / `bottom` — read **macmon's and asitop's source**
  for the unprivileged IOReport technique specifically.
- Peep (The Network Auralizer), Ballora et al. on network sonification — prior art for A6.

## 6c. Generative form
- Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants* (free PDF online). **Primary source.**
- Runions et al., "Modeling Trees with a Space Colonization Algorithm" (2007); and their leaf-venation paper (2005).
- Turing, "The Chemical Basis of Morphogenesis" (1952); Gray–Scott RD; Karl Sims, "Reaction-Diffusion Tutorial."
- Jeff Jones, "Characteristics of Pattern Formation... Physarum Transport Networks" (2010) — the slime-mold algorithm.
- Mordvintsev et al., "Growing Neural Cellular Automata" (Distill 2020) and "Self-Organising Textures" (Distill 2021).
- Flake, *The Computational Beauty of Nature*; Shiffman, *The Nature of Code* (p5.js — matches your current stack exactly).

## 6d. CNN / dream / feature visualization
- Mordvintsev, Olah & Tyka, "Inceptionism: Going Deeper into Neural Networks" (2015) — DeepDream.
- Olah et al., "Feature Visualization" (Distill 2017) and "Differentiable Image Parameterizations" (Distill 2018) — **the rigorous version of DeepDream; includes CPPNs.**
- Gatys, Ecker & Bethge, "A Neural Algorithm of Artistic Style" (2015); Johnson et al., "Perceptual Losses..." (ECCV 2016) — the realtime version.
- Zeiler & Fergus, "Visualizing and Understanding Convolutional Networks" (ECCV 2014).
- Memo Akten, "Learning to See" and his PhD thesis on deep learning as an artistic medium — closest existing work to what you're describing.

## 6e. Signal processing, feedback, video
- Hermann, Hunt & Neuhoff, *The Sonification Handbook* (2011) — **free online; read ch. 1–4, 15–16.** The mapping taxonomy in §B3 is from here.
- Crutchfield, "Space-Time Dynamics in Video Feedback" (Physica D, 1984) — the rigorous analysis of video feedback.
- Wu et al., "Eulerian Video Magnification" (SIGGRAPH 2012); Davis et al., "Interactive Dynamic Video" (SIGGRAPH 2015) — **extracting physical/modal structure from pixel signals; directly your "video signal feedback" idea.**
- Farnebäck optical flow (2003); RAFT (ECCV 2020).
- Takens embedding; Eckmann, Kamphorst & Ruelle, "Recurrence Plots of Dynamical Systems" (1987).
- Golan Levin, "An Informal Catalogue of Slit-Scan Video Artworks" — your raster/scan interests.

## 6f. Artists to look at before you design anything
Ryoji Ikeda (*datamatics*, *test pattern* — data as raster, rigorous), Refik Anadol (real
sensor/archive data as sculpture — and read the critiques, they're instructive), Casey Reas,
Golan Levin, Zach Lieberman, Mario Klingemann, Memo Akten, Lia, Manfred Mohr, John Whitney
(*Digital Harmony* — the mathematics of motion).

## 6g. Tools
TouchDesigner (the fastest path to realtime signal→visual; has CHOP operators built for
exactly the Layer-B work and can ingest OSC from a telemetry daemon), Hydra (Olivia Jack —
live-coded video feedback in the browser), openFrameworks, Processing/p5, Max/MSP+Jitter,
Shadertoy, three.js/WebGPU, Metal + SwiftUI, Rust + wgpu / Bevy.

---

# 7. Pathway, and what "Apple-grade" actually means

## 7a. The numeric bar
If your claim is "an Apple-grade computer could ship this," these are the real targets:
- **Idle cost: ~0%.** Not 2%. A shell that burns 3% CPU idle costs every user battery life
  forever. Event-driven, not polling. This is the bar that kills most ambient-UI projects.
- **Frame: < 16.67 ms**, p99, on *your* 60 Hz M3 Air, while other apps are running.
- **Input-to-photon: < 50 ms.** Hover-to-first-pixel-of-bloom < 100 ms.
- **Memory: < 150 MB** resident for the shell; thumbnail cache bounded and evictable.
- **Thermals**: fanless M3 Air. Sustained GPU load throttles. Your visualizer must degrade
  gracefully under `thermalState`.
- **Accessibility**: VoiceOver-navigable, Reduce Motion honored (your entire aesthetic must
  have a static fallback), Increase Contrast, keyboard-only path. Non-optional at Apple.
- **Privacy**: every TCC permission you require is a user who says no. Design the degraded path.
- **Determinism**: same folder → same bloom. See §4.

## 7b. Skill ladder (gaps between where you are and that bar)
You have: p5/JS, FFT/DFT, convolution/filters, DeepDream, raster sonification, feedback.
You need, roughly in order:
1. **Shader programming** (GLSL → WGSL/Metal). Non-negotiable; everything realtime lives here.
2. **A systems language** — Swift (best macOS access) or Rust (best portability). Your telemetry
   daemon cannot be JS.
3. **Core ML + `coremltools`** to get PyTorch models onto the ANE. (You have *no* Python ML
   stack installed — `numpy`, `scipy`, `torch`, `coremltools`, `cv2`, `PIL` are all missing.)
4. **macOS frameworks**: AppKit/SwiftUI, Core Animation, Metal, ScreenCaptureKit, IOKit.
5. **Realtime profiling** — Instruments (needs full Xcode), Metal System Trace.
6. **Control theory basics** — for stable feedback loops and springs.

## 7c. Suggested milestones (each independently demo-able)
- **M0 — Instrument.** A daemon that samples 6–10 streams (nettop, vm_stat, proc_rusage,
  pressure, FSEvents, battery amperage) at 10–60 Hz and emits JSON/OSC on a socket. Nothing
  visual. This de-risks everything.
- **M1 — Scope.** Dumb plots of every stream. You *must* see the raw signals before mapping
  them. Most of your design decisions become obvious here.
- **M2 — Bloom, static.** Folder → phyllotaxis/space-colonization layout, hover + `NSEvent.pressure`
  to expand, springs, no telemetry, no CNN. Make it feel *fast*. This is the hardest part and
  it has nothing to do with CNNs.
- **M3 — Form from content.** MobileNet or CLIP via Core ML on `qlmanage` thumbnails →
  embedding → growth parameters. Your sketch #4's "CNN for shape/form selection."
- **M4 — Weather.** Telemetry from M0 modulates M2/M3 — as *perturbation of a growth model*
  (model-based mapping), not direct parameter mapping.
- **M5 — Feedback.** ScreenCaptureKit captures your own output → optical flow / dream → re-enters.
  Close the self-referential loop (§B4).
- **M6 — Shell.** Full-screen presentation mode, keyboard nav, accessibility, power budget.

**Start M0 today**; it's a day of work and every subsequent decision depends on seeing real
data. Everything you install for it (`numpy`/`scipy`/`torch`/`coremltools` via `pip`, full
Xcode, `ffmpeg`) is a prerequisite you don't currently have.

---

# 8. The decisions I deliberately did not make for you

1. **Is form derived from content, or from system state, or both?** If both, which gets
   topology and which gets ornament? (§3, §4)
2. **Is the CNN in the realtime loop, async at low rate, or precomputed into a lookup?** (§C2)
   This is an *architecture* decision and it is irreversible-ish.
3. **Which 5–8 telemetry streams are load-bearing?** You cannot use all of §1. Pick the ones
   whose meaning the user could actually learn.
4. **Parameter mapping or model-based mapping?** (§B3) I think model-based is what your flower
   sketch actually wants, but it's 5x the work.
5. **Root/private-API research project, or shippable sandboxed app?** (§1 A3/A5, §5a) This
   determines half of §1's availability.
6. **Deterministic or random per session?** (§4, last block)
7. **macOS-only, or Linux for real telemetry depth / real shell replacement?** (§A10, §5a)
8. **Visualizer first or shell first?** (§5b)
9. **How does the user get *back out*?** Historically the fatal flaw of every ZUI. Your sketches
   don't show it.
10. **What is the evaluation criterion?** "Weird and beautiful" and "a better file manager" are
    different projects with different success conditions. Pick, or the critique writes itself.
