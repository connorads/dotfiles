# Whole scenes: brief, build, review, judge

A believable scene is planned before it is modelled, built big to small with a measured check after every step, and
reviewed from the same fixed cameras every round by a judge that has never seen the code. This is the loop the people
who make striking Blender scenes with an agent use (the 11-06 research: dream-loop, AnyScene, kiln, prasenx,
hayashimon, KOBATAKA), each step on a raea verb.

## What to do

The brief template, the builder prompt and the judge prompt to paste are in `bevy/prompts`.

### 1. The brief: a picture, a size, and what not to add

- `brief.ts` (`brief()` from `raea/brief`) holds one place, one time, one look:
  - `look`: three to five mood words, plus the real thing it must look like ("film stills of a 1990s Tokyo
    laundromat", never "a game").
  - `references`: the target, which is a "real in-engine screenshot" of the scene from hero camera 1
    (`raea gen image "..." --aspect 16:9 -o media/ref`), and real photos of the kind of place, used for judging only.
  - `notDoing`: the do-not-add list (weather, time of day, people, UI, real brands). Without it the agent adds rain
    and neon.
  - `sections`:
    - Space: real metres. Real places are small; a shop is 3.5 x 6 m.
    - Zones.
    - Hero cameras: position, target, lens.
    - Practicals: each real light source and its kelvin.
    - Objects: one row per object, `id | what | real size m | route | faces | seen from m`.
    - Wear.
    - Printed matter.
    - Motion.
    - Budget: generation cents and judge rounds.
- Each hero object gets a `plan.ts` (`plan()`) with its concept (what, style, size, seenFrom, material) and parts, each
  with a role, a level (primary, secondary, tertiary), a parent, a count and `near` detail. Below it, add a connection
  map with one line per joint: `door <-> cabinet  hinge side  touches`.
- Write the plan from how the real thing is built: look up the product, the catalogue or a drawing.

### 2. Route every object: which tool makes which kind of thing

Ask one question of each object: **is it defined by numbers, by a rule, or by its looks?**
- **Numbers** (sizes, a hole that must fit, a hinge line): Manifold solids, or `raea/room` for the shell.
- **A rule** (a blend of bodies, a branching, a field of copies): `sdf.*`, `grow.*`, `<Instances>`.
- **Its looks** (a worn tool, a lamp, food, anything with character): `raea gen` or a CC0 library model.

The TSX is always the scene. Blender is only a workshop an asset passes through on its way into `media/`, when a
check names a script (`bevy/blender`). It never places, lights, frames, materials or animates the scene.

| the object | made by | then in Blender when |
|---|---|---|
| **numbers**: walls, counters, shelves, boxes, frames, pipes, sign boards, anything a hinge must fit | Manifold solids (`manifold.*`, `<Mesh3d shape={solid}>`, `bevy/meshes`) | it needs real UVs or baked AO (`raea solid info` names bake.py when the file's `needs.textured` is set), a cloth falls on it (cloth.py), or a fillet solids can't make: `raea solid export` first, and log the gap |
| **numbers**: the room shell, runs of cabinets, openings, hung decor | `raea/room` (`bevy/rooms`) | never |
| **a rule**: a creature, a limb, a handle grown from a body, a melted or poured form | `sdf.*` fields with smooth unions, `.solid()` (`bevy/meshes`, "Organic shapes and growth") | it must bend (rig.py, after `raea solid export`) |
| **a rule**: too many or too organic to place by hand: trees, terrain, boulders, succulents, a vase's profile | `grow.tree`, `grow.terrain`, `grow.boulder`, `grow.rosette`, `grow.loft` | never |
| **a rule**: a lawn, a meadow, a field of copies | `<Grass>`, `<Instances>` with `scatter()` (`bevy/meshes`) | never |
| **looks**, seen close (under about 2 m) or a hero: appliances, tools, electronics, crockery, food | `raea gen` mesh, `tripo:H3.1` (`motion/gen`) | `raea gen check` names a script: over the triangle budget for `--seen` (decimate.py), debris or holes (repair.py), one blob where `--parts` names moving parts (split.py), no skeleton with `--rig` (rig.py) |
| **looks**, seen far, to be edited or rigged, or numerous | `raea gen` mesh, `tripo:P2` (quads) | the same checks; P2's quads rig better |
| **looks**: an exact real asset exists under CC0 (Poly Haven, ambientCG) | `<Model>` (`bevy/assets`) | it's FBX, OBJ or .blend (convert.py), or heavier than its distance needs (decimate.py) |
| far background | a generated picture on an `ImagePlane` | never |

- Every generated row carries its real height, and for boxy things its dims (generators invent depth):
  `raea gen mesh "..." --h 0.9 --turn 0` measures the model and fits it on the way in (`raea gen check` reports
  size, facing, pivot, pieces and triangles).
- A reference picture for each generated prop uses the scan template: *Studio product photograph of a single real
  object, photorealistic, true colours, [condition], soft even diffused light, plain pale grey seamless background,
  the whole object in frame with margin, three-quarter view from slightly above, sharp focus, no people, no text, no
  brand names, no logos.*

### 3. Build, one stage at a time; a stage that fails its check is fixed first

0. **Plan.** Every object row has a route and a real size, and every hero has a `plan.ts`.
1. **Space.** Block the room as boxes at real size. Place furniture by relations, not typed coordinates:
   `place({ room, objects, rules })` from raea/3d. Rules are `on`, `against` a wall, `beside`, `near`, `apart`,
   `facing`, `align` and `clear` (floor kept free in front). It returns each object's `center`, `base` and `yaw`,
   plus `found` for whatever couldn't hold. Check: `raea run checks.ts` with `checkLayout(plan)` prints no
   errors. Then review it in clay (step R).
2. **Generate in bulk, early.** Put every generated row in one flow:
   - Quote it first with `raea gen plan props.flow.ts`.
   - Run it in the background with `raea gen run props.flow.ts -o media/gen`.
   - Look at every reference picture before its mesh runs.
3. **Objects, big to small.** Go in this order:
   - Furniture, then heroes, then mid-size things, then clutter. Block each one out at its planned bounds first.
   - Then work each part through its levels: silhouette, then structure, then detail.
   - Build ONE of a repeated thing, check it, then pattern it.
   - After each object, run `raea scene lint EDIT.tsx --json --part ID`. It must show nothing floating, sunk or
     clipping. Apply its `{y, dy}` fixes in code, never by eye. Each joint in the connection map must touch.
4. **Light, practicals first.** Give every practical its real kelvin, and add fills last, weak.
   - Check with `raea scene light EDIT.tsx --part HERO --json`.
   - Read the EXPOSURE line `raea render` prints for every still. It gives mean luma, the 1st and 99th percentiles,
     what clips and what crushes, and the stops from mid grey.
5. **Surfaces.** Give every material one wear recipe, at different strengths: chipped edges, dirt in gaps, dust on
   tops, grime at the floor line (`ProceduralExtension`'s `dust`, `dirt` and `edges`, or `WearExtension` on paint; see `bevy/materials`). Leave nothing a
   flat default colour. Lay out printed matter as a 2D composition, render it to a PNG, use the PNG as the map, then
   age it.
6. **Motion, last and small.** Then `raea render EDIT.tsx -o out/scene.mp4` and `raea check out/scene.mp4`.

### R. Review after every stage and every fix

- Run `raea render EDIT.tsx --review review/rN`. It renders the same fixed cameras every round, computed from the
  scene's bounds and written to `review/rN/cameras.json`: hero (the scene's own camera), front, right, top, iso, and
  low at 0.3 m.
- Each camera is rendered in colour and in clay (every material light grey, so form and assembly are judged without
  surfaces).
- The cameras are stitched into `colour.png` and `clay.png`, with a JSON sidecar of the tiles and their exposure.
  `--clay` alone renders any frame in clay.
- Open the sheets and look at every tile yourself. "Looks good" is not a review. Name each problem with its tile and
  its fix, for example "the dryer doors are flat grey discs".
- Hand the sheets to the judge (below). Fix every blocking defect it names, or write down why it is wrong and what
  you checked.
- Change one thing per material per round. Re-run the stage's checks after every fix.

### The judge

- `raea judge review/rN --brief brief.ts --target media/ref/target.png --json` sends the sheets to clef-omni with a
  frozen rubric, and only the sheets and the brief's words: never the code or your log.
- It returns 0-10 scores for composition, form, assembly, materials, light, detail and world, plus every defect as
  `{tile, where, wrong, real, fix, level}`.
- Code decides the pass. The thresholds are not in the prompt, and you do not tune toward them.
- In Claude Code you can also judge with a fresh subagent every round, given only the sheets, the brief and the
  previous verdict.
- The judge doesn't gate until it has been calibrated against Shane's eye (`raea judge eye` and
  `raea judge calibrate`). Until then its scores are advice.

### Stopping

- **Done:** two fresh judges in a row pass the scene.
- **Stall:** the score hasn't risen a full point in 2 rounds, or the same defect has been named twice. Stop tweaking
  and change the approach for that part: another route (solid, field, Tripo HD, Tripo Smart Mesh), a rebuilt light
  plan, or a moved camera. A defect that comes back after two fixes belongs to the method, not the dose.
- **Stalled:** the big change didn't move it. Show the latest sheet and the open defects.
- **Cap:** 8 judge rounds a scene, 3 per object system. At the cap, deliver and list what is still wrong.

## Why

- Fixed cameras and a clay pass are what every strong source judges on. Colour hides bad form, and a moving camera
  hides regressions.
- A judge that has seen the code grades the intent, not the pixels. A judge that knows the pass line gets gamed.
- Measured checks (lint, light, exposure, gen check) catch what eyes miss: a 3 cm float, a fridge at 4 m tall, a
  frame two stops under.

## Common mistakes

- Modelling the hero from primitives when it has character: route it to Tripo HD, or to a field if it is organic.
- Placing generated models by nudging transforms: fit them on the way in (`--h`, `--turn`), then lint.
- Several fixes to light and materials at once: they are coupled, so do one a round.
- Calling a stage done because the command ran: every claim needs an image or a check's output.
