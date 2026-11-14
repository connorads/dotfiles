# Limits: how much a scene holds, and what isn't there yet

## Budgets

- **Meshes:** a `<Mesh3d>` or `<Model>` is one entity, so a few hundred animated ones are fine and thousands are not.
  Many copies of one thing are an `<Instances at={scatter({...})}>` (one glTF or one mesh at many placements, drawn
  by the GPU as instances: a forest, a suburb's houses, 40k grass clumps), and a lawn is `<Grass>` (`bevy/meshes`).
  Instanced copies share one surface, can't play a clip and are fixed for the shot (move the whole set).
- **Distinct shapes** are built once each; reusing the same geometry and args is cheap, a new solid per part is not.
  Build Manifold solids at module level.
- **Shadows:** a directional light's are cheap. A shadow-casting PointLight renders six maps, a SpotLight one; keep
  shadowed point lights to one or two. At most 10 directional lights. Shadow maps are 4096 by default (each
  directional light with shadows holds four of them, about 256 MB of GPU memory); `<Shadows mapSize={8192} />` costs
  about 2-3 ms a frame more at 1080p and four times the memory, so use it for a still or a hero shot only.
- **Length:** every animated value is stored per frame, and live play works the 3D out for every frame before it
  shows it. A 3D piece of a minute is fine; ten minutes of busy 3D starts slowly.
- **Models:** load before the first frame, at most 60 s; keep a `.glb` under about 20 MB.
- **Fire:** each `<Fire>` marches its pixels through its box (32 samples each by default), so it costs by screen
  area: about 1 ms a frame at 1920x1080 for a fire filling a third of the frame. A handful are fine; for a wall of
  flame use one wide fire, not dozens.
- **Splats:** a million gaussians draw at about 80 ms a frame at 1600x900 (12 fps live; renders are fine), 1.9 GB of
  memory; a trained scene of 100k-500k is the comfortable size. Each frame sorts every splat on the CPU (a few ms).
- **Bloom** adds a float target the size of the frame; use it when something should glow, not by default.
- **Ambient occlusion** costs about 0.3 ms a frame at 1920x1080 at "medium", 0.4 at "high", 1 at "ultra" (with the
  SMAA it brings).
- **Environment:** its light is filtered on the GPU every frame, about 4.5 ms a frame at 1920x1080 from a 1k panorama
  and 6.3 ms from a 2k one (an M5 Pro). Each panorama the piece uses is loaded before the first frame (about 0.1 s for
  a 1k `.hdr`, 0.3 s for a 2k); a 4k or 8k panorama is slow to load and gains little, its light being blurred anyway.
  Checked in renders and baked play; a live game's scene is untested with it.

## Rules that keep a render equal to its play

The router's eight, plus:

- Parts are matched across frames by `name`, else kind and shape in tree order: name what comes and goes.
- The first camera, and the first frame's Bloom, Fog, ToneMapping and Shadows, are the piece's.
- Overlapping FogVolumes are composited in the order of their rows (the engine pins it), so a render of any frame
  equals its play; give each a `name` so its row, and so the order, stays put when others come and go.
- A partly transparent page element over the 3D blends slightly differently in a render than in play; keep page
  parts over 3D opaque where it matters.

## Not there yet (don't reach for these; they won't render)

- A lens over the page: Fisheye and LensDistortion bend the 3D only. (Ambient occlusion, anti-aliasing modes, depth of
  field, a grade with a vignette, the lens and motion blur are in `bevy/post`.)
- `<Canvas3D layered>` in a render forced through page files (`RAEA_3D=files`): there the page is drawn over
  the 3D.
- `<Camera3d projection={{ Orthographic: { scaling_mode: { FixedVertical: { viewport_height } } } }}>`, `layers` on parts, lights and the camera, sprite sheets on ImagePlane (`grid`,
  `frame`) are there, and `pick(pointer, camera, parts, size)` answers which part the pointer is over. A second camera
  or a viewport is an `<Entity>` with Bevy's `Camera3d` and `Camera` (see below), not a second `<Camera3d>`.
- Physics engines in a live game, particle systems: do motion in the game's step. (Fire is there: `<Fire>` in
  `bevy/post`.)
- Bevy's own AnimationEvent (use `clipEvents(events, prev, now, duration)` from `raea/3d`).
- A looked model (`look="pixel"`/`"site"`) is drawn over the scene: parts in front of it don't hide it. At most 30.
- A shader of your own on a standard material or a Model (the looks are the engine's own; a shader you write draws
  its own shape, as `<ShaderMesh>`, below); react-three-fiber's `useFrame`, refs, `<primitive>` and drei helpers: none
  of them exist here.

Since 2026-10-22: `emissive_texture`, `alpha_mode`, `cull_mode`, real glass (`specular_transmission ior thickness`
on StandardMaterial), `receiveShadow={false}`, `<Capsule3d>`, and any of Bevy's own reflected components inside a
Mesh3d, Model, light or camera (`raea/bevy-own`). A bare `<Entity name>` takes any Bevy component, its Handle
fields as an asset path, an inline asset (`{ base_color: ..., unlit: true }`) or a Mesh as `"shape:box(1, 1, 1)"`, and
its Entity fields as another part's name (a `ChildOf` naming its parent). `<BufferMesh positions indices normals uvs>`
builds a mesh from vertices. `useInput()` has `buttons`, `wheel`, `gamepads` and `touches`. A live game reaches the
Bevy World with `raea/world`: `send` a BRP method for a ticket, then read its answer in a component with
`useWorldAnswer(ticket)`, which renders that component again the frame the answer arrives (`world.answer(ticket)` is
the plain read for code outside React; in a component it's only as fresh as whatever else makes it render).
`<Model animations={[{ clip, time, weight }]}>` blends up to 4 clips (a transition is weights moved over frames), and
`<Model morphs={{ smile: 0.8 }}>` sets morph targets. `<Gizmo lines strip color width depthBias>` draws debug lines.
A second camera is `<Entity position>` with `<BevyComponent type="bevy_camera::components::Camera3d" value={{}} />` and
`bevy_camera::camera::Camera` (`viewport: { physical_position, physical_size }`, `order`, `clear_color: "None"`); a
`<BevyComponent type="bevy_camera::camera::Camera">` inside `<Camera3d>` patches its camera. A camera draws
into a texture with `RenderTarget` `{ Image: { handle: "render:NAME:WxH", scale_factor: 1 } }`, and a material shows it
with `base_color_texture: "render:NAME"`.
`<Model graph={{ add: [{ clip: "walk" }, { clip: "wave", mask: ["leg_l", "leg_r"] }] }}>` is an authored animation
graph (blend and additive nodes, masks by bone). `<BufferMesh colors>` takes per-vertex colours; any Mesh handle may be
one of Bevy's primitives (`{ primitive: "Torus", minor_radius: 0.2, major_radius: 1 }`) and any Image handle a picture
made in code (`{ width, height, pixels: ["#ff0000", ...], nearest: true }`). A live game sets its window with
`gameWindow.set({ title, cursor: "locked" })` from `raea/window`, and `world.send("raea/diagnostics")` reads
FPS and entity counts. `<ShaderMesh shape wesl uniforms textures>` draws with a fragment shader written in WESL or plain WGSL (`wgsl`)
(`fn shade(in: VertexOutput) -> vec4<f32>`, uniforms read as `u_NAME()`; `import` Bevy's WESL modules, never `#import`). What of Bevy the SDK
reaches, type by type (typed, reflected, a plugin, or not yet), is `raea guide coverage`, generated from the SDK.
