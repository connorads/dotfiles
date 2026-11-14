# Blender: the workshop an asset passes through

## When Blender, when raea

The TSX is the scene. solids, `sdf` and `grow` make things defined by numbers or rules; `raea gen` and CC0 libraries
make things defined by their looks (`bevy/scenes`, section 2). Blender is the workshop one asset passes through on its
way into `media/`: a saved script reads a source file and writes one `.glb`, and a scene loads that with `<Model>`.

Go to Blender only when a check names a script. Each of these findings carries its fix as text
(`fix: raea blender run blender/X.py ...`) and in its JSON (`fix.blender`, `fix.run`):

| the check says | found by | the script |
|---|---|---|
| a format raea can't load (FBX, OBJ, .blend, STL, PLY) | `raea gen check`, `raea scene lint` | `convert.py` |
| more triangles than its distance from the camera can show (150 000 at 1 m or closer, falling with the square of the distance, never under 2 000) | `raea gen check --seen M`, `raea scene lint` (its distance from the camera) | `decimate.py` |
| loose debris, holes, edges shared by three faces, when it must be solid | `raea gen check --solid` | `repair.py` |
| fewer pieces than the parts the brief says move (a vise's jaw, a lid, a door) | `raea gen check --parts jaw,body` | `split.py` |
| it needs textures, but a solid only has box UVs | `raea solid info` (the file exports `needs = { textured: true }`) | `raea solid export`, then `bake.py --into-colour` |
| the brief says it moves, and it has no skeleton | `raea gen check --rig` | `rig.py` |
| a cloth lies on or hangs from something | the brief | `cloth.py` |

Never use Blender for layout, cameras, lights, final materials or animation timing: those are TSX, where they are
frame-pure and checked (`raea scene lint`, `raea scene light`, the review sheets). "I know bpy" is no reason to model
something in Blender: a thing defined by numbers is a solid, and one defined by its looks is generated or downloaded.

A gap in solids (a fillet it can't make, real UVs) goes through `raea solid export`, then a script. Log it in the
project's `review/NOTES.md` as a gap to build into solids, so the workaround doesn't become the method.

## Headless by default: one saved script per asset step — HEADLESS

- Each step is a script in the project's `blender/` folder, run with `raea blender run blender/X.py IN OUT ARGS`.
  The first time you name a library script that isn't in the project, raea copies it there from
  `sdk/guides/craft/bevy/blender/`. From then on it is the project's script, to edit for this project.
- Re-run the step whenever its source changes. The `.glb` in `media/` is output, never edited by hand.
- The script reads its arguments after `--` (`sys.argv`). It writes one `.glb` plus the licence sidecar
  (`OUT.glb.json`, with a `steps` list appended for each step), and fails loudly: it prints `FAILED  X.py: why` and
  exits 1, and `raea blender run` then fails too.
- Check every output with `raea gen check OUT.glb` (same flags as the finding) before a scene uses it.
- `raea solid export FILE.ts -o media/X.glb [--set k=v,...] [--part NAME] [--colour #RRGGBB]` writes a solid as one
  `.glb` for a script. It refuses an empty solid or one `raea solid info` finds an error in, then reads the file back
  and checks the volume, pieces and box against the solid. The solid stays the source: export it again when it changes.

## The scripts (`sdk/guides/craft/bevy/blender/`)

Points and boxes are in raea's frame (metres, y up, z toward the viewer, the model's own space: the box
`raea gen check` reports).

- `convert.py IN OUT.glb [--textures DIR] [--unit auto|m|cm|mm] [--max-texture 2048]`: FBX, OBJ, .blend, STL or
  PLY to `.glb`. Applies rotation and scale. `auto` takes a model whose biggest side is over 50 as centimetres. Maps
  named diff, nor_gl, rough, metal or ao in `textures/` beside the file are wired in and written as 8-bit PNG no
  bigger than `--max-texture`.
- `decimate.py IN OUT TARGET [--lods 0.5,0.25]`: down to TARGET triangles (or a ratio, at 1 or under). Fails if it
  lands over 1.15 × the target. `--lods` also writes `OUT.lodN.glb`.
- `repair.py IN OUT [--debris 0.005] [--voxel SIZE] [--keep-pieces]`: merges doubled vertices, drops pieces under the
  debris share of the triangles, fills holes and recalculates normals. `--voxel` remeshes, for a model past mending.
- `split.py IN OUT NAME=X0,Y0,Z0,X1,Y1,Z1 ... [--rest body] [--each]`: the faces inside each box become a named
  part. `--each` also writes `OUT.NAME.glb`, each with its origin at its bottom centre, and records where it sat
  (`at`), so a scene can move it.
- `bake.py IN OUT [--res 1024] [--samples 32] [--high HIGH.glb] [--into-colour [--texture IMG --tile M [--turn DEG]]]`: real UVs,
  ambient occlusion in the occlusion slot, and a normal map from `--high` (decimate.py's input). `--into-colour`
  multiplies the AO into a flat base colour, for a solid. With `--texture`, a CC0 photo texture (plywood, painted
  metal) is first projected from the solid's three sides at `--tile` metres a repeat and baked in: the same real scale
  on every face; `--turn 90` runs a wood grain along the piece instead of across it. Don't tile a photo over the baked UVs in the TSX instead: each UV island gets its own grain and scale.
- `rig.py IN OUT --bone NAME=HX,HY,HZ:TX,TY,TZ[:PARENT] ... [--pose CLIP=BONE:RX,RY,RZ/...] [--weights rigid|auto]`:
  bones, weights and named pose clips (plus `Rest`). `rigid` is for parts that don't bend (a lamp, a machine); `auto`
  is for a creature. Fails if a bone gets no vertices. A bone gets the vertices nearest its segment, so run a base's
  bone across the base, not up its middle.
- `cloth.py IN OUT (--sheet W,D,X,Y,Z | --cloth NAME) [--pin box] [--frames 60] [--stiff 5] [--bend 0.05]
  [--crumple 0] [--no-floor]`: a cloth simulated onto what IN holds and a floor at y 0, baked into the clip `Drape`.
  Also writes `OUT.settled.glb`. A flat sheet lands flat: a rag wants `--stiff 1 --bend 0.01 --crumple 0.035` (soft,
  dropped in loose folds).

In the scene, raea decides when a clip plays: `<Model src="media/lamp.glb" animation="Reach" time={t} loop={false}>`
eases in over the clip and holds its last pose past the end. Timing is the Sequence's, never Blender's.

## Setting it up — HEADLESS

- `raea setup blender` finds a Blender (`git config --global raea.blender PATH`, `/Applications/Blender.app`, then
  `blender` on PATH) or downloads the current LTS from blender.org into `~/.raea/tools/blender`, checked against
  blender.org's sha256 list. raea never bundles Blender: it's GPL, so it runs as its own program.
- The same command installs the MCP for Blender add-on into that Blender (it needs uv's `uvx`).
  `raea setup blender --check` only reports.

## Live: the `blender` MCP server, only to look — BLENDER

`raea skills install --agent claude|codex|kimi|gemini` registers a `blender` MCP server for the agent
(`uvx mcp-for-blender`; older installs name it `uvx blender-mcp`). It needs Blender running with its window open.
- Use it only to inspect a bad asset (what are these pieces, where is the hole), or while the person watches.
- A fix made live counts only once it is in a saved script that re-runs from the source.
- Telemetry off, always: call its `disable_telemetry` tool first, or set `BLENDER_MCP_DISABLE_TELEMETRY=1` in the
  server's env. It can otherwise send prompts, code and screenshots to its author.
- `generate_3d` can cost the person a credit, and makes one object only; `raea gen` is the generation route. Ask first.

In the raea app, a workspace gives it to the feed's agents with a controller's servers field holding
`uvx mcp-for-blender` (`raea controller set PATH VALUE`).

## Licences

Only permissive assets (CC0, CC BY with its credit, MIT). Every script refuses a source without a sidecar
(`chair.fbx.json` or `chair.json`: `{"source": URL, "license": "CC0", "credit": ""}`) and carries it through to its
output, with the step added. `raea solid export` writes its own.

## Common mistakes

- Building, lighting or framing the scene in Blender: export one asset, build the scene in TSX.
- Fixing an asset live and moving on: the next source change loses the fix. Put it in the script.
- Modelling a box, a shelf or a bracket in bpy: it's a solid.
- Decimating without `--seen`: the budget is for the distance it's seen from, not a number picked by eye.
- Splitting by guess: read the box from `raea gen check --json`, then cut with `split.py`; check each part's
  triangles in its output.
- Posing a rigged model by moving its mesh: the skin pulls it back. Pose it with a clip (`--pose`).
