# People: characters, poses, goals and motion matching

People in a scene are Anny bodies (`raea/character`) in the playtest's graph paper, so a film's paint look shades
them like everything else. A body's pose comes from one place: a held pose, a clip of motion capture at the frame's
time, or a performance the motion matcher works out from where the scene sends the body. Goals on top of the pose put
its hands, feet, gaze and seat on the scene's real things, said in the scene's coordinates.

## What to do

- Make the body once: `~/.cache/raea-anny-venv/bin/python sdk/raea/tools/anny/character.py kid --out media/characters`.
  This writes `body.glb`, `body.hull.glb` (its ink outline), `joint.glb` and `skeleton.json`. `kid` and `adult` are
  presets; slider overrides go after the name, e.g. `gender=0.2 height=0.7 weight=0.6`. Import the skeleton:
  `import kid from "./media/characters/kid/skeleton.json" with { type: "json" }`.
- Register it once (`registerBody(kid)`: its glbs are in `media/characters/kid`) and draw it:
  `<Character body="kid" pose={p} position yaw scale goals />` (`skeleton` and `src` still work). Place it
  with its own `position`, `yaw` and `scale`, never inside an `<Entity>`: its skin's joints are placed in the skin's own
  frame, and entities are flattened before the engine sees them. Use `outline={false}` under a look that draws its own
  ink.
- Break the body up with `glitch={{ explode, scramble, jitter, snap, smear, seed }}` (physics.tsx's `Glitch`, keyed
  per frame): the skin's own triangles break up in its bind pose and the skin still poses them, so it keeps moving
  with the bones; the hull is glitched the same. `smear` is metres in the world, turned into the body's bind pose
  through its heaviest joint. The whole body is one part, so the values bite harder than on a prop: explode 0.05-0.15,
  scramble 0.02-0.06 (higher pulls vertices right across the body into spikes), jitter 0.01-0.03, snap 0.03-0.08.
- Draw echoes of a body with `ghost={{ color, opacity, emissive, emissiveIntensity, unlit }}`: the skin in one flat
  colour (unlit by default, its picture off), see-through under `opacity`, glowing with `emissive` under Bloom, and no
  hull unless `outline` asks for one. Each echo is its own Character of the same body with its own `name` (`kid-echo1`,
  ...) posed at an earlier frame.
- A held pose is bones aimed in the body's frame (x its left, y up, z ahead):
  `held(kid, { upperarm_r: [-0.3, 0.9, 0.2], lowerarm_r: [-0.1, 1, 0.3] })`. Joints carry MakeHuman's game_engine
  names, which `B` in `raea/character` holds (`B.upperarm("R")`): pelvis, spine_01 to spine_03, neck_01, head,
  clavicle_l, upperarm_l, lowerarm_l, hand_l, thigh_l, calf_l, foot_l, ball_l, the fingers' thumb_01_l to pinky_03_l,
  and each with `_r`.
- Goals, in the scene's coordinates:
  - `hands: { R: { at: MOUSE, point: [0, 0, -1] } }` rests the right palm on the mouse, flat, fingers pointing that way.
    Leave out `point` to bring the hand there as the pose holds it.
  - `feet: { L: { at } }` stands the left ankle over a floor point, with the sole flat.
  - `look: SCREEN` turns the head, with the neck sharing the turn.
  - `sit: { at: SEAT_TOP }` gives a static seated pose.
  - `weight` (0..1) eases all of them in or out.
  - The back leans toward the hands until they're in easy reach; `lean: false` keeps it upright.
- Motion capture: retarget CMU's BVH files onto the body once:
  `bun sdk/raea/tools/retarget.ts media/characters/kid/skeleton.json clips.json walk=16_15.bvh sit=113_15.bvh@1.4-6`
  (cgspeed's conversion, free for any use; the subject index is in `~/.cache/raea-mocap/cmu/index/all.tsv`). Then
  `clipPose(readClips(clips).get("walk")!, frame / fps, { loop: true })` gives the pose at any moment.
- Other skeletons retarget through a joint map: `retarget.ts SKELETON OUT --map sdk/raea/tools/maps/100style.json
  NAME=Neutral_FW.bvh@5.5-45`. 100STYLE (CC BY 4.0, credit it in a NOTICE) is 100 walking styles at 60 fps; its
  `LeftShoulder` is the upper arm and `LeftCollar` the collarbone. Fetch single files from its zip by HTTP ranges rather
  than the whole 1.5 GB (the example's styles.json holds Neutral, Elated, HandsInPockets and Old).
- Motion matching (`raea/matching`) walks a body where the scene says:
  - `const lib = motionLibrary(kid, readClips(clips), { locomotion: [...walks, turns, standing], sit: { clip, down, sat, up } })`
  - `const perf = perform(lib, { at, facing, frames, steps })`. Steps are `{ walk: route(from, to, footprints, { bounds }), face }`, `{ wait: s, face }` and `{ sit: seat, for: s }`.
  - Draw `pose={perf.pose(frame)}` with the Character at the origin.
  - Walk to `seatApproach(lib, seat)` before a sit step.
  - `perf.phase(frame)` says when the body is sat, so hand and gaze goals can ease in and out.
  - The routes keep 0.3 m clear of the footprints, which are the scene SDK's `runFootprint`, `modelFootprint` and
    `seatFootprint` boxes.
  - From a scene SDK `Plan`, say where in its terms: `through(room, opening)` is a spot just inside a doorway,
    `before(run, "fridge")` a spot before a unit facing it, and `walkPlan(plan, from, to)` the walk step between them
    round the plan's runs, islands, furniture and seats, inside its walls (`planFloor(plan)` gives the obstacles and
    bounds). A front wall's `at` runs from the right-hand corner.
  - `perf.step(frame)` says which step a frame is in (`walk`, `wait`, `sit`), with seconds since and left, and null
    after the steps: ease a hand goal in while the body waits (`{ hands: { R: { at: HANDLE } }, look: HANDLE }`).

- The motion library (`~/.cache/raea-mocap/lib/kid`, built by `bun sdk/raea/tools/library.ts`): 100STYLE's 100
  styles (forward walk `STYLE_FW` and stand `STYLE_ID`) and 1,347 CMU clips (everyday actions, runs, jumps;
  `cCLIP`), 8.6 hours, with `index.json` (what each clip is), a `.table.json` per clip file (the matcher's per-frame
  table: pass them as `motionLibrary(..., { table: [...] })` and nothing is worked out at load), `styles.json` and
  `effects.json`. Copy the clip files a scene uses next to its edit (the bundler sees only the edit's folder).
- A walk in a state: `perform(lib, { ..., state: "Old" }, { effects })`. A state is a style's name (`Old`,
  `LimpLeft`, `Zombie`), a state's (`sad`, `happy`, `angry`, `proud`, `tired`, `drunk`, `scared`, `crouched`,
  `limp-left`, `walking-stick`; `STATES` in `raea/effects`), a mix (`{ sad: 0.6, "limp-left": 0.8 }`) or measurements
  (`{ trunkPitch: 25, headPitch: 30 }`), on the spec or per step. The matcher picks the library's own frames of the
  style where it has them, at the style's pace; `effects` (`effects.json`) lays what they lack over them (posture,
  amplitude, cadence learned from 100STYLE against its Neutral; asymmetries, so a limp, are kept per side). For a
  crouch use `crouched` (CMU subject 136's crouched walk), not 100STYLE's `Crouched`, which is only a bent walk (its hips
  drop 4%, a real crouch's 13-16%).
- Style measurements (`raea/style`): `styleOf(skel, clip, f0, f1)` gives 23 readable numbers for a stretch
  (speed, cadence, arm swing per side, trunk and head pitch, shoulder raise, knee bend, bounce, sway, asymmetry,
  energy, jerk); `nearestStyles(table, { trunkPitch: 25 })` searches a table of them.
- Actions through a course: `motionLibrary(..., { actions: ["c127_25"] })`, then a step `{ act: "c127_25", anchor,
  at: [x, z], face }` plays the clip with its moment over the obstacle (`anchor`) at the spot, along `face`. Lay the
  course out from what each capture clears: `fitAction(kid, clip, "hurdle" | "box" | "duck" | "dive" | "gap")` gives
  the anchor, the run-up and run-out speeds and distances, and the obstacle's place and height. The walks between
  carry the speed through: `{ walk, speed, enter: fit.vOut, leave: next.vIn }`. CMU subject 127 is an obstacle run
  (hurdle 127_25-28, run over a box 127_33-36, duck under 127_29-32, dive and roll 127_23-24, runs, quick stops);
  49_04-05 leap a gap. `examples/character/course.tsx` is a side-scrolling course.
- Clothes are made for SOMA's body with `raea clothes`, never modelled by hand:
  - `raea clothes make tee --plain --set shirt.length=1.5 --colour "#e8e2d6"` sews one: a sewing pattern cut to
    SOMA, draped on the body and baked, for nothing, in about 20 seconds. `--plain` starts from a plain
    short-sleeved top; each `--set PATH=VALUE` changes one setting. Trousers:
    `--set meta.upper=none,meta.bottom=Pants,meta.wb=StraightWB,pants.length=0.8`. A hood:
    `--set collar.component.style=Hood2Panels`. `raea clothes settings` lists every setting and what it may be.
  - `raea clothes make hoodie "a hooded sweatshirt"` takes the pattern from the words instead, as a first guess.
    It says what it made ("made: ..."); correct it with `--set`.
  - Look at the garment's pictures in `assets/clothes/NAME/` (`NAME_front.png` ...) before you wear it.
  - `raea clothes cover shorts --parts hips,thigh:0.5 --colour "#1f2a44"` lays one on the skin by procedure: for
    what is skin-tight (leggings, a swimsuit, socks). It can't hang free.
  - `raea clothes wear assets/characters/dressed trousers tee --body assets/characters/NAME --head HEAD_DIR` writes
    a dressed body folder. Register that folder with `registerBody`, and give each garment's glb to `<Character>`
    as one of its `parts`.
- An act no capture holds (wave at the camera, shrug, look at a watch) is made from its words with `raea motion`:
  Kimodo, run on the machine itself (no cloud GPU). On a Mac it runs on MLX. On Linux and Windows it runs upstream
  Kimodo on PyTorch. Both write the same clip file.
  - `raea motion "A person waves at the camera" --keys stand.json --seconds 4 --seed 2 -o wave.clip.json` takes about
    8 seconds on a Mac. Say who moves ("A person ..."), as Kimodo's captions do. `--keys` holds the body to poses or
    places on given frames: `bun sdk/body/tools/between.ts` writes standing keys at both ends, so the act starts and
    ends where the walks around it can join it.
  - Each seed is another take, and a take can stand still through its line. `bun sdk/body/tools/makedo.ts SKELETON
    LIBDIR OUTDIR "wave at the camera" ...` makes a stage's `do` lines with three seeds each, and keeps the take
    that passes the body's checks and moves most. A seed is a different take on MLX and on PyTorch, because their
    noise is drawn differently.
  - On a Mac, the first use fetches the motion model (1.1 GB), and the first new line the text encoder (8.8 GB).
  - On Linux and Windows, run `raea setup motion` once first. It needs uv (https://docs.astral.sh/uv) on PATH. It
    makes a Python environment in raea's models folder with PyTorch and upstream Kimodo, then fetches the weights,
    about 26 GB in all. With an NVIDIA GPU the motion runs on CUDA. The text encoder (16 GB in bf16) joins it on a
    GPU of 18 GB or more; on a smaller card it runs on the CPU and needs about 18 GB of memory. Without an NVIDIA GPU
    everything runs on the CPU, which is slower. `raea setup motion --check` says what is set up and where each part
    runs.
  - A line's words are read once and kept, so the text encoder loads once a line.
  - Licences: Kimodo's code is Apache-2.0 and its weights are under NVIDIA's Open Model License (commercial use
    allowed). The text encoder is Meta Llama 3 8B Instruct (Meta Llama 3 Community License) with LLM2Vec's adapters
    (MIT).

```tsx
const perf = perform(lib, { at: [0.4, 0, 2], facing: Math.PI / 2, frames: 450, steps: [
  { walk: route([0.4, 2], seatApproach(lib, SEAT).at, [TABLE], { bounds: ROOM_BOX }), face: seatApproach(lib, SEAT).face },
  { sit: SEAT, for: 5 }, { wait: 1.5 }] });
const ph = perf.phase(frame), on = ph?.stage === "sat" ? Math.min(1, ph.since / 0.7, ph.left / 0.7) : 0;
<Character body="kid" pose={perf.pose(frame)}
  goals={on > 0 ? { weight: on, hands: { R: { at: MOUSE, point: [0, 0, -1] } }, look: SCREEN } : undefined} />
```

## Why

The skeleton is MakeHuman's game_engine rig, raea's one character skeleton (an Anny body's and a psx person's
alike): 22 joints for the body and 30 for the fingers, each joint's rest frame the world's, standing in the body's own
A-pose. The skin is bound to those same joints with MakeHuman's own weights, so body.glb's bones are the skeleton's
joints by name and a pose turns them directly. A capture's own joint names are read once, through its map
(sdk/raea/tools/maps), when its clips are retargeted onto the body. So a clip retargets joint by joint, and the
goals are analytic: two-bone IK, soft over the last 3% of reach so pinned feet don't snap the knees. A performance is
simulated once from frame 0 for its spec, and each frame reads its pose, so a render and a live play agree. The feet
are pinned to the floor while they stand, and switches between clips are blended out over a fifth of a second.

## Common mistakes

- A Character inside an `<Entity>`: the skin goes twice as far. Use its `position`, `yaw` and `scale`.
- A seat goal's `at` at the seat's middle height, or a chair's origin: it is the seat's top surface under the hips.
- A hand goal at the middle of a mouse's box: give the point the palm rests on (its top).
- A performance's `frames` shorter than its steps: it stops where it is. Leave `frames` out and it lasts as long as
  the steps.
- Subject 16's straight walks for the walking: they swing the arms 16 cm and read as weightless. Walk on 07_01,
  07_06, 08_01 and 08_02 (38 to 49 cm, at the matcher's default 1 m/s), with 16's turns and stops beside them.
- No standing clip in the library: a body that can't find a still frame never quite stops. Include 77_02 or 111_28.
- A state's walk at the default pace: a style walks at its own (100STYLE's actor at about half CMU's), so leave the
  step's `speed` out and let the state set it.
- An obstacle placed by eye: lay it from `fitAction`, or the body clears air beside it.
- Reaching past the arm and the lean (0.9 rad at most): the arm locks straight. Move the seat or the target nearer.
- Forearms in a desk's front edge: the elbows hang lower than a real typist's, a known limit of the elbow's pole.
