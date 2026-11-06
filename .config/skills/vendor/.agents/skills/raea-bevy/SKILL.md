---
name: raea-bevy
description: Writing 3D scenes and 3D games in raea's TypeScript SDK (raea/3d), which Bevy 0.20 draws, and extending that SDK. Use when writing or fixing TSX with Camera3d, Mesh3d, lights, StandardMaterial and other materials, Model (glTF), ImagePlane, Bloom/Fog/ToneMapping or an ECS world drawn with Entities; when a 3D render or play looks wrong; or when adding a Bevy feature to the SDK (the TSX component, its raea-render rows, the engine system).
---

# raea-bevy (on hold): Bevy through raea/3d

<!-- LOCAL PATCH (connorads dotfiles): raea is on hold until its releases are built in CI with provenance; agents must not install it. -->

raea is not installed on this machine, and it is on hold. Do not install it. Read the "Set up (on hold)" section of
the `raea` skill first.

Agents write TSX; raea compiles each frame's 3D elements to raea-render rows and its engine draws them with Bevy 0.20. You
never write Rust or shaders to make a scene, and you never use Bevy's API directly from TSX. A render and a live play
draw the same rows with the same code, so they match whenever every value comes from the frame.

This is the same library the feed's agent reads with `raea guide bevy/NAME` (`sdk/guides/craft/bevy.md` routes it);
the topic files here link to those, except `rows.md` and `plugins.md`, which only this skill has.

## Which file to open

| You are... | Open |
|---|---|
| setting up the camera, camera moves, entities, 2D under and over 3D | `scene.md` |
| lighting: sun, bulbs, spots, ambient, shadows, brightness | `lights.md` |
| surfaces: colour, metal, glass, glow, clearcoat, picture maps, toon (cel) shading and ink outlines (`ToonMaterial`), wear (`WearExtension`), decals (`Decal`), a model's materials re-covered (a material inside its `Model`) | `materials.md` |
| shapes: primitives, Manifold solids, Text3D | `meshes.md` |
| people: Anny bodies posed by goals (a hand on a point, feet, gaze, a seat), motion capture clips, motion matching along routes round the furniture (`Character`, `perform`) | `characters.md` |
| interiors: rooms, runs of units, windows and bays, seats turned to tables (`faceToward`), layout checks, wall decor (`hang`), the garden outside, daylight, 3D sound (`Sound3D`) | `rooms.md` |
| motion: spins, springs, Sequences, model clips | `animation.md` |
| a 3D game: state, input, entities, collisions, state machines | `games.md` |
| a game's sound: one-shots on transitions (`<Tone.Sfx>`), buses, a bed ducked under a voice (Tone.js on raea) | `games.md` (Sound), then `raea guide motion/music` |
| glTF models, pictures in space, media files | `assets.md` |
| gaussian splats: a real scene or object trained from footage (`raea splat train`), `<Splat>` and its reveal, assemble, disperse, explode, wave, twist, morph, pulse | `splats.md` |
| liquids and goo: coffee dumped from a mug, a tap's stream, honey, things melting (`<Goo>`, sph or mpm, baked) | `liquids.md` |
| bloom, fog, tone mapping, exposure, fisheye and lens distortion, motion blur, fire (`<Fire>`), frame looks (pixel, ink, painted illustration `<Look mode="paint">`, cartoon `<Look mode="cartoon">`) | `post.md` |
| budgets, render-equals-play rules, what isn't there yet | `limits.md` |
| adding a Bevy feature to the SDK, or debugging the rows | `rows.md` |
| using a Bevy plugin (physics, networking, particles, any crate): declaring it, its generated TypeScript, calling it from a program (`BevyApp`), BRP as a dev tool | `plugins.md` |

## The rules that keep a render equal to its play

1. Every value from the frame (`useCurrentFrame()`, `interpolate`, `spring`, a game's state at the frame). No
   `useState`, `useEffect`, refs or `useFrame`; `Math.random()` draws new numbers every frame (seed what holds still).
2. Rotation in radians (`Quat.fromEuler`, a `fov`); Manifold's `.rotate()` in degrees.
3. Colours are hex strings (CSS variables don't reach the 3D).
4. Name parts that come and go (`<Mesh3d name="...">`); parts are matched by name, else kind and shape in tree order.
5. A part's shape is fixed; animate its `transform`, colour, opacity, emissive, roughness, metallic.
6. One camera (the first), one set of effects (the first frame's; the lens and MotionBlur animate per frame).
7. Import each component from its Bevy-named module (`raea/mesh`, `raea/pbr`, `raea/light`, `raea/camera`,
   `raea/transform`) or `raea/prelude`; `Entity`, `Model` (and `Canvas3D` for `layered`) from `raea/3d`; hooks, `Sequence`, `staticFile`
   from `raea`.
8. Render and look: `raea render EDIT.tsx --frame N -o F.png`.

## The modules, in the order a frame is made

raea's modules are named as Bevy's crates are (`raea/camera` is bevy_camera's names), so a name is where a Bevy
developer would look. Read them in the pipeline's order; the order is for reading, not a set of import paths:

| stage | what happens | modules |
|---|---|---|
| sources | images, video frames, audio, generated content | `raea/asset`, `raea/image`, `raea/video`, `raea/audio` |
| evaluate | state for a time or a simulation step | `raea/time`, `raea/state`, `raea/app` (systems), `raea/animation`, `raea/math`, physics |
| compose | content, layers, cameras, effects combined | `raea/transform`, `raea/ui`, `raea/sprite`, `raea/mesh`, `raea/pbr`, `raea/light`, `raea/camera` |
| render | pixels or render targets (the engine draws; nothing chooses CPU or GPU) | `raea/post_process` |
| output | presentation, capture, encoding | `raea/app`'s window, the export's settings |

A camera or a material belongs to more than one stage, which is why the stages aren't packages. An import is one of
two kinds: `raea/prelude` for everything, or one Bevy-named module when a file wants one subject.

## Checks in the raea repo

- `sdk/raea/bench/bevy/check.sh [EDIT.tsx]`: render against baked play with 3D (SSIM >= 0.999) on the fixtures.
- `sdk/raea/bench/bevy/skills.sh`: every example in this library renders.
- `sdk/raea/docs/bevy-coverage.md`: the full coverage matrix and the proposed API for what's missing.
