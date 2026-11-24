#!/bin/sh
# PSYCHE mode over the whole desktop.
#
#   ./psyche.sh            effect over everything, click-through
#   ./psyche.sh --patcher  …and open the patcher so you can change it live
#
# Three pieces: the daemon serves the render; screen-feed captures the display
# through ScreenCaptureKit with the overlay EXCLUDED, so the effect does not
# photograph itself; hud-panel covers the screen with the result.
#
# Quit from the menu bar icon, or: pkill -f hud-panel
set -e
cd "$(dirname "$0")"
PORT="${PORT:-7777}"

[ -x m1-desktop/bin/screen-feed ] || { echo "not built — run ./build.sh"; exit 1; }
[ -x m0-telemetry/bin/hud-panel ] || { echo "not built — run ./build.sh"; exit 1; }

if ! curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/schema"; then
  echo "starting the daemon on $PORT…"
  node m0-telemetry/telemetryd.js --port "$PORT" >/tmp/psyche-daemon.log 2>&1 &
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/schema" && break
  done
fi

case "$1" in
  --patcher) open "http://127.0.0.1:$PORT/m1/psyche.html" ;;
esac

echo "covering the screen — menu bar icon to quit"
exec m0-telemetry/bin/hud-panel --cover --view psyche --port "$PORT" --alpha 1
