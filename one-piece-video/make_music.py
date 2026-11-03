#!/usr/bin/env python3
"""Synthesize an original, One Piece–opening–flavoured adventure score.

Structure (120 BPM, 1 bar = 2 s):
  0-8 s   ominous orchestral intro (Dm drone, strings, choir, timpani roll)
  8 s     execution hit (taiko + crash + brass stab)
  8-10 s  suspense, reverse-cymbal swell
  10-26 s J-rock adventure groove in D major with a brass lead (original melody)
  26-28 s climax stabs, 28 s final D chord ringing out

Usage: python3 make_music.py [out.wav] [--duration 32]
       python3 make_music.py out.wav --song opening.mp4 --song-at 10   # Roger intro, then your song
       python3 make_music.py assets/tv-intro-music.wav --duration 44 --tv-intro tv_intro.mp4   # for tv-intro.html
Only needs numpy + scipy.
"""
import argparse
import subprocess
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
BPM = 120
BEAT = 60 / BPM
rng = np.random.default_rng(7)

NOTE_IDX = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
            "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def hz(name):
    n, octv = name[:-1], int(name[-1])
    midi = 12 * (octv + 1) + NOTE_IDX[n]
    return 440.0 * 2 ** ((midi - 69) / 12)


def tvec(dur):
    return np.arange(int(dur * SR)) / SR


def saw(f, dur, detune=0.0, max_h=60, vib=0.0, vib_rate=5.5, phase=0.0):
    """Band-limited additive sawtooth with optional vibrato."""
    t = tvec(dur)
    f_inst = f * (1 + detune) * (1 + vib * np.sin(2 * np.pi * vib_rate * t))
    ph = 2 * np.pi * np.cumsum(f_inst) / SR + phase
    out = np.zeros_like(t)
    nh = int(min(max_h, (SR / 2.2) / f))
    for k in range(1, nh + 1):
        out += np.sin(k * ph) / k
    return out * 0.6


def adsr(n, a, d, s, r):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    env = np.full(n, s, dtype=float)
    a = min(a, n)
    env[:a] = np.linspace(0, 1, a, endpoint=False) if a else env[:a]
    d = min(d, n - a)
    if d > 0:
        env[a:a + d] = np.linspace(1, s, d, endpoint=False)
    r = min(r, n)
    if r > 0:
        env[n - r:] *= np.linspace(1, 0, r)
    return env


def lp(x, fc, order=2):
    b, a = signal.butter(order, min(fc, SR / 2.1) / (SR / 2), "low")
    return signal.lfilter(b, a, x)


def hp(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), "high")
    return signal.lfilter(b, a, x)


def bp(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], "band")
    return signal.lfilter(b, a, x)


class Mix:
    def __init__(self, dur):
        self.n = int(dur * SR)
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n)
        self.verb = np.zeros((2, self.n))

    def add(self, x, start, gain=1.0, pan=0.0, send=0.2):
        i = int(start * SR)
        if i >= self.n:
            return
        x = x[: self.n - i] * gain
        gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        self.L[i:i + len(x)] += x * gl
        self.R[i:i + len(x)] += x * gr
        self.verb[0, i:i + len(x)] += x * gl * send
        self.verb[1, i:i + len(x)] += x * gr * send

    def render(self, rt=2.4):
        ln = int(rt * SR)
        t = np.arange(ln) / SR
        out = []
        for ch in range(2):
            ir = rng.standard_normal(ln) * np.exp(-6.9 * t / rt)
            ir = lp(ir, 6000)
            ir[: int(0.012 * SR)] = 0  # pre-delay
            ir /= np.sqrt(np.sum(ir ** 2))
            out.append(signal.fftconvolve(self.verb[ch], ir)[: self.n] * 0.9)
        L, R = self.L + out[0], self.R + out[1]
        st = np.stack([L, R], 1)
        st = np.tanh(st * 1.1) / np.tanh(1.1)  # gentle glue/limiter
        st /= np.max(np.abs(st)) / 0.95
        return st


# ---------------------------------------------------------------- instruments
def strings(notes, dur, bright=1800):
    x = sum(saw(hz(n), dur, detune=d, vib=0.003) for n in notes for d in (-0.004, 0.0, 0.005))
    x = lp(x, bright) * adsr(len(x), dur * 0.45, 0.1, 1.0, dur * 0.3)
    return x / (len(notes) * 3)


def choir(notes, dur):
    out = 0
    for n in notes:
        src = saw(hz(n), dur, vib=0.006, vib_rate=4.8) + saw(hz(n), dur, detune=0.006, vib=0.005)
        out = out + bp(src, 550, 900) * 1.0 + bp(src, 1000, 1400) * 0.5 + bp(src, 2400, 2900) * 0.15
    return out * adsr(len(out), dur * 0.5, 0.1, 1.0, dur * 0.35) / len(notes)


def timpani(f=hz("D2"), dur=1.6, vel=1.0):
    t = tvec(dur)
    fi = f * (1 + 0.15 * np.exp(-t * 25))
    ph = 2 * np.pi * np.cumsum(fi) / SR
    body = np.sin(ph) + 0.4 * np.sin(1.5 * ph) + 0.2 * np.sin(1.99 * ph)
    noise = lp(rng.standard_normal(len(t)), 900) * np.exp(-t * 40)
    return (body * np.exp(-t * 2.6) + 0.6 * noise) * vel


def taiko(dur=2.5):
    t = tvec(dur)
    ph = 2 * np.pi * np.cumsum(55 * (1 + 1.4 * np.exp(-t * 18))) / SR
    return np.sin(ph) * np.exp(-t * 2.2) + 0.5 * lp(rng.standard_normal(len(t)), 400) * np.exp(-t * 14)


def crash(dur=3.5):
    t = tvec(dur)
    x = hp(rng.standard_normal(len(t)), 4500, 3) + 0.4 * bp(rng.standard_normal(len(t)), 2500, 6000)
    return x * np.exp(-t * 1.5) * 0.5


def rev_cymbal(dur=2.0):
    return crash(dur)[::-1] * np.linspace(0, 1, int(dur * SR)) ** 2


def kick(dur=0.45):
    t = tvec(dur)
    ph = 2 * np.pi * np.cumsum(45 + 110 * np.exp(-t * 35)) / SR
    return np.tanh(2.2 * np.sin(ph) * np.exp(-t * 9)) + 0.25 * hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 200)


def snare(dur=0.35):
    t = tvec(dur)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 25)
    nz = bp(rng.standard_normal(len(t)), 1500, 9000) * np.exp(-t * 16)
    return 0.6 * tone + 0.9 * nz


def hat(dur=0.08, open_=False):
    t = tvec(0.35 if open_ else dur)
    return hp(rng.standard_normal(len(t)), 7000, 3) * np.exp(-t * (9 if open_ else 60)) * 0.35


def bass(f, dur):
    x = lp(saw(f, dur, max_h=30), 700) + 0.5 * np.sin(2 * np.pi * f * tvec(dur))
    return x * adsr(len(x), 0.005, 0.1, 0.7, 0.04)


def guitar(root, dur, mute=False):
    f = hz(root)
    x = saw(f, dur, max_h=40) + saw(f * 1.4983, dur, detune=0.002, max_h=30) + 0.7 * saw(f * 2, dur, detune=-0.002, max_h=25)
    x = np.tanh(3.5 * x)
    x = lp(x, 1600 if mute else 3200)
    env = adsr(len(x), 0.004, 0.12 if mute else 0.3, 0.25 if mute else 0.75, 0.03)
    return x * env * 0.5


def brass(note, dur, vel=1.0):
    f = hz(note)
    t = tvec(dur)
    x = saw(f, dur, vib=0.004, vib_rate=5.2) + saw(f, dur, detune=0.003, vib=0.004)
    # filter-envelope brightness swell via crossfade of two filter settings
    bright_env = np.clip(np.minimum(t / 0.06, 1) * (0.6 + 0.4 * np.exp(-t * 3)), 0, 1)
    x = lp(x, 900) * (1 - bright_env) + lp(x, 4200) * bright_env
    return x * adsr(len(x), 0.03, 0.15, 0.8, min(0.12, dur * 0.4)) * vel * 0.5


# ---------------------------------------------------------------- score
def load_song(path, offset=0.0):
    """Decode any audio/video file to float stereo at SR via ffmpeg."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(offset), "-i", path, "-vn", "-ac", "2", "-ar", str(SR),
                          "-f", "f32le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(float)


def mix_song(intro, song, at, target_db=-13.0, intro_gain=0.4):
    """Hand the intro over to a full song starting at `at` seconds (loudness-matched)."""
    n, i = len(intro), int(at * SR)
    rms = np.sqrt(np.mean(song[: 10 * SR] ** 2)) + 1e-9
    song = song * (10 ** (target_db / 20) / rms)
    song[: int(0.03 * SR)] *= np.linspace(0, 1, int(0.03 * SR))[:, None]
    duck = np.ones(n)
    t = (np.arange(n - i)) / SR
    duck[i:] = np.where(t < 0.25, 1 - 0.7 * t / 0.25, 0.3 * np.exp(-(t - 0.25) * 1.5))  # let the hit ring under the song
    out = intro * intro_gain * duck[:, None]
    seg = song[: n - i]
    out[i:i + len(seg)] += seg
    return np.tanh(out * 1.05) / np.tanh(1.05)


def master(st):
    n = len(st)
    fade_in = int(0.4 * SR)
    st[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    fo = int(1.6 * SR)
    st[n - fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
    return st / max(1.0, np.max(np.abs(st)) / 0.97)


def tv_intro(path, start, duration, hit=19.2, roll=1.7, sfx_gain=1.0):
    """Use a supplied TV-intro soundtrack (narration + opening) and polish it with
    a crescendo snare/timpani roll that lands on the execution flash at `hit`."""
    src = load_song(path, start)[: int(duration * SR)]
    src = np.pad(src, ((0, int(duration * SR) - len(src)), (0, 0)))
    src *= 10 ** (-14 / 20) / (np.sqrt(np.mean(src[: int(30 * SR)] ** 2)) + 1e-9)
    fx = Mix(duration)
    hits = np.arange(hit - roll, hit, 1 / 16)
    for k, st in enumerate(hits):  # little drum roll, pp -> f
        v = (k / len(hits)) ** 1.6
        fx.add(snare(0.12) * (0.15 + 0.85 * v), st, gain=0.22 * sfx_gain, pan=0.1, send=0.25)
        if k % 2 == 0:
            fx.add(timpani(hz("D2"), 0.5, vel=0.2 + 0.8 * v), st, gain=0.25 * sfx_gain, pan=-0.15, send=0.3)
    fx.add(taiko(2.5), hit, gain=0.6 * sfx_gain, send=0.4)  # low boom under the crash
    fx.add(crash(2.5), hit, gain=0.25 * sfx_gain, send=0.3)
    ln = int(2.4 * SR)  # same reverb tail length Mix.render uses
    sfx = np.zeros((fx.n, 2))
    ir_t = np.arange(ln) / SR
    for ch in range(2):  # render fx without the global normaliser so levels stay relative
        ir = rng.standard_normal(ln) * np.exp(-6.9 * ir_t / 2.4)
        ir = lp(ir, 6000); ir /= np.sqrt(np.sum(ir ** 2))
        wet = signal.fftconvolve(fx.verb[ch], ir)[: fx.n]
        sfx[:, ch] = (fx.L if ch == 0 else fx.R) + wet
    out = np.tanh((src + sfx) * 1.05) / np.tanh(1.05)
    return master(out)


def build(duration, song=None, song_at=10.0, song_offset=0.0):
    m = Mix(duration)

    # --- intro 0-8 s: Dm  Bb  Gm  A, swelling
    intro = [("D3 F3 A3 D4", 0), ("Bb2 F3 Bb3 D4", 2), ("G2 D3 G3 Bb3", 4), ("A2 E3 A3 C#4", 6)]
    for i, (ch, st) in enumerate(intro):
        m.add(strings(ch.split(), 2.2, bright=1200 + i * 500), st, gain=0.5 + i * 0.12, send=0.5)
        m.add(choir(ch.split()[1:], 2.2), st, gain=0.25 + i * 0.07, pan=0.1, send=0.6)
    drone = lp(saw(hz("D1"), 8.0, max_h=20) + saw(hz("D2"), 8.0, detune=0.003, max_h=20), 300)
    m.add(drone * adsr(len(drone), 2.5, 0.1, 1, 0.3), 0, gain=0.55, send=0.3)
    for k, st in enumerate(np.arange(0, 6, 1.0)):  # heartbeat timpani
        m.add(timpani(vel=0.5 + k * 0.08), st, gain=0.5, send=0.35)
    roll = np.arange(6.0, 8.0, 1 / 14)
    for k, st in enumerate(roll):  # crescendo roll into the hit
        m.add(timpani(hz("A1"), 0.6, vel=0.2 + 0.8 * k / len(roll)), st, gain=0.45, pan=-0.2, send=0.35)
    m.add(rev_cymbal(1.6), 6.4, gain=0.5, send=0.3)

    # --- 8 s execution hit
    m.add(taiko(3.0), 8.0, gain=1.1, send=0.5)
    m.add(crash(4.0), 8.0, gain=0.8, pan=0.2, send=0.4)
    for n in "D3 A3 D4 F4 A4".split():
        m.add(brass(n, 1.4, vel=1.0), 8.0, gain=0.45, send=0.5)
    sus = strings("D3 A3 D4 E4".split(), 2.2, bright=2200)
    m.add(sus, 8.2, gain=0.55, send=0.6)
    m.add(choir("A3 D4 E4".split(), 2.0), 8.2, gain=0.4, send=0.7)
    m.add(rev_cymbal(1.8), 8.2, gain=0.7, send=0.2)
    for st in (9.25, 9.5, 9.625, 9.75, 9.875):  # snare pickup fill
        m.add(snare(), st, gain=0.55, pan=0.05, send=0.15)

    if song is not None:  # Roger intro -> hand over to the supplied opening song
        return master(mix_song(m.render(), load_song(song, song_offset), song_at))

    # --- 10-26 s band, D major. 8 bars of 2 s
    prog = ["D2", "A1", "B1", "G1", "D2", "A1", "G1|A1", "D2"]
    gtr = {"D2": "D3", "A1": "A2", "B1": "B2", "G1": "G2"}
    t0 = 10.0
    for b, chord in enumerate(prog):
        bar = t0 + b * 2
        roots = chord.split("|")
        for e in range(8):  # eighth notes
            st = bar + e * BEAT / 2
            r = roots[0] if len(roots) == 1 or e < 4 else roots[1]
            m.add(bass(hz(r), BEAT / 2 * 0.95), st, gain=0.55, send=0.05)
            accent = e in (0, 3, 6)
            m.add(guitar(gtr[r], BEAT / 2 * 0.95, mute=not accent), st, gain=0.32 if accent else 0.22, pan=-0.45, send=0.1)
            m.add(guitar(gtr[r], BEAT / 2 * 0.95, mute=not accent) * 0.9, st + 0.008, gain=0.3 if accent else 0.2, pan=0.45, send=0.1)
            m.add(hat(open_=(e == 7)), st, gain=0.5, pan=0.3, send=0.05)
        for q in range(4):  # quarter notes
            st = bar + q * BEAT
            if q in (0, 2) or (q == 3 and b % 2 == 1):
                m.add(kick(), st if q != 3 else st + BEAT / 2, gain=0.9, send=0.05)
            if q in (1, 3):
                m.add(snare(), st, gain=0.7, send=0.2)
        if b in (0, 4):
            m.add(crash(2.5), bar, gain=0.45, pan=-0.3, send=0.2)
        # string pad underneath
        pad = {"D2": "D4 F#4 A4", "A1": "C#4 E4 A4", "B1": "D4 F#4 B4", "G1": "D4 G4 B4"}[roots[0]]
        m.add(strings(pad.split(), 2.1, bright=3000), bar, gain=0.28, pan=0.15, send=0.5)

    melody = [
        [("D5", 1), ("A4", .5), ("D5", .5), ("E5", 1), ("F#5", 1)],
        [("E5", 1.5), ("C#5", .5), ("A4", 2)],
        [("B4", 1), ("D5", .5), ("F#5", .5), ("A5", 1), ("F#5", 1)],
        [("G5", 1.5), ("F#5", .5), ("E5", 1), ("D5", 1)],
        [("F#5", 1), ("A5", 1), ("D6", 1.5), ("C#6", .5)],
        [("B5", 1), ("A5", 1), ("E5", 2)],
        [("D5", .5), ("E5", .5), ("F#5", .5), ("G5", .5), ("A5", .5), ("B5", .5), ("C#6", 1)],
        [("D6", 3), ("r", 1)],
    ]
    for b, phrase in enumerate(melody):
        st = t0 + b * 2
        for n, beats in phrase:
            d = beats * BEAT
            if n != "r":
                m.add(brass(n, d * 0.97), st, gain=0.42, pan=0.05, send=0.35)
                lower = hz(n) / 2
                lo = brass(n[:-1] + str(int(n[-1]) - 1), d * 0.97) * 0.5
                m.add(lo, st, gain=0.3, pan=-0.1, send=0.35)
            st += d

    # --- 26-28 s climax stabs  G . . G . A . A  -> 28 final D
    for st, ch in [(26.0, "G"), (26.75, "G"), (27.0, "A"), (27.5, "A"), (27.75, "A")]:
        notes = {"G": "G3 D4 G4 B4", "A": "A3 E4 A4 C#5"}[ch]
        for n in notes.split():
            m.add(brass(n, 0.35, vel=1.0), st, gain=0.4, send=0.4)
        m.add(guitar(ch + "2", 0.35), st, gain=0.4, pan=-0.4, send=0.2)
        m.add(guitar(ch + "2", 0.35), st, gain=0.4, pan=0.4, send=0.2)
        m.add(bass(hz(ch + "1"), 0.35), st, gain=0.6)
        m.add(kick(), st, gain=0.9)
        m.add(snare(), st, gain=0.5, send=0.3)
    m.add(crash(2.0), 26.0, gain=0.5, send=0.3)
    for st in np.arange(27.0, 28.0, 0.125):  # tom/snare build
        m.add(snare(), st, gain=0.3 + 0.4 * (st - 27.0), send=0.2)

    end = duration - 28.0
    m.add(taiko(3.5), 28.0, gain=1.0, send=0.5)
    m.add(crash(4.5), 28.0, gain=0.8, send=0.5)
    m.add(kick(), 28.0, gain=1.0)
    for n in "D3 A3 D4 F#4 A4 D5".split():
        x = brass(n, end) * adsr(int(end * SR), 0.01, 0.4, 0.7, end * 0.6)
        m.add(x, 28.0, gain=0.38, send=0.6)
    m.add(strings("D4 F#4 A4 D5".split(), end, bright=3500), 28.0, gain=0.5, send=0.7)
    m.add(choir("D4 F#4 A4".split(), end), 28.0, gain=0.35, send=0.8)
    for g, n in ((0.5, "D2"), (0.35, "D3")):
        x = bass(hz(n), end) * adsr(int(end * SR), 0.01, 0.3, 0.8, end * 0.6)
        m.add(x, 28.0, gain=g, send=0.2)
    m.add(guitar("D3", end) * adsr(int(end * SR), 0, 0.5, 0.6, end * 0.6), 28.0, gain=0.35, pan=-0.4, send=0.3)
    m.add(guitar("D3", end) * adsr(int(end * SR), 0, 0.5, 0.6, end * 0.6), 28.0, gain=0.35, pan=0.4, send=0.3)

    return master(m.render())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default="assets/music.wav")
    ap.add_argument("--duration", type=float, default=32.0)
    ap.add_argument("--song", help="audio/video file of the opening song to cut into after the Roger intro")
    ap.add_argument("--song-at", type=float, default=10.0, help="video time (s) where the song starts")
    ap.add_argument("--song-offset", type=float, default=0.0, help="skip this many seconds into the song file")
    ap.add_argument("--tv-intro", help="full TV intro (narration + opening) to use as the soundtrack, polished with a drum roll")
    ap.add_argument("--tv-start", type=float, default=1.2, help="skip this many seconds into the TV intro file")
    ap.add_argument("--hit", type=float, default=19.2, help="video time (s) of the execution flash the roll lands on")
    a = ap.parse_args()
    if a.tv_intro:
        audio = tv_intro(a.tv_intro, a.tv_start, a.duration, a.hit)
    else:
        audio = build(a.duration, a.song, a.song_at, a.song_offset)
    wavfile.write(a.out, SR, (audio * 32767).astype(np.int16))
    print(f"wrote {a.out} ({a.duration:.1f}s)")
