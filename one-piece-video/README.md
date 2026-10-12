# Where is the One Piece? — light-painting intro

A 32-second, no-voiceover motion graphic built with [HyperFrames](https://github.com/heygen-com/hyperframes):
a single point of light draws the legend in 3D space (long-exposure look, haze, wet-floor reflections),
with small subtitles and an original adventure score.

Story: Loguetown execution of Gol D. Roger → the Great Pirate Era → a ship sets sail on the Grand Line →
the world map (Red Line × Grand Line) and the four Road Poneglyphs → where their paths cross: Laugh Tale →
the straw hat → **ONE PIECE**.

| File | What |
| --- | --- |
| `index.html` | HyperFrames composition (canvas + subtitles + title + music) |
| `scene.js` | Deterministic light-painting renderer (3D strokes, pen, camera, bloom, reflections, particles) |
| `make_music.py` | Synthesizes the original score (`numpy` + `scipy`) |
| `render.sh` | Rebuilds music, renders, and exports both deliverables |
| `renders/where-is-the-one-piece-1080p.mp4` | 1920×1080 |
| `renders/where-is-the-one-piece-vertical.mp4` | 1080×1920 (TikTok/Reels framing) |

Preview/edit: `npx hyperframes preview` · Rebuild: `./render.sh`

**Using the real opening song:** `./render.sh path/to/opening.mp4` keeps the dramatic Roger-execution
intro (0–10 s) and cuts into your copy of the song exactly when the ships set sail (10 s), loudness-matched.
The song file is not stored in this repo.

**TV-intro cut (44 s):** `./render.sh --tv path/to/tv_intro.mp4` uses the full TV intro (Roger narration →
ships → song) as the soundtrack. `tv-intro/index.html` retimes the same light-painting to it: the execution
flash lands on the crash, the ships sail under the narration, the song starts as the camera flies to the map,
subtitles follow the narration, and a small snare/timpani roll is layered in leading into the flash.

The music is an original composition written to evoke an anime-opening feel; it does not use the official theme.
