#!/usr/bin/env python3
"""Mix the sound-effects track from assets/sfx/*.mp3 onto the ad's timeline.

Usage: python3 build_sfx.py [out.mp3]

Each cue is (sound, hit_time, gain_db[, max_len]). hit_time is when the
sound's loudest moment (PEAK) should land, matched to the on-screen action
in index.html. Sounds come from HeyGen's sound-effects library.
"""
import subprocess
import sys

VIDEO_LEN = 47.0
SFX_DIR = "assets/sfx"

# Seconds from file start to the sound's main hit (from the HeyGen catalog).
PEAK = {
    "drumroll": 2.3, "whoosh": 0.345, "swipe": 0.11, "pop": 0.115, "uipop": 0.05,
    "cash": 0.21, "sparkle": 0.7, "clock": 0.0, "water": 0.165, "ding": 0.055, "thud": 0.055,
}

CUES = [
    # S1 — tired, laundry pile drops in
    ("pop", 0.35, -10), ("pop", 0.75, -10),
    ("thud", 1.10, -14), ("thud", 1.45, -15), ("thud", 1.80, -14), ("thud", 2.15, -15), ("thud", 2.55, -13),
    # S2 — time draining away
    ("whoosh", 5.55, -9), ("clock", 5.80, -16, 4.6), ("uipop", 7.55, -10),
    # S3 — drum roll into the logo reveal
    ("drumroll", 11.25, -8), ("whoosh", 10.55, -10), ("sparkle", 11.45, -9), ("pop", 12.35, -10),
    # S4 — machine spins, checkmarks
    ("whoosh", 15.60, -9), ("water", 16.10, -15), ("water", 19.10, -17),
    ("ding", 17.85, -6), ("ding", 18.35, -6), ("ding", 18.85, -5),
    # S5 — hammock
    ("whoosh", 21.60, -9), ("uipop", 23.20, -10),
    # S6 — sofa
    ("whoosh", 27.10, -9), ("pop", 27.45, -10), ("pop", 28.35, -10), ("pop", 29.25, -10), ("ding", 29.40, -10),
    # S7 — savings
    ("whoosh", 32.10, -9), ("swipe", 32.85, -8), ("swipe", 33.75, -8), ("cash", 34.95, -6),
    # S8 — drum roll into the end card
    ("drumroll", 37.70, -8), ("sparkle", 37.85, -9),
    ("pop", 38.50, -10), ("uipop", 39.20, -10), ("pop", 39.90, -10), ("uipop", 40.70, -9),
]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "assets/sfx.mp3"
    inputs, parts, labels = [], [], []
    for i, cue in enumerate(CUES):
        name, hit, gain = cue[:3]
        start = hit - PEAK[name]
        skip = max(0.0, -start)  # sound would start before 0s: trim its head
        trim = f"atrim=start={skip:.3f}" + (f":duration={cue[3]}" if len(cue) > 3 else "")
        fade = f",afade=t=out:st={cue[3] - 0.4:.2f}:d=0.4" if len(cue) > 3 else ""
        d = int(max(0.0, start) * 1000)
        inputs += ["-i", f"{SFX_DIR}/{name}.mp3"]
        parts.append(f"[{i}:a]aformat=sample_rates=44100:channel_layouts=stereo,{trim},"
                     f"asetpts=PTS-STARTPTS{fade},volume={gain}dB,adelay={d}|{d}[s{i}]")
        labels.append(f"[s{i}]")
    graph = ";".join(parts) + ";" + "".join(labels) + \
        f"amix=inputs={len(labels)}:normalize=0,apad,atrim=0:{VIDEO_LEN},alimiter=limit=0.7[out]"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", graph,
                    "-map", "[out]", "-ar", "44100", "-ac", "2", "-b:a", "192k", out], check=True)
    print(f"wrote {out} ({len(CUES)} cues)")


if __name__ == "__main__":
    main()
