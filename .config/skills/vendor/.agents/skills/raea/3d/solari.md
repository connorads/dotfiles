# Ray-traced light: Solari

## What to do

- Put `<SolariLighting />` (`raea/light`) inside the `<Camera3d>` it lights. raea sets up what Bevy asks for around it
  (HDR, no MSAA, the deferred and depth prepasses). It needs a GPU with ray queries: Apple silicon on Metal, an RTX
  card on Vulkan. Elsewhere the scene draws raster-lit and raea says so. On the Mac, MetalFX's denoiser cleans the
  result (`RAEA_SOLARI_DENOISE=0` shows the raw noise).
- Its three props:
  - `bounces`: how many times light bounces. Bevy's default is 3 when it's left out; 2 is enough for most rooms and
    costs less.
  - `restir`: reuse light samples between pixels and frames. It's off by default, as Bevy has it. Turn it on when
    contact shadows look soft or hard light flickers; it costs a real share of the frame.
  - `reset`: start the lighting's history again. Set it on the first frame of a cut made by moving one camera, or
    the old shot's light smears into the new one for a few frames. A cut between cameras (`<Camera3d is_active>`,
    the first active one draws) needs none: the engine resets Solari's and the path tracer's history on the frame
    the shot changes.
- For a still to judge the look against, use `<Pathtracer />` in its place: exact and slow, accumulating while the
  view holds still. It isn't for motion.
- Light the scene with what Solari sees:
  - a `DirectionalLight` (the sun);
  - emissive surfaces: a `StandardMaterial` with `emissive`. A fluorescent tube is a thin glowing box, a bulb a small
    glowing sphere, and a screen its picture as `emissive_texture`;
  - an `<Environment>` panorama, and `<Atmosphere light />`.

  Bevy 0.20's Solari has no point, spot or rect lights, so a `PointLight` lights nothing it traces. For the same
  light, a big dim emitter is cleaner than a small bright one.
- Under Solari a glow is light, exposed by the camera like the rest. Raster lighting draws `emissive` 1-3 as a glow;
  traced, a tube that lights a room is in the thousands (7,000 lights a pool hall) and a screen in the hundreds to
  low thousands.
- Know what it traces: each `Mesh3d` and `Model` part whose material is a plain `StandardMaterial`. These are drawn
  raster-lit after the denoiser instead:
  - an `ExtendedMaterial` (a `ShaderExtension`, a toon or paint extension);
  - a `ToonMaterial`;
  - a skinned or morphed mesh (a `<Character>`).

  The sun's shadow map and the Environment light them, and they reflect only the panorama. The rays pass through
  them, so they cast no traced shadow, stop no light, bounce none, and their glow lights nothing.
- Where light must stop, back an untraced surface with a traced one: a traced floor under shader water, a box behind
  a toon facade. Keep `shadow_maps_enabled` on the sun, so the untraced parts still get shadows and volumetric fog
  still gets its shafts.
- Build closed, thick rooms: walls as boxes, not planes, meeting at the corners. Light leaks through gaps and single
  faces. The bounce cache's cells are 15 cm, so a wall thinner than that next to a bright light leaks too.
- Keep an interior under about 50 m across. A bounce ray that goes 50 m without hitting anything counts as sky, so a
  bigger hall gets sky light in its bounce.
- Put every light in the tree from the first frame, and change brightness with the sky, the glows and the exposure
  rather than the sun's `illuminance`. As of raea 0.1.2:
  - a `DirectionalLight` that appears after the first frame lights nothing directly;
  - the traced sun keeps its first frame's strength (its direction does follow);
  - one `--at` render that jumps more than about 4.5 s between two frames loses the traced sun for every frame
    after.

  So render stills one per process (`--frame N`), and a film a shot a chunk.
- In a surface hook (`fn surface`), write `emissive` with alpha 1.0. Bevy reads that alpha as how much the camera's
  exposure applies, so 1.0 puts the hook's glow in the traced light's units. At 0.0 the glow skips the exposure and
  comes out about 1,000 times brighter at the default.
- Meter before you match. Render a still with no grade pass, read the traced surfaces' linear values (sRGB-decode
  the PNG), and give anything you work out by hand those values: a reflection traced in a shader, a glow meant to
  sit beside the room's light. A pool hall's walls metered 13-17 under its 7,000 tubes.

## Why

Solari is real-time path tracing in three parts. Direct light picks among the emissive triangles and the sun with
ReSTIR, which resamples candidate lights and reuses good ones across neighbouring pixels and frames. Bounce light comes
from a world-space cache that rays keep updating (the world cache), read wherever a path ends. All of it is traced
against acceleration structures built from the meshes. That's why it needs its own mesh layout (raea makes a copy per
mesh, once), why only the `StandardMaterial` fields it knows are traced (base colour, emissive, metallic and roughness,
normal maps, alpha masks, `uv_transform`), and why it's noisy until a denoiser runs. Reflections went in with 0.18
(specular) and 0.19 (a mirror BRDF). Their motion vectors aren't there yet, so a polished floor's reflections smear
when the camera moves.

Bevy changes Solari every release. It arrived in 0.17, gained specular in 0.18 and mirrors in 0.19, and 0.20 turned
ReSTIR off by default, added the atmosphere and environment lighting, and ran on Metal (with no denoiser of its own:
raea adds MetalFX). Read the docs and `examples/3d/solari.rs` for the version raea vendors (0.20, whose shaders are
WESL), not a post written for an older one.

## Common mistakes

- Lamps as `PointLight`s under Solari: the room renders dark. Make them emissive meshes.
- A shader surface expected to stop light. A pool's water drawn as a `ShaderExtension` plane, with no basin floor
  under it, let a sun parked under the ground shine up through the pool and light the ceiling over it white. A
  traced box under the water fixed it.
- Walls of `Plane3d`: light leaks along their edges. Use boxes.
- No `reset` at a cut made by moving the one camera: the new shot's first frames carry the old shot's light.
- A tiny, very bright emitter (a 1 cm LED at 100,000): fireflies. Make it bigger and dimmer, or turn on `restir`.
- Judging reflections from one still. Check a moving shot for smearing.
- A glow pitched for raster (`emissive` 2) in a traced scene: it's black. Pitch it in the traced light's units.
- Following a 0.17 or 0.18 example: the API and the defaults have changed since.

## Example: a hall lit by its tubes and a low sun, with a cut

```tsx
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame } from "raea";
import { Atmosphere, ToneMapping } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { DirectionalLight, SolariLighting } from "raea/light";
import { LinearRgba } from "raea/color";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

type V3 = [number, number, number];
// a closed hall 10 m wide, 4 high and 20 long, its walls 20 cm boxes, a window in the left wall from z -12 to -6
const SLABS: { name: string; min: V3; max: V3 }[] = [
  { name: "floor", min: [-5.2, -0.2, -20.2], max: [5.2, 0, 0.2] },
  { name: "ceiling", min: [-5.2, 4, -20.2], max: [5.2, 4.2, 0.2] },
  { name: "wall-r", min: [5, 0, -20.2], max: [5.2, 4, 0.2] },
  { name: "wall-far", min: [-5.2, 0, -20.2], max: [5.2, 4, -20] },
  { name: "wall-near", min: [-5.2, 0, 0], max: [5.2, 4, 0.2] },
  { name: "wall-l-low", min: [-5.2, 0, -20.2], max: [-5, 1, 0.2] },
  { name: "wall-l-high", min: [-5.2, 3, -20.2], max: [-5, 4, 0.2] },
  { name: "wall-l-back", min: [-5.2, 1, -20.2], max: [-5, 3, -12] },
  { name: "wall-l-front", min: [-5.2, 1, -6], max: [-5, 3, 0.2] },
];
const box = (min: V3, max: V3) => ({
  transform: Transform.fromXyz((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2),
  half: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2] as V3,
});
// the tubes: thin glowing boxes (Solari has no point lights), bright because Solari exposes a glow like any light
const TUBES = [-2.5, 2.5].flatMap((x) => [-3, -9, -15].map((z) => ({ x, z })));

function Hall() {
  const f = useCurrentFrame();
  const cut = f === 45;
  const cam = f < 45 ? Transform.fromXyz(3.5, 1.6, -1).lookingAt([-2, 1.2, -14]) : Transform.fromXyz(-1, 1.2, -18.5).lookingAt([1, 1.6, -2]);
  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <Camera3d transform={cam} projection={{ Perspective: { fov: (55 * Math.PI) / 180 } }}>
        <SolariLighting bounces={2} reset={cut} />
      </Camera3d>
      <ToneMapping exposure={1} />
      <Atmosphere light />
      <DirectionalLight illuminance={60000} shadow_maps_enabled transform={Transform.fromXyz(-20, 9, -6).lookingAt([0, 0, -9])} />
      {SLABS.map(({ name, min, max }) => {
        const b = box(min, max);
        return (
          <Mesh3d key={name} name={name} transform={b.transform}>
            <Cuboid half_size={b.half} />
            <StandardMaterial base_color={name === "floor" ? "#8c8378" : "#d8d2c4"} perceptual_roughness={0.8} />
          </Mesh3d>
        );
      })}
      {TUBES.map(({ x, z }) => (
        <Mesh3d key={`${x},${z}`} name={`tube-${x}-${z}`} castShadow={false} transform={Transform.fromXyz(x, 3.96, z)}>
          <Cuboid half_size={[0.06, 0.02, 1.2]} />
          <StandardMaterial base_color="#ffffff" emissive={new LinearRgba(5000, 5200, 4800, 1)} />
        </Mesh3d>
      ))}
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="hall" component={Hall} width={960} height={540} fps={30} durationInFrames={90} />);
```

Render frames 20 and 60 (`--frame`, one per process) and look: the sun's patch through the window on the floor, its
bounce warming the walls, the tubes lighting the ceiling round them.
