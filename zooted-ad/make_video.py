#!/usr/bin/env python3
"""Reusable shot-list -> vertical video pipeline (Google Nano Banana + Veo 3.1 + ffmpeg).

Everything about the ad lives in shots.json; this script only executes it, so the
same script works for the next product/flavor by swapping the JSON and assets.

  export GEMINI_API_KEY=...            # Google AI Studio key
  python3 make_video.py estimate       # cost estimate, no API calls
  python3 make_video.py keyframes      # stills (Nano Banana) -> keyframes/*.png  (review these!)
  python3 make_video.py clips          # video clips (Veo)    -> clips/*.mp4
  python3 make_video.py stitch [--music track.mp3]   -> out/final.mp4
  python3 make_video.py keyframes parlor s8_endcard --force   # redo specific items

Outputs that already exist are skipped (no double-billing) unless --force is given.
Model overrides: IMAGE_MODEL, VEO_MODEL env vars (or "model" per clip in shots.json).
"""
import argparse, json, os, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CFG = json.loads((ROOT / "shots.json").read_text())
IMAGE_MODEL = os.environ.get("IMAGE_MODEL", "gemini-2.5-flash-image")
VEO_MODEL = os.environ.get("VEO_MODEL", "veo-3.1-fast-generate-preview")
# Rough list prices (USD) for the estimate only; check ai.google.dev/pricing.
PRICE_IMAGE = 0.04
PRICE_VEO_PER_SEC = {"veo-3.1-fast-generate-preview": 0.15, "veo-3.1-generate-preview": 0.40}
W, H, FPS = 720, 1280, 24
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf"


def fill(text):
    return text.format(style=CFG["style"], character=CFG["character"], voice=CFG["voice"])


def client():
    from google import genai
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        sys.exit("Set GEMINI_API_KEY first.")
    return genai.Client(api_key=key)


def mime(p):
    return "image/png" if str(p).endswith(".png") else "image/jpeg"


# ---------------------------------------------------------------- keyframes
def keyframes(names, force):
    from google.genai import types
    from PIL import Image
    c, out = client(), ROOT / "keyframes"
    out.mkdir(exist_ok=True)
    for name, kf in CFG["keyframes"].items():  # JSON order = dependency order
        if names and name not in names:
            continue
        dst = out / f"{name}.png"
        if dst.exists() and not force:
            print(f"skip {name} (exists)"); continue
        refs = [ROOT / r for r in kf["refs"]]
        missing = [str(r) for r in refs if not r.exists()]
        if missing:
            print(f"!! {name}: missing refs {missing}; generate those first"); continue
        print(f"-> keyframe {name}")
        contents = [Image.open(r) for r in refs] + [fill(kf["prompt"])]
        ar = "16:9" if name == "character" else CFG["aspect_ratio"]
        try:
            r = c.models.generate_content(
                model=IMAGE_MODEL, contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                    image_config=types.ImageConfig(aspect_ratio=ar)))
            part = next(p for p in r.candidates[0].content.parts if p.inline_data)
            dst.write_bytes(part.inline_data.data)
            print(f"   saved {dst.relative_to(ROOT)}")
        except Exception as e:
            print(f"!! {name} failed: {e}")


# ---------------------------------------------------------------- clips
def clips(ids, force):
    from google.genai import types
    c, out = client(), ROOT / "clips"
    out.mkdir(exist_ok=True)
    img = lambda k: types.Image(image_bytes=(ROOT / "keyframes" / f"{k}.png").read_bytes(), mime_type="image/png")
    for cl in CFG["clips"]:
        if ids and cl["id"] not in ids:
            continue
        dst = out / f"{cl['id']}.mp4"
        if dst.exists() and not force:
            print(f"skip {cl['id']} (exists)"); continue
        cfg = dict(aspect_ratio=CFG["aspect_ratio"], duration_seconds=cl["gen"],
                   negative_prompt=CFG["negative_prompt"])
        if cl.get("end"):
            cfg["last_frame"] = img(cl["end"])
        model = cl.get("model", VEO_MODEL)
        print(f"-> clip {cl['id']} ({model}, {cl['gen']}s)")
        try:
            op = c.models.generate_videos(model=model, prompt=fill(cl["prompt"]),
                                          image=img(cl["start"]),
                                          config=types.GenerateVideosConfig(**cfg))
            while not op.done:
                time.sleep(10)
                op = c.operations.get(op)
            if op.error or not op.response or not op.response.generated_videos:
                print(f"!! {cl['id']} produced no video: {op.error or op.response}"); continue
            v = op.response.generated_videos[0].video
            c.files.download(file=v)
            v.save(str(dst))
            print(f"   saved {dst.relative_to(ROOT)}")
        except Exception as e:
            print(f"!! {cl['id']} failed: {e}")


# ---------------------------------------------------------------- stitch
def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def has_audio(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
                        "stream=index", "-of", "csv=p=0", str(p)], capture_output=True, text=True)
    return bool(r.stdout.strip())


def stitch(music):
    tmp, out = ROOT / "build", ROOT / "out"
    tmp.mkdir(exist_ok=True); out.mkdir(exist_ok=True)
    vf = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},format=yuv420p"
    parts = []
    for cl in CFG["clips"]:
        src, dst = ROOT / "clips" / f"{cl['id']}.mp4", tmp / f"{cl['id']}.mp4"
        if not src.exists():
            sys.exit(f"missing {src}; run clips first")
        a_in = [] if has_audio(src) else ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        ff("-i", str(src), *a_in, "-t", str(cl["use"]), "-vf", vf, "-map", "0:v",
           "-map", "0:a" if not a_in else "1:a", "-c:v", "libx264", "-crf", "18",
           "-c:a", "aac", "-ar", "48000", "-ac", "2", str(dst))
        parts.append(dst)
    lst = tmp / "list.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    body = tmp / "body.mp4"
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(body))

    # End card: same parlor frame, empty portrait, product on mantel; slow push + text.
    ec = CFG["endcard"]; secs = ec["seconds"]
    still = ROOT / "keyframes" / f"{ec['image']}.png"
    esc = lambda s: s.replace(":", r"\:").replace("'", r"\'")
    sizes = [64, 44, 36, 56]
    y, text = int(H * 0.70), []
    for i, line in enumerate(ec["lines"]):
        fs = sizes[i % len(sizes)]
        t0 = 1.0 + 0.3 * i
        text.append(f"drawtext=fontfile={FONT}:text='{esc(line)}':fontsize={fs}:fontcolor=white:"
                    f"borderw=3:bordercolor=0x2a0a3d:x=(w-tw)/2:y={y}:"
                    f"alpha='if(lt(t,{t0}),0,min(1,(t-{t0})/0.5))'")
        y += fs + 22
    zoom = f"zoompan=z='1+0.04*on/({secs}*{FPS})':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={secs*FPS}:s={W}x{H}:fps={FPS}"
    endcard = tmp / "endcard.mp4"
    ff("-loop", "1", "-i", str(still), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
       "-t", str(secs), "-vf", f"scale={W*2}:{H*2},{zoom},{','.join(text)},format=yuv420p",
       "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-shortest", str(endcard))

    # Smoke-clearing dissolve from shot 7 into the end card, audio fades out (no VO on end card).
    body_len = sum(cl["use"] for cl in CFG["clips"]); xf = 1.0
    total = body_len + secs - xf
    fc = (f"[0:v][1:v]xfade=transition=fade:duration={xf}:offset={body_len - xf}[v];"
          f"[0:a][1:a]acrossfade=d={xf}[a0];[a0]afade=t=out:st={total - 1.5}:d=1.5[a]")
    inputs = ["-i", str(body), "-i", str(endcard)]
    if music:
        inputs += ["-stream_loop", "-1", "-i", music]
        fc = fc.replace("[a]", "[ad]") + (f";[2:a]volume=0.25,afade=t=out:st={total - 2}:d=2[m];"
                                          f"[ad][m]amix=inputs=2:duration=first:normalize=0[a]")
    final = out / "final.mp4"
    ff(*inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-t", str(total),
       "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", str(final))
    print(f"done: {final} ({total:.0f}s, {W}x{H})")


def estimate():
    n_img = len(CFG["keyframes"])
    secs = sum(c["gen"] for c in CFG["clips"])
    rate = PRICE_VEO_PER_SEC.get(VEO_MODEL, 0.15)
    print(f"{n_img} keyframes x ${PRICE_IMAGE} = ${n_img * PRICE_IMAGE:.2f}")
    print(f"{secs}s of Veo ({VEO_MODEL}) x ${rate}/s = ${secs * rate:.2f}")
    print(f"one clean pass ~ ${n_img * PRICE_IMAGE + secs * rate:.2f}; budget ~2x for retakes")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["estimate", "keyframes", "clips", "stitch"])
    ap.add_argument("only", nargs="*", help="limit to these keyframe names / clip ids")
    ap.add_argument("--force", action="store_true", help="regenerate even if output exists")
    ap.add_argument("--music", help="optional music file to mix under the whole ad")
    a = ap.parse_args()
    {"estimate": estimate, "keyframes": lambda: keyframes(a.only, a.force),
     "clips": lambda: clips(a.only, a.force), "stitch": lambda: stitch(a.music)}[a.cmd]()
