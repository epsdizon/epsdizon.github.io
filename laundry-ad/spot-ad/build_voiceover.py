#!/usr/bin/env python3
"""Split a voiceover take at its pauses and place each line on its scene cue.

Usage: python3 build_voiceover.py <take.mp3> [out.mp3] [--music <track> [bed.mp3]]

The take must contain one spoken line per cue in CUES, separated by pauses
(e.g. ElevenLabs <break time="1.5s" />). Output length matches the video.
With --music, also writes a background-music bed (default assets/music-bed.mp3)
trimmed to the video, faded at both ends, and ducked under the voiceover.
"""
import re
import subprocess
import sys

VIDEO_LEN = 47.0
PAD = 0.12  # keep a little air around each line so consonants aren't clipped
# Seconds where each line should start (scene start + entrance delay).
CUES = [
    0.4,   # S1 Pagod ka na ba sa labahin?
    5.9,   # S2 Isang buong araw, nauubos lang sa paglalaba.
    11.0,  # S3 Dalhin mo na sa The Spot Laundry Shop!
    16.0,  # S4 Kami na ang bahala: laba, tuyo, at tupi!
    21.9,  # S5 Habang naglalaba kami, ikaw, relax lang.
    27.4,  # S6 Mag-kape, mag-cellphone, mag-bonding!
    32.4,  # S7 Tipid sa oras, tipid sa bulsa, abot-kaya pa ang presyo!
    37.6,  # S8 Tara na sa The Spot! Sa Solib, malapit sa Central School...
    42.6,  # S8 I-message n'yo kami sa Facebook!
]


def speech_segments(path, noise="-40dB", min_gap=0.8):
    log = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", path, "-af",
         f"silencedetect=noise={noise}:d={min_gap}", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    total = float(re.search(r"Duration: (\d+):(\d+):([\d.]+)", log).groups()[2]) + \
        60 * float(re.search(r"Duration: (\d+):(\d+)", log).group(2))
    bounds = [0.0] + ends
    stops = starts + [total]
    return [(max(0.0, a - PAD), b + PAD) for a, b in zip(bounds, stops) if b - a > 0.2]


def build_music_bed(music, voiceover, out, level_db=-21, fade_out=2.5):
    """Trim music to the video, set it well under the voice, and duck it while she speaks."""
    graph = (
        f"[0:a]atrim=0:{VIDEO_LEN},asetpts=PTS-STARTPTS,loudnorm=I={level_db + 10}:TP=-2,"
        f"volume=-10dB,afade=t=in:d=0.6,afade=t=out:st={VIDEO_LEN - fade_out}:d={fade_out}[m];"
        "[1:a]aformat=channel_layouts=stereo,asplit[vk][vk2];[vk2]anullsink;"
        "[m][vk]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=450[out]"
    )
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", music, "-i", voiceover,
                    "-filter_complex", graph, "-map", "[out]", "-ar", "44100", "-ac", "2",
                    "-b:a", "192k", "-t", str(VIDEO_LEN), out], check=True)
    print("wrote", out)


def main():
    args = sys.argv[1:]
    music = bed = None
    if "--music" in args:
        i = args.index("--music")
        music = args[i + 1]
        rest = args[i + 2:]
        bed = rest[0] if rest else "assets/music-bed.mp3"
        args = args[:i]
    src = args[0]
    out = args[1] if len(args) > 1 else "assets/voiceover.mp3"
    segs = speech_segments(src)
    if len(segs) != len(CUES):
        sys.exit(f"Found {len(segs)} spoken lines but {len(CUES)} cues; adjust noise/min_gap.")
    parts, labels = [], []
    for i, ((a, b), cue) in enumerate(zip(segs, CUES)):
        nxt = CUES[i + 1] if i + 1 < len(CUES) else VIDEO_LEN
        if cue + (b - a) > nxt:
            print(f"warning: line {i + 1} ({b - a:.2f}s) overruns next cue by {cue + b - a - nxt:.2f}s")
        d = int(cue * 1000)
        parts.append(f"[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,adelay={d}|{d}[s{i}]")
        labels.append(f"[s{i}]")
    graph = ";".join(parts) + ";" + "".join(labels) + \
        f"amix=inputs={len(labels)}:normalize=0,apad,atrim=0:{VIDEO_LEN},loudnorm=I=-14:TP=-1.5[out]"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-filter_complex", graph,
                    "-map", "[out]", "-ar", "44100", "-ac", "2", "-b:a", "192k", out], check=True)
    for i, ((a, b), cue) in enumerate(zip(segs, CUES), 1):
        print(f"line {i}: {b - a:5.2f}s @ {cue:5.2f}s")
    print("wrote", out)
    if music:
        build_music_bed(music, out, bed)


if __name__ == "__main__":
    main()
