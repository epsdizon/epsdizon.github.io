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

The music is an original composition written to evoke an anime-opening feel; it does not use the official theme.
