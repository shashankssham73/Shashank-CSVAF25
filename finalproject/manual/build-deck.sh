#!/bin/sh
# Rebuild the ten-minute talk. Slide content comes from the live operator
# registry and the presets folder, so re-run it whenever either changes and
# the deck stays true.
set -e
cd "$(dirname "$0")"
node make-deck.mjs
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
[ -x "$BRAVE" ] || BRAVE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$BRAVE" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="$(cd .. && pwd)/14-PSYCHE-TALK.pdf" \
  "file://$(pwd)/deck.html" 2>/dev/null
echo "14-PSYCHE-TALK.pdf rebuilt"
