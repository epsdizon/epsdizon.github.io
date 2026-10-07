#!/usr/bin/env bash
# Render the ad and build a contact sheet of one frame per scene.
# Usage: ./render.sh [output.mp4] [sheet.png]
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-../the-spot-ad.mp4}"
SHEET="${2:-../contact-sheet.png}"
TIMES=(3 9 13.5 19.5 24.5 30.5 36 41)

# Use a pre-installed headless Chromium if present (cloud containers).
HS=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
[ -x "$HS" ] && export HYPERFRAMES_BROWSER_PATH="$HS"

npx --yes hyperframes@0.8.140 render -o "$OUT"

TMP="$(mktemp -d)"
inputs=()
for t in "${TIMES[@]}"; do
  ffmpeg -loglevel error -y -ss "$t" -i "$OUT" -frames:v 1 -vf scale=360:-1 "$TMP/$t.png"
  inputs+=(-i "$TMP/$t.png")
done
ffmpeg -loglevel error -y "${inputs[@]}" \
  -filter_complex "[0][1][2][3]hstack=4[a];[4][5][6][7]hstack=4[b];[a][b]vstack" "$SHEET"
rm -rf "$TMP"
echo "Video: $OUT"
echo "Sheet: $SHEET"
