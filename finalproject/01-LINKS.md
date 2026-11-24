# Links for 00-RESEARCH-MAP.md §6

**Link hygiene:** entries marked ✅ were link-checked by search on 2026-11-12. Entries
marked ◇ are canonical URLs I'm confident in but did not re-verify. Where a paper sits
behind the ACM/IEEE paywall I give the exact citation rather than a guessed URL —
search the title, or use your university library proxy / Sci-Hub-equivalent as you
prefer. A precise citation ages better than a deep link.

---

## 6a. Zoomable UIs, focus+context, progressive disclosure

| Work | Where |
|---|---|
| Bederson & Hollan, *Pad++: A Zooming Graphical Interface for Exploring Alternate Interface Physics*, UIST '94, pp. 17–26 | ✅ [PDF](https://www.lri.fr/~mbl/Teach/SituatedComputing/2017/papers/ZUI/pad++-uis94-p17-bederson.pdf) · ✅ [HCIL Pad++ project, all papers + source](https://www.cs.umd.edu/projects/hcil/pad++/) |
| Bederson et al., *Pad++: A Zoomable Graphical Sketchpad*, J. Visual Languages & Computing 7(1), 1996, 3–31 | ✅ [HCIL page](https://www.cs.umd.edu/projects/hcil/pad++/papers/jvlc-96-pad/index.html) |
| Perlin & Fox, *Pad: An Alternative Approach to the Computer Interface*, SIGGRAPH '93 | ✅ [NYU MRL PDF](https://mrl.cs.nyu.edu/publications/zooming/zooming.pdf) |
| Shneiderman, *The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations*, IEEE VL '96, 336–343. DOI 10.1109/VL.1996.545307 | ✅ [PDF](https://webspace.science.uu.nl/~telea001/uploads/VACourse/Shneiderman96.pdf) · ✅ [UMD DRUM](https://drum.lib.umd.edu/items/155a868e-fb83-4115-9899-9187ea8c0498) |
| Furnas, *Generalized Fisheye Views*, CHI '86, 16–23 | ACM DL — the founding focus+context paper |
| Lamping, Rao & Pirolli, *A Focus+Context Technique Based on Hyperbolic Geometry*, CHI '95 | ACM DL |
| Robertson, Mackinlay & Card, *Cone Trees: Animated 3D Visualizations of Hierarchical Information*, CHI '91 | ACM DL |
| Robertson et al., *Data Mountain: Using Spatial Memory for Document Management*, UIST '98 | ACM DL — **read this one for the determinism argument in §4** |
| Card, Robertson & Mackinlay, *The Information Visualizer, an Information Workspace*, CHI '91 | ACM DL — source of the 0.1 s / 1 s / 10 s thresholds |
| Kurtenbach & Buxton, *The Limits of Expert Performance Using Hierarchic Marking Menus*, CHI '93 | ACM DL |
| Grossman & Balakrishnan, *The Bubble Cursor*, CHI '05 | ACM DL |
| Accot & Zhai, *Beyond Fitts' Law: Models for Trajectory-Based HCI Tasks*, CHI '97 (steering law) | ACM DL |
| Agarawala & Balakrishnan, *Keepin' It Real: Pushing the Desktop Metaphor with Physics, Piles and the Pen*, CHI '06 (BumpTop) | ACM DL |
| Willett, Heer & Agrawala, *Scented Widgets: Improving Navigation Cues with Embedded Visualizations*, InfoVis '07 | ACM DL / Heer's site — **cues about what's inside before you open it; squarely your problem** |
| Pirolli & Card, *Information Foraging*, Psychological Review 106(4), 1999 | widely mirrored PDF |
| Jef Raskin, *The Humane Interface* (2000); the Archy / THE project | book; archive.org has Archy material |
| **Eagle Mode** — a working zoomable filesystem/OS browser, GPL3, builds on macOS | ✅ <https://eaglemode.sourceforge.net/> — **install it and use it for an hour** |

## 6b. Visualizing computation, alternative desktops

| Work | Where |
|---|---|
| **Arcan** display server / desktop engine (Björn Ståhl) | ✅ <https://arcan-fe.com/> · ✅ [github.com/letoram/arcan](https://github.com/letoram/arcan) |
| **Pipeworld** — zoomable dataflow/cell desktop on Arcan | ✅ [Introducing Pipeworld](https://arcan-fe.com/2021/04/12/introducing-pipeworld) · ✅ [github.com/letoram/pipeworld](https://github.com/letoram/pipeworld) |
| **Safespaces** — 3D/VR desktop on Arcan | ✅ [github.com/letoram/safespaces](https://github.com/letoram/safespaces) |
| `asitop` — Apple-Silicon power/perf monitor (Python, powermetrics-based) | ◇ <https://github.com/tlkh/asitop> |
| `macmon` — same idea in Rust, **unprivileged via IOReport** | ◇ <https://github.com/vladkens/macmon> — **read this for the no-sudo power path** |
| `yabai` — macOS WM via private SkyLight/CGS APIs | ◇ <https://github.com/koekeishiya/yabai> — read it for what SIP blocks |
| Bret Victor — *Magic Ink*, *Media for Thinking the Unthinkable*, *Stop Drawing Dead Fish* | ◇ <https://worrydream.com/> |
| Dynamicland | ◇ <https://dynamicland.org/> |
| Plan 9 from Bell Labs — "everything is a file" as a visualizable namespace | ◇ <https://9p.io/plan9/> |
| Engelbart, *The Mother of All Demos* (1968) | ◇ Doug Engelbart Institute, YouTube |

## 6c. Generative form

| Work | Where |
|---|---|
| Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants* — **free, primary source** | ◇ <http://algorithmicbotany.org/papers/abop/abop.pdf> |
| Runions, Lane & Prusinkiewicz, *Modeling Trees with a Space Colonization Algorithm*, Eurographics WS on Natural Phenomena 2007, 63–70 | ✅ [page](https://algorithmicbotany.org/papers/colonization.egwnp2007.html) · ✅ [PDF](https://www.algorithmicbotany.org/papers/colonization.egwnp2007.pdf) |
| Runions et al., *Modeling and Visualization of Leaf Venation Patterns*, SIGGRAPH 2005 | ✅ [algorithmicbotany.org](https://algorithmicbotany.org/papers/venation.sig2005.html) |
| Runions, *Modeling Biological Patterns using the Space Colonization Algorithm* (MSc thesis, 2008) | ✅ [algorithmicbotany.org](https://algorithmicbotany.org/papers/runionsa.th2008.html) |
| Jones, *Characteristics of Pattern Formation and Evolution in Approximations of Physarum Transport Networks*, Artificial Life 16(2), 2010, 127–153. DOI 10.1162/artl.2010.16.2.16202 | ✅ [UWE repository](https://uwe-repository.worktribe.com/output/980579) |
| Sage Jenson's physarum write-up — the implementable version of the above | ◇ <https://cargocollective.com/sagejenson/physarum> |
| Turing, *The Chemical Basis of Morphogenesis*, Phil. Trans. R. Soc. B 237, 1952 | royalsocietypublishing.org |
| Karl Sims, *Reaction-Diffusion Tutorial* | ◇ <https://www.karlsims.com/rd.html> |
| Shiffman, *The Nature of Code* — **free, and it's p5.js, i.e. your current stack** | ◇ <https://natureofcode.com/> |
| Flake, *The Computational Beauty of Nature* | book |

## 6d. CNN / dream / feature visualization

| Work | Where |
|---|---|
| Mordvintsev, Olah & Tyka, *Inceptionism: Going Deeper into Neural Networks* (2015) — DeepDream | ◇ Google Research blog, "Inceptionism" |
| Olah et al., *Feature Visualization*, Distill 2017 | ◇ <https://distill.pub/2017/feature-visualization/> |
| Mordvintsev et al., *Differentiable Image Parameterizations*, Distill 2018 — **the rigorous DeepDream; includes CPPNs** | ◇ <https://distill.pub/2018/differentiable-parameterizations/> |
| Mordvintsev et al., *Growing Neural Cellular Automata*, Distill 2020 | ◇ <https://distill.pub/2020/growing-ca/> |
| Niklasson, Mordvintsev, Randazzo & Levin, *Self-Organising Textures*, Distill 2021 — **NCA + DeepDream objective; newer and faster** | ✅ <https://distill.pub/selforg/2021/textures/> |
| Distill thread: *Differentiable Self-organizing Systems* (all NCA articles) | ✅ <https://distill.pub/2020/selforg/> |
| Mordvintsev, Niklasson & Randazzo, *Texture Generation with Neural Cellular Automata* | ✅ [arXiv:2105.07299](https://arxiv.org/abs/2105.07299) |
| Gatys, Ecker & Bethge, *A Neural Algorithm of Artistic Style* | ◇ [arXiv:1508.06576](https://arxiv.org/abs/1508.06576) |
| Johnson, Alahi & Fei-Fei, *Perceptual Losses for Real-Time Style Transfer*, ECCV 2016 | ◇ [arXiv:1603.08155](https://arxiv.org/abs/1603.08155) |
| Zeiler & Fergus, *Visualizing and Understanding Convolutional Networks*, ECCV 2014 | ◇ [arXiv:1311.2901](https://arxiv.org/abs/1311.2901) |
| Radford et al., *Learning Transferable Visual Models From Natural Language Supervision* (CLIP) | ◇ [arXiv:2103.00020](https://arxiv.org/abs/2103.00020) |
| Akten, Fiebrink & Grierson, *Learning to See: You Are What You See*, SIGGRAPH 2019 | ✅ [arXiv:2003.00902](https://arxiv.org/abs/2003.00902) · ✅ [SIGGRAPH archive](https://history.siggraph.org/?p=28442) |

## 6e. Signal processing, feedback, video

| Work | Where |
|---|---|
| Hermann, Hunt & Neuhoff (eds.), *The Sonification Handbook*, 2011 — **free, open access, 586 pp.** Read ch. 1–4, 15–16. The §B3 mapping taxonomy is from here. | ✅ <https://sonification.de/handbook/> · ✅ [ch.1](https://sonification.de/handbook/chapters/chapter1) |
| Crutchfield, *Space-Time Dynamics in Video Feedback*, Physica D 10 (1984) 229–245 | ✅ [author's page](https://csc.ucdavis.edu/~chaos/chaos/pubs/stdvf-title.html) · ✅ [Vasulka archive PDF](https://vasulka.org/archive/eigenwelt/pdf/191-207.pdf) |
| Crutchfield, *Spatio-Temporal Complexity in Nonlinear Image Processing* | ✅ [UC Davis](https://csc.ucdavis.edu/~chaos/Publications/stcnip-title.html) |
| Wu et al., *Eulerian Video Magnification for Revealing Subtle Changes in the World*, SIGGRAPH 2012 | ◇ <https://people.csail.mit.edu/mrub/evm/> |
| Davis et al., *Image-Space Modal Bases for Plausible Manipulation of Objects in Video* (Interactive Dynamic Video), SIGGRAPH Asia 2015 | ✅ <https://interactivedynamicvideo.com/> |
| Teed & Deng, *RAFT: Recurrent All-Pairs Field Transforms for Optical Flow*, ECCV 2020 | ◇ [arXiv:2003.12039](https://arxiv.org/abs/2003.12039) |
| Farnebäck, *Two-Frame Motion Estimation Based on Polynomial Expansion*, SCIA 2003 | widely mirrored; also `cv2.calcOpticalFlowFarneback` |
| Eckmann, Kamphorst & Ruelle, *Recurrence Plots of Dynamical Systems*, Europhys. Lett. 1987 | — |
| Takens, *Detecting Strange Attractors in Turbulence*, 1981 | — |
| Golan Levin, *An Informal Catalogue of Slit-Scan Video Artworks and Research* | ✅ <https://flong.com/archive/texts/lists/slit_scan/index.html> |

## 6f. Artists

Ryoji Ikeda ◇ <https://www.ryojiikeda.com/> · Golan Levin ◇ <https://flong.com/> ·
Memo Akten ◇ <https://www.memo.tv/> · Casey Reas ◇ <https://reas.com/> ·
Zach Lieberman ◇ <https://zach.li/> · Refik Anadol ◇ <https://refikanadol.com/>
(read the critiques too) · Mario Klingemann ◇ <https://quasimondo.com/> ·
Manfred Mohr · John Whitney, *Digital Harmony* (1980).

## 6g. Tools

TouchDesigner ◇ <https://derivative.ca/> (CHOPs are built for exactly the Layer-B work;
accepts OSC from a telemetry daemon) · Hydra ◇ <https://hydra.ojack.xyz/> ·
openFrameworks ◇ <https://openframeworks.cc/> · p5.js ◇ <https://p5js.org/> ·
Shadertoy ◇ <https://www.shadertoy.com/> · three.js ◇ <https://threejs.org/> ·
Max/MSP+Jitter ◇ <https://cycling74.com/> · Bevy ◇ <https://bevyengine.org/> ·
wgpu ◇ <https://wgpu.rs/>

---

## Apple API documentation (the §1 catalog)

All at `developer.apple.com/documentation/...`:

| Topic | Path |
|---|---|
| **`NSEvent.pressure`** (analog Force Touch 0.0–1.0) | `appkit/nsevent/pressure` |
| **`NSEvent.stage`**, `stageTransition`, `NSPressureBehavior` | `appkit/nsevent/stage` |
| `NSResponder.pressureChange(with:)` — how an app receives force | `appkit/nsresponder/pressurechange(with:)` |
| Scroll phases / momentum | `appkit/nsevent/phase`, `appkit/nsevent/momentumphase` |
| Haptics (close the loop physically) | `appkit/nshapticfeedbackmanager` |
| CGEventTap (system-wide input, needs Accessibility) | `coregraphics/1454426-cgeventtapcreate` |
| ScreenCaptureKit (your pixel-feedback source) | `screencapturekit` |
| Accessibility tree of every app's UI | `applicationservices/axuielement_h` |
| Window list + geometry | `coregraphics/quartz_window_services` |
| QuickLook thumbnails | `quicklookthumbnailing/qlthumbnailgenerator` |
| Spotlight metadata | `foundation/nsmetadataquery` + `mdls`/`mdfind` man pages |
| FSEvents | `coreservices/file_system_events` |
| Core ML / ANE | `coreml`, and `coremltools` at <https://coremltools.readme.io/> |
| Vision (hand pose, saliency, face) | `vision` |
| Metal + MetalFX | `metal` |
| CADisplayLink on macOS 14+ | `quartzcore/cadisplaylink` |
| Core Audio process taps (macOS 14.2+) | `coreaudio/catapdescription` |
| EndpointSecurity (shippable `fs_usage`; needs an Apple-granted entitlement) | `endpointsecurity` |
| `NSProcessInfo.thermalState` | `foundation/processinfo/thermalstate` |

Man pages worth reading in full on your machine: `man powermetrics`, `man fs_usage`,
`man nettop`, `man vm_stat`, `man iostat`, `man ktrace`, `man latency`, `man mdls`.
