# M0 — telemetry daemon + raw signal scope

The instrument stage of the project. It samples the machine and shows you the signals,
and deliberately does nothing else: no smoothing, no mapping, no aesthetics. You cannot
design Layer B (see `../00-RESEARCH-MAP.md`) until you have watched these traces for a
while.

## Run

```sh
node telemetryd.js              # then open http://localhost:7777
```

Options: `--hz 60`, `--port 7777`, `--watch ~/Desktop,~/Code`, `--no-top`,
`--top-interval 5`, `--stdout > frames.ndjson`.

The input probe is already built. To rebuild:

```sh
swiftc -O -o bin/pressure-probe src/pressure-probe.swift -framework AppKit
```

## What it collects

43 channels at 30 Hz from 7 sources, **all unprivileged — no sudo anywhere**:

| source | channels | real rate |
|---|---|---|
| `vm_stat 1` | page faults, COW, zero-fill, page in/out, compress/decompress, free/active/wired/compressor MB | 1 Hz |
| `iostat -w 1` | cpu user/sys/idle/busy, load, disk tps / MB·s⁻¹ / KB·tx⁻¹ | 1 Hz |
| `nettop` | bytes in/out, re-tx, dupe, out-of-order, RTT, active procs, top talker | ~0.5 Hz, bursty |
| `ioreg AppleSmartBattery` | volts, amps, watts, battery temp, charging | 0.5 Hz |
| `fs.watch` (FSEvents) | file-change events, last path | event |
| `bin/pressure-probe` | cursor x/y/speed, scroll dx/dy, clicks, pressure, stage | ~120 Hz |
| `top` | busiest process name + %CPU | 0.33 Hz |

Measured cost of the whole tree: **~2–4% of one core**, ~45 MB. That matters — an
always-on shell that costs 3% CPU costs every user battery life forever.

## Endpoints

- `GET /` — the scope UI
- `GET /stream` — SSE, one `data:` frame per tick: `{seq, t, ch:{...}, lab:{...}}`
- `GET /schema` — channel metadata (unit, kind, hint range) + live source health
- `GET /record?on=1|0` — start/stop NDJSON capture into `record/`

## The `kind` field is the important one

Every channel declares `level`, `rate`, `event`, `state`, or `counter`. This tells you
which DSP is legal on it. Differentiating a `level` is meaningless; integrating a `rate`
drifts; FFT-ing an `event` stream without resampling onto a uniform grid gives garbage.
`/schema` exposes it and the scope colour-codes it.

## Using the scope

Four scaling modes, top-left. Switch between them on the same trace — that comparison
*is* the lesson from §B1 of the research map:

- **auto-scale** — raw window min/max. Most channels look like flat lines with
  occasional spikes. This is what heavy-tailed data actually looks like.
- **log1p** — the same signals become readable. Nearly everything here needs this.
- **rolling p2–p98** — robust normalization, ignores outliers. What you'd use to
  drive a visual parameter.
- **fixed hint** — the declared range, for absolute comparison.

Record a few minutes while you work, then analyse `record/*.ndjson` offline. The
interesting correlations (does `vm.faults` lead `disk.tps`? does `in.cursor_speed`
predict `cpu.busy`?) are cross-channel and need offline work, not a live plot.

## Findings worth knowing (all measured on macOS 15.5 / M3, not assumed)

1. **`NSEvent.pressure` analog force is NOT available system-wide.** A global monitor
   receives move/scroll/click but never `.pressure`, and `pressure` on those events is
   binary 0/1. Analog 0.0–1.0 force only reaches the app under the cursor. Run
   `./bin/pressure-probe --window` and force-touch the window to see the real signal.
   **Consequence for the project: the bloom UI gets true pressure inside its own
   window, but a system-wide pressure-driven shell cannot read force without an
   event tap.**
2. **`--tap` (CGEventTap) silently fails without Accessibility.** `CGEvent.tapCreate`
   returned a valid non-nil tap and then delivered zero events in 20 minutes. Tap
   creation succeeding is *not* proof of permission. Grant Accessibility to the parent
   process and re-run to get system-wide analog pressure.
3. **`nettop` with stdin on `/dev/null` busy-spins at ~135% CPU and emits nothing.**
   It is interactive (reads keypresses), so EOF-forever spins it. Every child here gets
   a real stdin pipe. This single bug was the entire difference between a 137% daemon
   and a 2% one.
4. **`nettop -L 0`** ("treated as infinity" per the man page) emits nothing and spins.
   Use a finite count and respawn.
5. **`nettop -J` replaces the whole column set**, so `time` must be requested
   explicitly or there is no sample marker.
6. **`nettop` reprints its CSV header before every sample**, and the `time` field
   increments ~1 µs *per row*, so rows in one sample do not share a timestamp. The
   header is the sample boundary.
7. **`vm_stat`'s `cmprssed` is logical, not physical.** It counts compressed pages at
   their original size and legitimately exceeds installed RAM (26 GB observed on a
   16 GB machine). `cmprssor` is the real footprint. Both are exposed.
8. **Needs root, so not used here:** `powermetrics` (the best signal on the machine —
   per-cluster CPU/GPU/ANE power at up to 1 kHz), `fs_usage` (every file op
   system-wide), `taskinfo`, `latency`. The unprivileged path to power data is the
   private **IOReport** framework — see `macmon` / `asitop` source.
9. **Battery amperage is only a system-power proxy on battery.** On AC with a charged
   battery it sits near zero regardless of load.
10. **This machine is fanless** (M3 Air), so there is no fan-RPM channel at all, and
    sustained GPU load will thermally throttle your renderer.

## Next

M1 is reading these traces. M2 is the bloom interaction with no telemetry and no CNN —
and it is the hard part. Do not wire telemetry into visuals before M2 feels fast.
