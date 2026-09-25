---
name: codex-imagegen
description: >-
  Generates and edits raster images with gpt-image-2 on the ChatGPT
  subscription Codex is signed in with, so no OPENAI_API_KEY is needed. Use
  when an agent other than Codex (Claude Code, pi, opencode) is asked to
  generate, create, draw, render or edit an image: a photo, illustration,
  hero or banner, sprite, texture, product or UI mockup, or a transparent
  cutout. Also use for restyling or editing an existing image file. Not for
  SVG, vector, HTML/CSS or diagram output.
---

# codex-imagegen

`scripts/codex_imagegen.py` (EXECUTE; stdlib Python 3.9+; the path is
relative to this skill's directory, so cd there or use the absolute path) calls
the same backend endpoint as Codex's built-in `image_gen` tool. It authenticates
with the ChatGPT tokens in `${CODEX_HOME:-~/.codex}/auth.json`. Never ask the
user for an OpenAI API key for this.

```bash
scripts/codex_imagegen.py "<prompt>" -o <out.png> [--quality low|medium|high|auto] \
  [--background auto|transparent|opaque] [-r <image> ...] [--force]
```

- It prints one JSON line (`path`, `mode`, `size`, `quality`, `background`,
  `seconds`). Look at the file after each run before calling the result done.
- Passing `-r` switches to an edit: up to 5 images go in as edit targets or
  references. Name each image's role in the prompt, for example "Image 1:
  edit target; Image 2: style reference". List what must stay unchanged.
- `-` as the prompt reads it from stdin. Use this for long, structured prompts.
- A call takes about 15-40 s. Run independent images in parallel (`&` then
  `wait`), one call per distinct asset.

## Controls that behave differently from the API docs

- **There is no size argument, because the server ignores size for ChatGPT
  sign-ins.** It takes the aspect ratio from the prompt. Put the shape in words:
  "Portrait orientation, 2:3 aspect ratio" returned 1024x1536, and "21:9" came
  back at about 2.33:1 (1916x821). The ratio is followed roughly and the output
  is not a standard size, so resize or crop afterwards to hit exact pixels (for
  example `sips -z`).
- **Quality appears capped at `medium` on ChatGPT sign-ins.** `low` is
  honoured, but `high` came back as `medium` (checked 2026-09-23). The response
  JSON reports the tier you actually got. Use `low` for drafts and iteration,
  and `auto` for finals.
- `--background transparent` returns real alpha, but that alpha is soft: the
  subject sits at about 251-253 rather than 255, faint noise runs out to the
  canvas edges, and some edges have a colour fringe. For an asset that needs
  crisp alpha, clamp it (under about 16 to 0, over about 240 to 255) and trim
  to the content, for example with Pillow.
- The script refuses to overwrite `-o` without `--force`. Write variants to
  sibling names (`hero-v2.png`).
- **Edits reject some phone photos.** A Pixel "UHDR" JPEG (16-bit) came back
  `400 invalid_image_file`. Re-save every `-r` input as an 8-bit PNG first
  (`magick in.jpg -depth 8 -strip ref.png`).
- `quality: auto` on an edit sometimes returns `low`; check the JSON and rerun
  a final asset that came back `low`.

## A consistent set of characters or assets

Separate generations drift in style. What held a five-person cast together
(checked 2026-09-25):

1. Generate the first asset from its photo, and look at it until it is right.
2. Pass that asset as a second `-r` for every other one: "Image 2: style
   reference only - match its style, colouring, border and framing, but do NOT
   copy its person".
3. Make expression or pose variants as edits of the finished asset: "Keep
   EVERYTHING identical - same pose, framing, border and background. Change
   ONLY the mouth". Variants come back at the same size and framing, so
   swapping the whole image works as a stop-motion replacement (for example
   a talking mouth).
4. Rebuild a hidden part of a face (another head in front of it, a hand)
   with a photographic edit of the crop first, then caricature the result.

## Failures

- **Missing auth, or the refresh fails.** Tell the user to run `codex login`
  (ChatGPT sign-in). An expired access token refreshes by itself: the script
  rotates the tokens and writes them back into `auth.json`, the same way
  Codex does.
- **HTTP 429, or an error naming `image_gen`.** The plan's image quota is
  used up. Report the reset time from the error. Do not retry in a loop.
- **Any other non-200 status.** The endpoint is undocumented Codex internals.
  Fall back to Codex itself and report which route produced the image:
  `codex exec --skip-git-repo-check -s workspace-write "Use the imagegen
  skill to generate <prompt>, then copy the result to ./<out.png> and print
  its path"`. This is slower (about 50 s) and spends Codex agent tokens as
  well as image quota.

For prompt structure (use-case slug, subject, style, composition, verbatim
text, constraints), Codex's bundled skill is a good reference:
`${CODEX_HOME:-~/.codex}/skills/.system/imagegen/references/prompting.md`.

`tests/` holds the CLI contract against a fake backend:
`uv run --with pytest python -m pytest tests`.
