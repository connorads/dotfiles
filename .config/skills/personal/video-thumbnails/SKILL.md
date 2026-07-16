---
name: video-thumbnails
description: >-
  Creates video thumbnails (YouTube, LinkedIn) from a talk or screen
  recording: scouts frames with ffmpeg contact sheets, cuts out the speaker
  with rembg, composites panels/logos/big text as HTML/CSS and screenshots
  with playwright-cli. Use when the user asks for a thumbnail, cover image,
  or social preview for a video, talk, or upload, or wants to match a
  reference thumbnail's style. Not for image edits with no video source.
---

# Video Thumbnails

Everything runs locally, no external design service: **video → scouted
frames → rembg cutout → HTML/CSS composite → playwright screenshot**. The
HTML file is the artifact users iterate on — one CSS edit + re-screenshot
per feedback round.

Work in the scratchpad; only copy the final PNG next to the video.

## Ask before building

Use AskUserQuestion up front for the three choices that shape everything:
headline text, speaker image source (video grab vs supplied photo vs none),
and background content. Two rules discovered the hard way:

- A full talk title is unreadable as giant type. Split it: 1–3 word huge
  title + the rest as a small letter-spaced subline (the "POWERED BY
  AGENTS" pattern). Tell the user you're splitting it and why.
- Warn that a stage-cam cutout needs ~2–3x upscaling and will be soft;
  offer the user the option to supply a real photo.

## Scout frames cheaply

Never read frames one by one — survey with contact sheets:

```sh
ffmpeg -v error -i video.webm -vf "fps=1/10,scale=480:-1" frames/f_%03d.jpg
magick montage frames/f_0{01..28}.jpg -tile 4x7 -geometry +2+2 contact1.jpg
```

- Nix/brew ImageMagick often has broken fontconfig; `montage` then fails
  even without labels. Fix: pass an explicit real font, e.g.
  `-font /System/Library/Fonts/Helvetica.ttc` (macOS).
- Downscale a big montage before Reading it (`-resize 1800x`).
- After picking a rough moment, fine-scan around it at `fps=2` cropped to
  the speaker region, then extract the exact full-res frame with
  `ffmpeg -ss <t> -i video -frames:v 1`.
- Pose picking: mouth mid-word looks bad; favour closed-mouth/smiling,
  facing camera, hands gesturing. Offer 3–4 candidates when unsure — users
  are picky about their own face.

## Cutout

`rembg i in.png out.png` (first run downloads its model). Order matters:

1. Crop the person region from the full-res frame, then **upscale 2x
   before rembg** — matting quality is much better on the larger image.
2. rembg keeps salient foreground objects (podium, mic) — often desirable;
   audience heads/hands survive as strays. Erase them with a white
   rectangle composited `DstOut`:
   `magick cut.png \( -size WxH xc:white \) -geometry +X+Y -compose DstOut -composite out.png`
3. Hide clipped bottom edges (podium/torso cut by frame edge) with an
   alpha fade: composite a `gradient:` strip `DstOut` over the bottom
   ~60px. Reads as intentional, masks erase-notches too.
4. Verify each step by flattening onto a loud colour
   (`-background '#4444aa' -flatten`) and Reading it.

## Compose as HTML

Copy `assets/template.html` into the working dir and adapt. It encodes the
conventions: dark gradient bg, tilted screenshot panels with shadows,
bottom-anchored person on the right, corner logos, huge white title
bottom-left, letter-spaced subline. Screenshots pulled from the talk video
itself make good background panels; prefer a clean single-pane app shot
over busy multi-pane ones. Patch screen-share artifacts (Zoom pills etc.)
with a flat rect of the surrounding colour.

Logos: SVG sources rasterise crisply via `magick logo.svg -resize 400x400`.
A white-on-black logo drops its black box with `mix-blend-mode: screen`
over a dark bg — but then keep it clear of lighter panels underneath.

## Screenshot

playwright-cli **blocks `file://`** — serve the dir first:

```sh
python3 -m http.server 8377 --bind 127.0.0.1 &
playwright-cli open "http://127.0.0.1:8377/thumbnail.html"
playwright-cli resize 1280 720
playwright-cli screenshot --filename=out.png
```

For larger exports `--hires` is a no-op at deviceScaleFactor 1; instead
resize the viewport to the target (e.g. 1920x1080) and
`playwright-cli eval "document.documentElement.style.zoom='1.5'"` — text
and vectors re-render crisply, raster assets upscale acceptably.

Kill the server and `playwright-cli close` when done.

## Sizes

Verify current platform specs online before delivering. Long-standing
baselines: YouTube 1280x720 (16:9, ≤2MB); LinkedIn wants the thumbnail to
match the video's aspect ratio (1920x1080 for 16:9 video, ≤2MB) — the
1200x627 figure floating around is for link previews, not video.
