#!/bin/sh
# Rebuild the manual. The reference section comes from the live operator
# registry, so re-run this whenever operators change and it stays correct.
set -e
cd "$(dirname "$0")"
node make-manual.mjs
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
[ -x "$BRAVE" ] || BRAVE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$BRAVE" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="$(cd .. && pwd)/13-PATCHER-MANUAL.pdf" \
  "file://$(pwd)/manual.html" 2>/dev/null
echo "13-PATCHER-MANUAL.pdf rebuilt"
