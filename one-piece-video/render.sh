#!/usr/bin/env bash
# Rebuild "Where is the One Piece?" end to end: music -> HyperFrames render -> deliverables.
# Usage: ./render.sh                 original synthesized score
#        ./render.sh opening.mp4     Roger intro, then your copy of the opening song from 10 s
set -euo pipefail
cd "$(dirname "$0")"
if [ $# -ge 1 ]; then
  python3 make_music.py assets/music.wav --duration 32 --song "$1" --song-at 10
else
  python3 make_music.py assets/music.wav --duration 32
fi
npx --yes hyperframes@0.8.140 render -o renders/where-is-the-one-piece.mp4 -q delivery -w 4 --quiet
ffmpeg -v error -y -i renders/where-is-the-one-piece.mp4 -c:v libx264 -crf 19 -preset slow -pix_fmt yuv420p \
  -c:a copy -movflags +faststart renders/where-is-the-one-piece-1080p.mp4
ffmpeg -v error -y -i renders/where-is-the-one-piece.mp4 -filter_complex \
  "[0:v]scale=1080:-2[v];color=black:s=1080x1920:r=30:d=32[bg];[bg][v]overlay=0:(H-h)/2-80:shortest=1[o];[o]drawtext=font='Inter Display\:style=Bold':text='Where is the One Piece?':fontcolor=white:fontsize=58:x=(w-tw)/2:y=330,drawtext=font='Inter':text='A single point of light draws the legend.':fontcolor=0xd9d9d9:fontsize=34:x=(w-tw)/2:y=1440[out]" \
  -map "[out]" -map 0:a -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart \
  renders/where-is-the-one-piece-vertical.mp4
echo "done: renders/"
