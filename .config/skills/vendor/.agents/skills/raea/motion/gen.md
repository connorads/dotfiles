# Generated media: raea gen, flows, made.app, fal, OpenRouter, Replicate, Modal, ComfyUI

## What to do

- Generate a picture, a clip, music, an effect, a voice, a 3D model or words with `raea gen` when the piece needs
  something that isn't in the footage, the stock or the scene. `-o` is the folder; each command prints the files it wrote; use it like any
  other media (`<Img src>`, `<Video src>`, `<Audio src>`, `<Model src>`).
- Quote first. `raea gen plan FLOW` and `--plan` on a one-shot cost nothing and say where each step runs and what it
  costs in cents. A run past its cap is refused before anything is spent: `--max-cents N`, else
  `RAEA_GEN_MAX_CENTS`, else 100.
- One thing at a time: a one-shot verb.

  ```sh
  raea gen image "a paper kite over dunes at dawn, 35mm" --aspect 16:9 -o media/gen
  raea gen video "the kite climbs into the light" --image media/gen/<the still>.png --seconds 5 -o media/gen
  raea gen sfx "paper flutter in wind, close, no music" --seconds 3 -o media/gen
  raea gen speech "Find your wind." -o media/gen
  raea gen mesh "a paper kite" --image media/gen/<the still>.png -o media/gen   # the GLB and its textures together
  raea gen text "five hooks for a kite shop ad" -o media/gen
  raea gen models --kind video --query kling                  # made's catalog, with prices
  ```

- Several steps that feed each other: a flow in TypeScript. Each maker returns its step's output, which the next step
  takes. A text step's words go straight into a prompt.

  ```ts
  import { flow } from "raea/gen";
  export default flow(({ image, video, text }) => {
    const line = text.generate({ prompt: "one vivid 15-word image prompt for a kite shop ad; the prompt only" });
    const still = image.generate({ prompt: line, aspect_ratio: "9:16" });
    return { clip: video.generate({ start_image: still, prompt: "slow push in, ribbons in the wind", seconds: 5 }) };
  });
  ```

  Then `raea gen plan kite.ts`, then `raea gen run kite.ts -o media/gen`. Each output is copied to its own name
  (`media/gen/clip.mp4`; a mesh and its textures as `media/gen/<name>/`), so the composition says
  `<Video src={staticFile("gen/clip.mp4")} />`. The steps' files sit beside them under their keys, with a
  `gen.jsonl` index. A step that is already there isn't run again, and a changed prompt reruns only what comes after
  it, so edit and rerun freely.
- Pick a model only when the piece needs one. Without one, each op goes to its default: made.app for pictures, video
  and audio, OpenRouter (Kimi) for words, Tripo for meshes (its own `tripo` CLI on your key when this Mac has both, else the same Tripo model on fal), this Mac's sao for effects, and made.app for speech. To name a
  model, use `{ model: "made:kling_3_pro" }`, `"fal:<endpoint>"`, `"replicate:owner/name"`, `"openrouter:<model>"`,
  `"modal:<name>"`, `"fish:<model>"` (Fish Audio, with your FISH_API_KEY), `"tripo:H3.1"` or `"tripo:P2"` (Tripo 3D through its CLI), `"comfy"` or `"local:sao"`. `raea gen models` lists made's ids. A made model's own setting goes in
  as `x_<name>`.
<!-- LOCAL PATCH (connorads dotfiles): Tripo's CLI is not provisioned here; agents must not npm-install it or ask for its key. -->
- Meshes on Tripo (its `tripo` CLI and a `TRIPO_API_KEY` the user supplies; neither is provisioned here, so do not install the CLI or ask for the key; every user
  brings their own key). Feed it a picture rather than words: an image step making a clean product shot (one object,
  plain light background, three-quarter view) gives far better geometry than a prompt. Tripo's own settings go in as
  x_<name>, and raea sets the ones that matter when you don't: `face_limit` 30000 on H3.1 (a raw H3.1 model can be
  1.5 million triangles and 40 MB; 15000 for a background prop, 60000-150000 for a hero seen close), `orientation:
  align_image` for a picture (the model faces as the picture does, not Tripo's sideways +X), `auto_size` (real
  metres), `pbr`, and a seed from the step itself, geometry and texture alike, so a rerun gives the same model (set
  `seed` for another candidate). `x_texture_quality: "detailed"` costs more and is worth it for a hero. Then
  `raea gen check MODEL.glb --h 0.9` measures it and writes a fixed copy (`bevy/scenes`). `tripo:H3.1` costs
  20-50 credits a model, `tripo:P2` (Tripo's default, clean low topology) 100-130; a credit is 1¢, and `raea gen plan`
  quotes it with `tripo make --dry-run`. **Credits are the API wallet's:** buy them at
  https://developers.tripo3d.ai/en/billing, not on the tripo3d.ai dashboard, whose credits the key never sees (it
  answers "insufficient credits", exit 4). With no credits or no key, the step goes to fal's Tripo instead
  (RAEA_TRIPO_FALLBACK=0 stops that); `raea gen balance` shows both wallets.
- Crops, resizes and side-by-sides between steps are free and run here: `image.crop`, `image.scale` (width, height,
  factor or megapixels; fit stretch, cover or contain) and `image.stitch` (a list of images, right or down).
- ComfyUI: `raea gen comfy import workflow.json -o flow.json` turns a workflow into a flow. Sampler chains and
  partner nodes become steps, and anything else stays as ComfyUI nodes that run on the ComfyUI server
  (`RAEA_COMFY_URL`). `raea gen comfy export kite.ts -o kite.workflow.json` writes any flow as a workflow; the steps
  ComfyUI can't run itself become RaeaMade nodes (tools/comfy/raea_made).
- A workflow that needs node packs or model weights: `raea gen comfy needs workflow.json -o needs.json`, then
  `tools/comfy/setup.sh needs needs.json` (this Mac) or the Modal lines in tools/comfy/modal_comfy.py (hosted).

## Never

- Never run a paid step without its plan's number in front of you. Never raise the cap to get past a refusal without
  saying what it costs.
- Never generate what the footage, the brand kit or a built 3D scene already has. A generated face, product or logo
  stands in for the real one only when the brief says so.
- Never rely on a generated clip for words on screen. Set type in the composition.
