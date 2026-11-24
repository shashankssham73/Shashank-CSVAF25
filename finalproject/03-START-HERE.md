# START HERE

The short version of everything else in this folder. If you read one file, read this one.

## Tonight (1 hour)

Install **Eagle Mode** and navigate your own files with it. Find something three folders
deep, then get back out.

```sh
brew install --cask eagle-mode    # or build from https://eaglemode.sourceforge.net/
```

It's a working zoomable file browser. That hour answers decisions #1, #2 and #6 below by
feel, which no paper will do for you.

Also: leave the scope open in a background window at <http://localhost:7777> while you
work (`cd m0-telemetry && node telemetryd.js`). Zero effort, and by the end of the week
you'll have answered #3.

## This week

**[The Book of Shaders](https://thebookofshaders.com/), chapters 1–5.** Type every
example. ~45 min/day. This is your real gap — not CNNs.

---

## The entire reading list

Everything else in `01-LINKS.md` is a reference shelf. Look things up when you hit them.
Do not read it.

**Two that take real time:**

| | Time | Why |
|---|---|---|
| [The Book of Shaders](https://thebookofshaders.com/), ch. 1–11 | 3 weeks | Without it you can't put thousands of animated things on screen at 60 fps. |
| [The Nature of Code](https://natureofcode.com/), ch. 1–6 | 1 week | Free, p5.js, your exact stack. |

**Four under an hour each:**

- [Eagle Mode](https://eaglemode.sourceforge.net/) — use it, don't read it.
- [Nielsen, *Response Times*](https://www.nngroup.com/articles/response-times-3-important-limits/) — 5 min. 0.1 s / 1 s / 10 s.
- [Shneiderman, *The Eyes Have It*](https://webspace.science.uu.nl/~telea001/uploads/VACourse/Shneiderman96.pdf) — 8 pages.
- [Space colonization](https://algorithmicbotany.org/papers/colonization.egwnp2007.pdf) — 8 pages, mostly pictures. **The one paper that matches your sketch.**

**Two for later, at the CNN stage:**

- [Growing Neural Cellular Automata](https://distill.pub/2020/growing-ca/) — interactive, ~1 hr.
- [The Sonification Handbook](https://sonification.de/handbook/) — **chapter 2 only**.

---

## The ten decisions, and when each happens

| # | Decision | When you make it | Default |
|---|---|---|---|
| 1 | Visualizer or OS shell? | **Now** | Visualizer first — it's part of the shell anyway. |
| 2 | What counts as success? | **Now** | Pick one: "weird and beautiful" *or* "a better file manager". |
| 3 | Which 5–8 signals matter? | After a day watching the scope | `cpu.busy`, `vm.faults`, `net.in/out`, `disk.tps`, `in.pressure`, `fs.events` |
| 4 | Form from the file, or from system state? | Building the tree | File decides *shape*, telemetry decides *motion*. Don't let them fight over one channel. |
| 5 | Same folder = same shape every time? | Building the bloom | Yes. Stable layout, randomness only in texture. People navigate by memory. |
| 6 | How does the user get back *out*? | Building the bloom | You must answer this. Your sketches don't. |
| 7 | CNN live in-frame, or precomputed? | After measuring on the ANE | Precomputed. Measure, don't guess. |
| 8 | sudo/private APIs, or shippable app? | Only if you ship | Research project. Use sudo freely. |
| 9 | macOS or Linux? | Only if you go full OS | macOS. |
| 10 | Parameter mapping or model-based? | Stage 4–5 | Start with parameter mapping. |

**Only #1 and #2 block you today.** The rest have defaults you can take and revisit.

---

## The other files

- `00-RESEARCH-MAP.md` — the full parameter catalog, DSP layer, form algorithms, the
  bloom's knob list, OS-vs-visualizer analysis. A reference, not a reading assignment.
- `01-LINKS.md` — every reference, verified. A shelf.
- `02-LEARNING-PATH.md` — the full 8-stage version of this, if you ever want it.
- `m0-telemetry/README.md` — **the measured findings about your machine.** Read the
  findings list; it's the part that isn't in any paper.
