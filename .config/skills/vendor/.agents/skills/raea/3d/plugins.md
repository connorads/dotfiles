# Bevy plugins from TypeScript: declare, build, generate, call

Any Bevy plugin (crates.io, git or a local path) joins raea without hand-written Rust, unless it needs a protocol or a
predicted simulation. The design and results are in `sdk/raea/docs/bevy-plugins.md`.

**A plugin in the catalog needs no declaration of your own.** The catalog (`sdk/raea/bench/bevy-plugins/package.json`)
is generated into the SDK, so any project imports a plugin's wrappers, types and handle by its name:

```tsx
import { ColliderConstructor, RigidBody } from "raea/plugins/avian";
import { Bloom } from "raea/plugins/bevy";
import { avian, tnua } from "@raea/plugins";   // every catalog plugin's handle, by name
```

The plugin build renders and plays them (`tools/bevy-plugins.sh build sdk/raea/bench/bevy-plugins`). Declare a plugin
yourself, as below, only when the catalog doesn't have it.

## Scenario: physics with a raycast, in a scene and in a program

**1. Declare the plugin** in the project's `package.json`. Its key is the plugin's name, which is also its cargo
feature. Give one version per Bevy minor, so the 0.20 bump only reads a different line:

```json
"raea": { "plugins": {
  "avian": {
    "crate": "avian3d",
    "versions": { "0.19": "=0.7.0", "0.20": "=0.8.0" },
    "features": ["3d", "f32", "parry-f32", "collider-from-mesh"],
    "plugin": "avian3d::prelude::PhysicsPlugins::default()",
    "calls": "avian",
    "headless": ["assets", "mesh"]
  }
} }
```

(`raea.bevy.plugins`, the key's first name, is still read.) `plugin` is the expression `app.add_plugins` takes. The plugin's default features are always off, so list the ones
you need. A source can be `{"git": URL, "rev": HASH}` or `{"path": DIR}` in place of a version.

**2. Build and generate:**

```sh
tools/bevy-plugins.sh build DIR   # sync engine/bevy-plugins, build raea-bevy-sdk, regenerate when versions moved
tools/bevy-plugins.sh check DIR   # fails on drift: versions, Bevy minor, or the generated TypeScript
```

This writes `DIR/bevy/avian.gen.tsx`, generated from the built App's TypeRegistry:
- a TypeScript type for every reflected type;
- a TSX wrapper per component and resource;
- `<AvianSettings>` for the plugin's resources;
- an `avian` object of typed handles for every component, resource, event, message and state.

It also writes `DIR/bevy/plugins.lock.json`, which holds each crate's resolved version and a hash of its schema.

**3a. In a scene (render equals play)**, put the wrappers inside the Mesh3d they belong to. Mark the Mesh3d `driven`,
because the plugin owns its Transform. Keep the composition in DIR, beside `bevy/`: a baked play copies only the
composition's folder, so an import of `../bevy/` from a subfolder fails there:

```tsx
import { AvianSettings, ColliderConstructor, RigidBody } from "./bevy/avian.gen";
<AvianSettings Gravity={[0, -9.81, 0]} />
<Mesh3d name="ball" driven transform={Transform.fromXyz(0, 3, 0)}>
  <Sphere radius={0.4} /><StandardMaterial base_color="#e11d48" />
  <RigidBody value="Dynamic" />
  <ColliderConstructor value={{ Sphere: { radius: 0.4 } }} />
</Mesh3d>
```

**3b. In a program (a headless App, any plugin, any call)**, run it with `raea-bevy-sdk motion run FILE.ts`:

```ts
import { BevyApp, at, with as w } from "raea/bevy";
import { avian } from "./bevy/avian.gen";
const app = BevyApp.open({ plugins: ["avian"], fps: 60 });
const ball = app.spawn(w(avian.RigidBody, "Dynamic"), w(avian.ColliderConstructor, { Sphere: { radius: 0.5 } }), at(0, 4, 0));  // a body starts from its Transform
app.step(90);                                         // Time moves one frame per step, as in a render
app.get(ball, avian.Position);                        // typed: [number, number, number]
app.call("avian3d/cast_ray", { origin: [0, 10, 0], direction: [0, -1, 0] });   // the call bridge
```

Every App answers bevy_remote's methods:
- `world.query`, `world.get_components`, `world.insert_components`;
- `world.trigger_event`, `world.write_message` and `world.observe+watch` (`app.trigger`, `app.write`, `app.observe`);
- `registry.schema` and `schedule.list`.

It also answers raea's `raea/state.get` and `raea/state.set` (`app.state`, `app.setState`), and each plugin's
own methods. `app.methods` lists them all. `BevyApp.stepTogether([client, server], n)` steps several Apps in lockstep,
as a network's peers need.

**4. A dev tool:** `BevyApp.open({ plugins, serve: 15703 })` serves the same methods over BRP's HTTP. Use curl or
any BRP client.

## When Rust is still needed (the escape hatch)

Name a module in `engine/bevy-plugins/src/`:
- `"calls": "name"` adds methods next to a plain plugin;
- `"adapter": "name"` registers the plugin itself.

Write Rust only for:
- **non-component APIs**: SystemParam methods (`SpatialQuery::cast_ray`) and events that aren't reflected (avian's
  `CollisionStart`). Each becomes a few-line BRP method.
- **protocols and predicted simulations**: lightyear's `app.component::<T>().replicate().predict()` and the movement
  system that rollback re-runs. See `src/lightyear.rs`.
- **assets and closures**: a `Handle<EffectAsset>` or a tween's lens. Make it a reflected component of yours that
  builds the plugin's object from numbers, as hanabi's `Particles` does.
- **generic plugins**: `InputPlugin::<A>` needs a concrete type, so the adapter names it.
- **render-equals-play fixes**: a seed, a run condition on `advancing`, or WinitPlugin turned off.

A plugin that opens a window (bevy-inspector-egui, anything egui) doesn't run headless. Use the BRP server as its dev
tool instead.

## The catalog: look before declaring

`sdk/raea/bench/bevy-plugins/package.json` already declares Bevy's optional features (the builtin `bevy` entry:
gamepads, picking, every image and audio format, gizmos, dev tools, the PBR textures and LUTs, meshlets, Solari) and
about 70 ecosystem plugins: input, character controllers, tiles, asset formats, particles, cameras, UI, pathfinding,
tweening, noise, networking and dialogue. Copy an entry from there rather than writing one; each has its 0.19 and 0.20
pins, and `null` where a plugin has no release for that Bevy yet (a build on it leaves the plugin out).

Generic plugins already have adapters that TypeScript drives:
- input: `leafwing/player` and `leafwing/state` (leafwing), `enhanced_input/pawn` and `enhanced_input/state`;
- a character: `tnua/character`, then write `TnuaInput {motion, jump, crouch, dash}` each frame;
- data files: `common_assets/load` and `common_assets/get` (JSON, RON, TOML, YAML, MessagePack, CBOR, CSV);
- noise: `noise/sample`, `noise/grid`;
- schedules as Graphviz: `debugdump/schedule`.

A headless program presses keys and mouse buttons with `app.call("raea/input", { key: "Space" })` (`pressed: false`
releases). `run.sh catalog` proves each plugin alone; see "The catalog" in `sdk/raea/docs/bevy-plugins.md`.
