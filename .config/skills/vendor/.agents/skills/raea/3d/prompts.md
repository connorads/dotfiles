# Scene prompts: the brief, the builder and the judge

There are three texts to copy and fill: a brief template, a builder prompt and a judge prompt for a fresh context.
`bevy/scenes` says why each step exists. This page gives the words.

Who plays which role:
- **In Claude Code:** the session is the builder. The judge is a new subagent every round, plus `raea judge` (clef-omni)
  for the numbers.
- **In the raea app's feed:** Kimi is the builder and `raea judge` is the judge.

Either way, the judge sees only pictures and the brief's words, never the code or the builder's notes. Code decides
the pass, and the builder never sees the pass line. A figure the builder can read becomes a target to game.

Where these texts come from: the published Blender + Claude workflows.
- dream-loop: the target is a real in-engine screenshot; a per-category rubric; defects named precisely.
- Muska and KOBATAKA: plan before code; route each object.
- ProfRino and AnyScene: placement is measured; pass is decided in code.
- hayashimon: coarse to fine; one shared wear recipe.
- kiln and prasenx: fixed clay and colour cameras; a fresh judge each round; stop after two clean reads.

## What to do

1. Write the brief from the template (section 1). Write a `plan.ts` for every hero object.
2. Start the builder with the builder prompt (section 2), filled from the brief.
3. After every stage and every fix, run step R: the review sheets, then the judge prompt (section 3) in a new context
   and `raea judge` on the same sheets.

## 1. The brief template

The brief is data, in three files:
- `brief.ts` for the scene, made with `brief()` from `raea/brief`.
- A `plan.ts` for each hero object, made with `plan()`.
- For an interior, the room plan that `checkLayout` reads (`raea/room`).

Fields that have no schema yet go in `sections` as text.

```ts
// brief.ts: one place, one time, one look. Fill the brackets; delete nothing.
import { brief } from "raea/brief";
export default brief({
  title: "[PLACE, TIME] e.g. Late-night laundromat, heavy rain",
  logline: "[one sentence: what the viewer sees and feels]",
  look: "[3-5 mood words] + [the real thing it must look like: 'film stills of a 1990s Tokyo laundromat', not 'a game']",
  references: [
    // the TARGET: a real in-engine screenshot of this scene from the hero camera
    { /* media/ref/target.png, role: target */ },
    // real photos, for the judge only; they never ship
    { /* media/ref/real-*.jpg, role: judge-only */ },
  ],
  notDoing: [
    // the do-not-add list: without it the builder adds rain, neon and UI
    "[weather you don't want]", "[time of day you don't want]", "people", "UI, captions, logos", "real brand names",
  ],
  sections: [
    { heading: "Space", text: "[room size in metres; door at z=0, deep along -z; real places are small: 3.5 x 6 m]" },
    { heading: "Zones", text: "[3-6 zones: counter, bench, washers, back shelves ...]" },
    { heading: "Hero camera", text: "[position, target, lens mm, height: the scene's Camera3d, the review sheet's hero tile]" },
    { heading: "Practicals", text: "[every real light source: fixture, colour temperature K, what it lights]" },
    { heading: "Objects", text: "[one row per object: id | what | real size m | route (bevy/scenes) | seen from m]" },
    { heading: "Placement", text: "[the relations: desk against -z, chair facing desk, lamp on desk (place())]" },
    { heading: "Wear", text: "[one recipe for every surface: dust on tops, dirt in gaps and at the floor line, worn edges]" },
    { heading: "Printed matter", text: "[every sign, label and screen: exact text, fictional names, size, age]" },
    { heading: "Motion", text: "[added last, small: one dryer turning, irregular flicker, a slow push-in]" },
    { heading: "Budget", text: "[gen cents cap; judge rounds cap (8)]" },
  ],
});
```

Each generated object needs a reference picture made from this template:

> Studio product photograph of a single real object, photorealistic, true colours, [condition], soft even diffused
> light, plain pale grey seamless background, the whole object in frame with margin, three-quarter view from slightly
> above, sharp focus, no people, no text, no brand names, no logos.

Each hero object gets a plan. Its fields are the frozen contract that `raea solid info --expect` and the judge check
against:

```ts
import { plan } from "raea/brief";
export default plan({
  concept: { what: "coin-op tumble dryer, stacked pair", style: "worn 1990s commercial", size: 1.9, seenFrom: 1.2,
             material: "enamelled steel" },
  parts: {
    cabinet: { role: "body", level: "primary" },
    door:    { role: "door", level: "primary", parent: "cabinet", count: 2, near: "chrome ring, glass with smudges" },
    panel:   { role: "controls", level: "secondary", parent: "cabinet", near: "coin slot, price label, two buttons" },
    vents:   { role: "vent", level: "tertiary", parent: "cabinet", count: { min: 8, max: 20 } },
  },
});
// connection map, one line a joint: door <-> cabinet  hinge side  touches (overlap >= 5 mm)
```

## 2. The builder prompt

Paste it as it is, with the brackets filled from the brief.

```text
You build one 3D scene in raea, the TSX/Bevy engine, from brief.ts, its plans and its reference pictures. The scene
lives in EDIT.tsx and is frame-pure. Read `raea guide bevy/scenes`, `raea guide bevy/meshes` and `raea guide bevy/materials` first.

THE BAR
The target picture media/ref/target.png is a real in-engine screenshot of this scene from the hero camera. The
finished scene must read as the same place, the same objects and the same light. From views the target doesn't show,
invent in the same world. brief.ts notDoing is a hard list: add nothing on it, and nothing the brief doesn't name.

ORDER OF WORK (one stage at a time; a stage that fails its check is fixed before the next one starts)
0. Plan. Every object row in brief.ts has a route, a real size and, for each hero, a plan.ts with its part tree and
   connection map. If any is missing, write it first, from how the real thing is built: look up the real product.
1. Space. Block the room as boxes at real size. Place furniture with place() from raea/3d (on, against, beside,
   near, apart, facing, align, clear), never typed coordinates; its `found` must be empty. Check: `raea run checks.ts`
   with checkLayout(plan) prints no errors. Then step R in clay.
2. Generate in bulk, early. One flow for every generated row: a reference picture from the scan template, then the
   mesh (tripo:H3.1 for close heroes, tripo:P2 for far, edited or rigged ones). Quote it with
   `raea gen plan props.flow.ts`, run it in the background with `raea gen run props.flow.ts -o media/gen`, and run
   `raea gen check` on each mesh it makes (scale against the row's size, `--seen` its distance, `--parts` the parts
   that move, `--rig` if it bends). Look at every reference picture before its mesh runs: no real brands, the whole
   object, one object.
   When a check names a Blender script (`fix: raea blender run blender/X.py ...`), run exactly that, headless, from
   the project's blender/ folder, and `raea gen check` the output. Blender only converts, decimates, repairs, splits,
   bakes, rigs or drapes one asset. Never place, light, frame, material or time anything in it.
3. Objects, big to small: furniture, heroes, mid-size, clutter. Build each as a blockout at its planned bounds, then
   through its levels: silhouette, structure, detail. Organic shapes go in sdf (smoothUnion); trees, lofts, terrain,
   rocks and plants come from grow. Build ONE of a repeated thing, check it, then pattern it. After each object:
   - `raea solid info PART.ts --expect PART.expect.json` passes, and each connection-map joint shows "touching" or
     "overlap".
   - `raea solid view PART.ts -o review/PART` shows the part in colour and clay from the fixed cameras, each piece in
     its own colour. Look at it after every structural change: numbers miss a handle lying flat.
   - `raea scene lint EDIT.tsx --json --part <id>` shows nothing floating, sunk or clipping, and no model in a format
     raea can't load or over its triangle budget. Apply its {y, dy} fixes in code, never by eye, and its Blender
     fixes as saved scripts.
   - A solid that needs real UVs, baked AO or a fillet solids can't make: `raea solid export`, then the script
     `raea solid info` names. Log the gap in review/NOTES.md.
4. Light, practicals first. Every practical in the brief becomes a light at its real colour temperature; fills come last
   and weak. Check with `raea scene light EDIT.tsx --part <hero> --json` and read the EXPOSURE line every render
   prints. No part may be a stop darker than the target shows it. Re-check after every new light.
5. Surfaces. Nothing is left a flat default colour. Use ProceduralExtension patterns (wood, stone, brick, tiles,
   fabric, plaster, ...) or real maps, and give every material the same dust, dirt and edges at different strengths.
   Lay out printed matter as a 2D composition, render it to a PNG, use the PNG as the map, then age it.
6. Motion, last and small, as the brief's Motion says. Then `raea render EDIT.tsx -o out/scene.mp4` and
   `raea check out/scene.mp4`.

STEP R: REVIEW (after every stage, and after every fix)
- `raea render EDIT.tsx --review review/r<n>` writes colour.png and clay.png (hero, front, right, top, iso, low), with
  the same cameras every round.
- Open both sheets and look at every tile yourself. Write your own list. "Looks good" is not a review. Name each
  problem precisely ("the dryer doors are flat grey discs", not "the dryers look off"), with its tile and its fix.
- Run `raea judge review/r<n> --by kimi` (or `--by claude`; plain `raea judge` is clef-omni, cheap but advice only
  until calibrated). Each is a new session that sees only the sheets. In Claude Code you can also hand the sheets to a
  NEW subagent with the judge prompt. Give it only the
  brief's words, the target, the real photos, this round's sheets, and last round's sheets and verdict. Never give it
  your code, your log or your list.
- Fix every blocking defect named, or write in review/log.md why it is wrong and what you checked. A judge can be
  wrong: a shadow read as a hole. Change one material per round. Every fix is code in the scene.
- Re-run the stage's checks after every fix. A fix that breaks a check is not done.

STOPPING (the loop decides, not you)
- Done: `raea judge` prints "done" (two passes in a row), and the last fresh judge named no blocking defect.
- Stall: the score hasn't risen a full point in 2 rounds, or the same defect is named twice. Stop tweaking and change
  the approach for that part: another route (solid, sdf, Tripo HD, Tripo Smart Mesh), a rebuilt light plan, a moved
  camera. A defect that comes back after two fixes is the method's fault, not the dose's.
- Stalled: the big change didn't move it. Stop and show Shane the latest sheets and the open defects.
- Cap: 8 judge rounds per scene. At the cap, deliver and list what is still wrong.

RULES
- One builder at a time on coupled systems (light, exposure, materials). Generation may run in parallel.
- Never trust a command just because it ran: back every claim with an image or a check's output.
- A Blender fix counts only once it is a saved script that re-runs from the source; the live MCP is for looking.
- Never edit the judge prompt, the plans or the review cameras to pass.
- Quote every paid step first, and never spend past the brief's cap.
- Keep review/NOTES.md: one line per thing that cost time.
```

## 3. The judge prompt (a new context every round)

It takes only images and the brief's words, and answers JSON. The pass threshold is not in it.

```text
You review a 3D scene from images only, as the person who will use it would. You have never seen how it was built
and you never will. Judge what is in the pixels; do not guess at intentions.

PART 1, BLIND (answer before reading the brief below):
hero-colour.png is one frame. In one sentence: what place is this, what time, what era? List five objects you can
name. Is it a photograph or a render, and which three tells decided it?

PART 2, SCORED. The brief: "<brief.ts look + logline + notDoing>". The target picture is TARGET.png. Real photos of
this kind of place: REAL_*.jpg. This round's sheets: colour.png and clay.png, tiles hero, front, right, top, iso, low.
The previous round's sheets and verdict, if any: PREV_*.png, PREV.json.

Score each 0-10 (5 = a believable draft; 7 = a production base an artist would accept; 9 = indistinguishable from
the reference). Halves are allowed.
- composition: camera, framing, layout, and the position and scale of every major object, against the target and the
  brief's space.
- form, judged on CLAY: silhouettes read at a glance; parts have real thickness; nothing blobby, melted or a
  primitive standing in for a thing; repeated things vary.
- assembly, judged on CLAY first: nothing floats, sinks, pokes through or rests on the wrong thing; joints touch; the
  low tile shows the feet.
- materials: every surface reads as its real material, with wear where use puts it; nothing a flat default colour.
- light: motivated by the place's own sources; exposure and contrast match the target.
- detail: close views hold real geometry or texture, not a smooth stand-in; printed matter reads; nothing from the
  do-not-add list.
- world: the same place as the target and the real photos; nothing off-era, no real brands, nothing invented
  beyond the brief.

Then list EVERY defect, most damaging first, each as:
  {tile, where in the tile, what is wrong, what the real thing would look like, the fix, blocking|detail}
"Blocking" means someone using this scene would notice it in the views it will be seen in. Name exactly what gives
the scene away: not "the dryer looks fake" but "the dryer door is a flat disc with no rim or glass depth; a real
door has a 3 cm chrome ring and domed glass". If a part must be rebuilt another way, say so. If a previous verdict is
given, stay consistent with it, but don't feel bound to match it or to raise the score; a regression scores lower.
Where the target and the real photos disagree on physics (scale, light falloff, contact), the real photos win.

Answer only this JSON:
{"blind": {"place": "", "objects": [], "photo": "yes|no", "tells": []},
 "scores": {"composition": 0, "form": 0, "assembly": 0, "materials": 0, "light": 0, "detail": 0, "world": 0},
 "defects": [{"tile": "", "where": "", "wrong": "", "real": "", "fix": "", "level": "blocking|detail"}],
 "show_as_is": "one line: would you show this to the person as is, and why"}
```

The loop's rules live in code (`raea judge`), out of the builder's sight:
- A round passes when there is no blocking defect, the lowest score is at least 6 and the mean is at least 7.
- The scene is done after two passes in a row.
- The blind read is reported, not gated, until it is calibrated. Track how often the judge calls our render a photo.

## Why

- A picture first and a do-not-add list keep the builder from inventing a scene nobody asked for.
- A judge that has seen the code forgives what it knows was meant. One that sees only pixels judges what a viewer will.
- Numbers and named defects, with the pass decided in code, stop "looks great" from ending a loop early.

## Common mistakes

- Giving the judge the builder's notes, or the pass line. Its scores then drift toward what the builder hoped.
- Skipping the clay sheet. Materials hide broken form and floating parts; clay shows them.
- Fixing three things in one round. When the score moves, you can't tell which fix did it.
- Calling the scene done on the builder's own reading. Done is two judge passes in a row.
