---
name: nano-banana
description: Generate and edit images using Google's Gemini image models (Nano Banana 2 default, Nano Banana Pro legacy). Use when the user asks to generate, create, edit, modify, change, alter, or update images. Also use when user references an existing image file and asks to modify it in any way (e.g., "modify this image", "change the background", "replace X with Y"). Supports text-to-image, image editing with up to 14 reference images, configurable resolution (0.5K-4K), aspect ratio, and adjustable thinking. DO NOT read the image file first - use this skill directly with the --input-image parameter.
---

# Nano Banana Image Generation & Editing

Generate new images or edit existing ones using Google's Gemini image API.

**Default model:** Nano Banana 2 (`gemini-3.1-flash-image-preview`) — cheaper, faster, more features.
**Legacy model:** Nano Banana Pro (`gemini-3-pro-image-preview`) — available via `--model nano-banana-pro`, deprecated 9 March 2026.

## Usage

Run the script using absolute path (do NOT cd to skill directory first):

**Generate new image:**
```bash
uv run ~/.claude/skills/nano-banana/scripts/generate_image.py --prompt "your image description" --filename "output.png" [--resolution 0.5K|1K|2K|4K] [--aspect-ratio 16:9] [--thinking high] [--api-key KEY]
```

**Edit existing image:**
```bash
uv run ~/.claude/skills/nano-banana/scripts/generate_image.py --prompt "editing instructions" --filename "output.png" --input-image "path/to/input.png" [--resolution 0.5K|1K|2K|4K] [--api-key KEY]
```

**Multi-reference generation (up to 14 images):**
```bash
uv run ~/.claude/skills/nano-banana/scripts/generate_image.py --prompt "combine these styles" --filename "output.png" --input-image "ref1.png" --input-image "ref2.png"
```

**Important:** Always run from the user's current working directory so images are saved where the user is working, not in the skill directory.

## Model Selection

| Flag value | Model ID | Notes |
|---|---|---|
| `nano-banana-2` (default) | `gemini-3.1-flash-image-preview` | Cheaper, faster, 0.5K support, aspect ratio, thinking, 14 ref images |
| `nano-banana-pro` | `gemini-3-pro-image-preview` | **Deprecated 9 March 2026** |

## Resolution Options

Uppercase K required:

- **0.5K** — ~512px (cheapest, Nano Banana 2 only)
- **1K** (default) — ~1024px
- **2K** — ~2048px
- **4K** — ~4096px

Map user requests:
- "thumbnail", "small", "cheap", "low resolution" → `0.5K`
- No mention / "1080", "1080p", "1K" → `1K`
- "2K", "2048", "medium resolution" → `2K`
- "high resolution", "high-res", "hi-res", "4K", "ultra" → `4K`

When editing, resolution auto-detects from input image size if not specified.

## Aspect Ratio

14 supported ratios (Nano Banana 2 only). Omit to let the API decide.

Map user requests:
- "landscape", "wide" → `16:9`
- "portrait", "phone", "story", "reel" → `9:16`
- "square" → `1:1`
- "cinematic", "ultrawide" → `21:9`
- "photo portrait" → `3:4` or `2:3`

## Thinking

Controls reasoning effort for complex prompts (Nano Banana 2 only). Omit for fastest/cheapest.

- `--thinking minimal` — slightly better quality, low latency impact
- `--thinking high` — best for complex composition, text rendering, detailed scenes

Note: thinking tokens are billed regardless of level.

## Reference Images

Up to 14 input images via repeated `--input-image` flags. Use cases:
- Style transfer — provide style reference + subject
- Character consistency — provide character reference images
- Object reference — provide object images to include
- Image editing — provide single image + editing instructions in prompt

Resolution auto-detects from the first input image when `--resolution` not specified.

## API Key

Checked in order:
1. `--api-key` argument
2. `GEMINI_API_KEY` environment variable

## Filename Generation

Pattern: `yyyy-mm-dd-hh-mm-ss-name.png`

- Timestamp: current date/time, 24-hour format
- Name: descriptive lowercase with hyphens (1-5 words)
- Unclear context: use random identifier (e.g., `x9k2`)

Examples:
- "A serene Japanese garden" → `2026-03-01-14-23-05-japanese-garden.png`
- Unclear → `2026-03-01-17-12-48-x9k2.png`

## Image Editing

1. Check if user provides an image path or references an image in the current directory
2. Use `--input-image` with the path
3. Pass editing instructions in `--prompt`
4. Common tasks: add/remove elements, change style, adjust colours, blur background

## Prompt Handling

**For generation:** Pass user's image description as-is to `--prompt`. Only rework if clearly insufficient.

**For editing:** Pass editing instructions in `--prompt` (e.g., "add a rainbow in the sky", "make it look like a watercolour painting")

Preserve user's creative intent in both cases.

## Output

- Saves PNG to current directory (or specified path if filename includes directory)
- Script outputs the full path to the generated image
- **Do not read the image back** — just inform the user of the saved path

## Pricing (Paid Tier Only)

No free tier for image generation.

### Nano Banana 2 (`gemini-3.1-flash-image-preview`) — default

| Resolution | Standard | Batch |
|---|---|---|
| 0.5K (512px) | $0.045 | $0.022 |
| 1K | $0.067 | $0.034 |
| 2K | $0.101 | $0.050 |
| 4K | $0.151 | $0.076 |

Google Search grounding: 5,000 prompts/month free, then $14/1,000 queries.

### Nano Banana Pro (`gemini-3-pro-image-preview`) — deprecated 9 Mar 2026

| Component | Standard | Batch |
|---|---|---|
| Input (per image) | $0.0011 | $0.0006 |
| Output 1K/2K | $0.134 | $0.067 |
| Output 4K | $0.24 | $0.12 |

## Examples

**Generate with aspect ratio:**
```bash
uv run ~/.claude/skills/nano-banana/scripts/generate_image.py --prompt "Cinematic landscape at golden hour" --filename "2026-03-01-10-00-00-landscape.png" --resolution 2K --aspect-ratio 21:9
```

**Generate with thinking for complex prompt:**
```bash
uv run ~/.claude/skills/nano-banana/scripts/generate_image.py --prompt "A detailed infographic about climate change with text labels" --filename "2026-03-01-10-05-00-infographic.png" --thinking high --resolution 4K
```

**Multi-reference style transfer:**
```bash
uv run ~/.claude/skills/nano-banana/scripts/generate_image.py --prompt "A portrait in this artistic style" --filename "2026-03-01-10-10-00-styled-portrait.png" --input-image "style-ref.png" --input-image "subject.png"
```

**Budget thumbnail:**
```bash
uv run ~/.claude/skills/nano-banana/scripts/generate_image.py --prompt "Simple icon of a house" --filename "2026-03-01-10-15-00-house-icon.png" --resolution 0.5K
```

**Edit existing image:**
```bash
uv run ~/.claude/skills/nano-banana/scripts/generate_image.py --prompt "make the sky more dramatic with storm clouds" --filename "2026-03-01-14-25-30-dramatic-sky.png" --input-image "original-photo.jpg" --resolution 2K
```

**Use legacy model:**
```bash
uv run ~/.claude/skills/nano-banana/scripts/generate_image.py --prompt "A serene Japanese garden" --filename "2026-03-01-14-23-05-japanese-garden.png" --model nano-banana-pro --resolution 4K
```
