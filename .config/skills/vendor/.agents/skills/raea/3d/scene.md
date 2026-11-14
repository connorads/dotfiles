# Scene and camera

The 3D names are Bevy's: a part is an entity with a `transform`, a camera is a `Camera3d`, a mesh a `Mesh3d` with its
shape and material inside it. Import them from the module Bevy keeps them in: `raea/camera`, `raea/transform`,
`raea/mesh` (with the shapes), `raea/pbr`, `raea/light` (or everything from `raea/prelude`). `Entity` (and
`Canvas3D`, for `layered`) come from `raea/3d`.

## What to do

- Write the camera, lights and meshes straight in the page, inside an `AbsoluteFill` like any element; no wrapper is
  needed. The element holding the camera is cleared to show the 3D, and its `background` (a hex colour) becomes the
  3D's clear colour. A gradient background doesn't reach the 3D (it clears to black); use a flat colour, or a large
  backdrop mesh.
- A camera in an element smaller than the frame draws its view in that element's box, over the element's background
  (an inset monitor, a picture in picture); the page around the box is the page alone.
- Give it one `<Camera3d transform projection>`. Place it with a `Transform`: `Transform.fromXyz(x, y, z)` puts it
  there, `.lookingAt([x, y, z])` turns it to face that point (without one it faces -Z). The projection is
  `{{ Perspective: { fov } }}`, the vertical field of view in radians: `(40 * Math.PI) / 180` reads as a product lens,
  60 degrees or more as wide. The y axis is up, and +z points at the viewer.
- Move the camera by computing its transform from the frame: a dolly is `z` easing from 8 to 5, an orbit is
  `Transform.fromXyz(r * Math.sin(a), h, r * Math.cos(a)).lookingAt([0, 0, 0])`. Both are drawn exactly per frame in
  render and play.
- Use `<Entity transform>` for things that move together (a product on a turntable, a car and its wheels): its
  children are placed in it, as Bevy's child entities are. Entities nest; their transforms compose. Turn one with
  `Transform.IDENTITY.withRotation(Quat.fromEuler("XYZ", x, y, z))` (radians).
- 2D under the 3D: put the 3D in a `<Canvas3D layered>`. The 3D then takes its place in the page's tree order:
  - Page elements before the Canvas3D, and the background of the box holding it, are under the 3D. They show
    wherever it has nothing and are hidden by its parts.
  - Positioned elements after it are over it.
  - The 3D's background is transparent, so a gradient or a picture behind the 3D works.
  - Put the layered Canvas3D straight in a full-frame `AbsoluteFill`. Give the elements after it a position
    (`AbsoluteFill`, `position: absolute`): as in CSS, positioned elements paint over unpositioned ones.
- Put 2D over the 3D as ordinary page elements after the 3D. Keep page parts over the 3D opaque: a partly
  transparent part over 3D blends a little differently in a render than in play (a known engine difference), so fade
  text in over a flat panel rather than over the 3D, or accept a slight mismatch while it fades.

```tsx
// 2D behind and in front of the 3D: a disc and a word under the sphere, a bar over it
<AbsoluteFill style={{ background: "#e8eef6" }}>
  <div style={{ position: "absolute", left: 300, top: 90, width: 360, height: 360, borderRadius: 180, background: "#ff8a1f" }} />
  <Canvas3D layered>
    <Camera3d transform={Transform.fromXyz(0, 0, 6)} projection={{ Perspective: { fov: (40 * Math.PI) / 180 } }} />
    <DirectionalLight transform={Transform.fromXyz(3, 4, 5).lookingAt([0, 0, 0])} illuminance={8000} shadow_maps_enabled />
    <Mesh3d><Sphere radius={1.1} /><StandardMaterial base_color="#3a6cff" /></Mesh3d>
  </Canvas3D>
  <div style={{ position: "absolute", left: 0, top: 250, width: 960, height: 40, background: "#22b573" }} />
</AbsoluteFill>
```

## Why

The camera and the entities are rows the engine reads each frame, keyed per frame, so a camera move is as exact as a
title's slide. Entities are composed into world space before the engine sees them.

## Common mistakes

- `Quat.fromEuler("XYZ", 0, 90, 0)`: radians. Use `Math.PI / 2`.
- `fov: 40`: radians too, so 40 is a fisheye past anything a lens does. Write `(40 * Math.PI) / 180`.
- The camera at the subject's position, or looking away from it: nothing shows. Start at
  `Transform.fromXyz(0, 1, 6).lookingAt([0, 0, 0])` and adjust.
- `.lookingAt` a point straight above or below the camera: there's no up to turn by. Look a little off vertical.
- Two cameras to cut between angles. Use one camera whose transform jumps at the cut frame.
- `useFrame` or refs from react-three-fiber. There's no render loop: write the frame's values as props.
- 2D meant to pass behind a 3D part, without a `<Canvas3D layered>`: otherwise the whole page is over the 3D.
- An unpositioned element after a layered Canvas3D: it paints under the 3D (CSS paints positioned boxes last). Make
  it `position: absolute`.
- Bloom with `layered`: its glow lightens the page under the 3D around bright parts (it adds light there).

## Example: a product on a turntable with a slow push-in and a title over it

```tsx
import { AbsoluteFill, Composition, Easing, interpolate, registerRoot, useCurrentFrame, useVideoConfig } from "raea";
import { Cylinder, Entity } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Quat, Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

function Turntable() {
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const turn = (f / fps) * (Math.PI / 3); // a sixth of a turn a second
  const z = interpolate(f, [0, durationInFrames - 1], [7, 5], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#14161c" }}>
      <Camera3d transform={Transform.fromXyz(0, 1.6, z).lookingAt([0, 0.5, 0])} projection={{ Perspective: { fov: (40 * Math.PI) / 180 } }} />
      <AmbientLight brightness={160} />
      <DirectionalLight transform={Transform.fromXyz(3, 5, 4).lookingAt([0, 0, 0])} illuminance={11200} shadow_maps_enabled />
      <Entity transform={Transform.IDENTITY.withRotation(Quat.fromEuler("XYZ", 0, turn, 0))}>
        <Mesh3d transform={Transform.fromXyz(0, -0.1, 0)}>
          <Cylinder radius={1.4} half_height={0.1} />
          <StandardMaterial base_color="#2b2f3a" perceptual_roughness={0.6} />
        </Mesh3d>
        <Mesh3d transform={Transform.fromXyz(0, 0.6, 0)}>
          <Cuboid half_size={[0.45, 0.6, 0.45]} />
          <StandardMaterial base_color="#e8b04a" perceptual_roughness={0.35} metallic={0.2} />
        </Mesh3d>
      </Entity>
      <div style={{ position: "absolute", top: 80, width: "100%", textAlign: "center", fontFamily: "Inter", fontWeight: 800, fontSize: 72, color: "#ffffff" }}>
        Made to be seen
      </div>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="turntable" component={Turntable} width={1080} height={1080} fps={30} durationInFrames={90} />);
```
