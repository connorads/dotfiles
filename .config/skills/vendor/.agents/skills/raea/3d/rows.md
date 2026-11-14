# The rows path: adding a Bevy feature to raea/3d

For coding sessions in raea. A feature is four pieces and two checks.

## 1. The component (sdk/raea/src/3d.tsx)

- A function component that validates its props (throw a `TypeError`/`RangeError` naming the prop and the value) and
  returns `node3d("Kind", props)`: a `<div data-3d=Kind data-props=JSON>`. Normalise colours with `toHex`.
- Anything time-based is computed here from `useCurrentFrame()` and passed as a plain number (Model's `time`), so the
  engine never reads a clock.
- Export it, add it to `sdk/raea/spec/motion.feature` ("3D: the rest of a scene") and, if it's a geometry, give it a
  Manifold expression (`geometry(...)` or `data-shape`).

## 2. The rows (runtime/scene)

- `walk` maps the element kind to an item kind (and composes Group transforms). `tracks` matches items across frames.
- Emit a row per track in `rows_into` (or a camera column in `camera`). Use `column(p, row, id, name, &per_frame)`
  for anything that may change: it writes the first value and keys every frame only when the value changes.
  Static values (strings, flags) come from the track's first frame.
- `RAEA_SCENE_ROWS=1 raea render EDIT.tsx --frame N -o x.png` prints the 3D rows.

## 3. The engine (runtime/scene3d/src/lib.rs, hooked from engine/render/src/engine.rs `load_shared`)

- Spawn: insert Bevy 0.20 components for the row (required components, no bundles). Names to know:
  `shadow_maps_enabled` on lights, `WorldAssetRoot` for glTF scenes, `bevy::post_process::bloom::Bloom` (requires
  `Hdr`), `bevy::camera::Exposure`, `AnimationGraph::from_clip`, `AnimationGraphHandle`, `GlobalAmbientLight` vs the
  per-camera `AmbientLight`.
- Per frame: a `sync_*` system reads `frame.vals(entity)` (the row's values at the clock) and writes the component,
  only for columns the row has (old rows must draw as before) and only when the value changed.
- Anything loaded asynchronously must be awaited in `load_shared` before the first frame (see `await_models`).
- Never advance anything by Bevy's `Time`: seek, set or compute from the row.

## 4. A fixture (sdk/raea/bench/bevy/NAME/edit.tsx)

A 60-frame composition that uses the feature with motion, media under `media/`.

## Checks

```sh
lane build -- cargo build --release -p raea-cli -j 6
sdk/raea/bench/bevy/check.sh                       # render vs baked play with 3D, SSIM >= 0.999 on every fixture
sdk/react/bench/games/replay.sh arena3d              # a 3D game played live vs a render of its logged input
sdk/raea/bench/bevy/skills.sh                      # every skills example renders
lane build -- cargo test --release -p raea-render -j 6   # raea-render's tests
sdk/react/bench/timelines/check.sh                   # 2D render vs play
(cd sdk/raea && bun test conformance)
```

Then update `sdk/raea/docs/bevy-coverage.md` and the topic file in `sdk/guides/craft/bevy/` with a working example.

## Sources

Bevy's own v0.20.0 examples (MIT OR Apache-2.0; also in the cargo cache under `bevy-0.20.0/examples`) and the
[0.19 to 0.20 migration guide](https://bevy.org/learn/migration-guides/0-19-to-0-20/) are the API references. The
survey of other agent packs, with licenses, is at the end of `sdk/raea/docs/bevy-coverage.md`.
