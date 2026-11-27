#!/bin/sh
# Build the five native helpers from source.
#
# They are built rather than committed on purpose: macOS quarantines
# downloaded binaries, and Accessibility permission is granted per binary
# path — a helper you compiled yourself is one the system will let you
# authorise. Needs the Xcode command line tools (`xcode-select --install`).
set -e
cd "$(dirname "$0")"

build() {
  src="$1"; out="$2"; shift 2
  mkdir -p "$(dirname "$out")"
  printf '  %-22s' "$(basename "$out")"
  swiftc -O "$src" -o "$out" "$@" 2>/dev/null && echo "ok" || echo "FAILED"
}

echo "building native helpers…"
build m0-telemetry/src/pressure-probe.swift m0-telemetry/bin/pressure-probe
build m0-telemetry/src/fast-sampler.swift   m0-telemetry/bin/fast-sampler
build m0-telemetry/src/hud-panel.swift      m0-telemetry/bin/hud-panel
build m1-desktop/src/probe.swift            m1-desktop/bin_probe
build m1-desktop/src/ax-reader.swift        m1-desktop/bin/ax-reader
build m1-desktop/src/screen-feed.swift      m1-desktop/bin/screen-feed
build m1-desktop/src/poke.swift             m1-desktop/bin/poke
echo
echo "done."
echo "  patcher:      node m0-telemetry/telemetryd.js   then open /m1/psyche.html"
echo "  whole screen: ./psyche.sh"
