# Generated media

Images, video, music, sound, speech, meshes and text from a model, through `raea gen`: one-off prompts, flows (ComfyUI
included), and the providers raea reaches (made.app, fal, Replicate, OpenRouter, Modal). The files under `motion/` are
copies of raea's craft guides (`raea guide NAME` prints the same text).

## Which file to open

| You are... | Open |
|---|---|
| before the first `raea gen`: what to generate, what never to, and where the result goes | [motion/gen.md](motion/gen.md) |
| putting a generated file into a composition (by import or path) | [motion/assets.md](motion/assets.md) |
| a 3D model to make or fix (Tripo, then Blender) | [3d/assets.md](3d/assets.md), [3d/blender.md](3d/blender.md), [3d/scenes.md](3d/scenes.md) (routing: which tool makes which object) |
| sound made locally instead | [sound.md](sound.md) |
| a note asking for another take on a generated part | [craft/verbs/generate.md](craft/verbs/generate.md) |

## The verbs

- `raea gen image|video|music|sfx|speech|mesh|text "PROMPT"` (HEADLESS): one generation; `raea gen models` lists what
  each provider offers, `raea gen balance` what's left to spend.
- `raea gen plan|run FLOW.ts`: a flow of steps; `raea gen comfy import|export|run|schema`: ComfyUI workflows.
- `raea neural mlxdlss DIR -o OUT`: neural rendering over a `raea render --aov` folder.

Generation spends the person's money. Quote first: `raea gen plan FLOW` and `--plan` on a one-shot cost nothing and say
what each step costs; `--max-cents N` refuses a run past its cap before anything is spent
([motion/gen.md](motion/gen.md), "Never").
