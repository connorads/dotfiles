# Animation

## What to do

- Animate 3D exactly as you animate 2D: compute props from `useCurrentFrame()` with `interpolate` (clamped),
  `spring`, `Easing` and plain arithmetic. Spin: `Transform.IDENTITY.withRotation(Quat.fromEuler("XYZ", 0, f * 0.04, 0))`; drop-in: a
  `spring` from 0 to 1 mapped to the translation's `y`; reveal: `.withScale(s)` from a spring.
- Time a part with `<Sequence from durationInFrames layout="none">` around it. The part exists only for
  those frames and its own frame count starts at 0 there. A part that appears or disappears should have a `name`.
- Camera moves are props on the camera (`bevy/scene`). Light sweeps are props on the light.
- A glTF model's clip: `<Model src animation="Walk">` plays the clip at the Sequence's time (`frame / fps` seconds),
  looping; `time={...}` sets it yourself (slow motion: `time={f / fps * 0.5}`, a hold: a fixed number),
  `loop={false}` holds the last pose.
- Stagger many parts from their index: `const s = spring({frame: f - i * 4, fps})`.

## Why

The engine draws each frame from that frame's values, keyed per frame. Nothing advances on its own: a model's clip is
posed at the time you give it, not by a clock, so any frame renders alone and play matches the render.

## Common mistakes

- `useFrame((_, dt) => ref.current.rotation.y += dt)`: there's no render loop. `Quat.fromEuler("XYZ", 0, f * speed, 0)`.
- Changing a shape's size or `shape` to animate size: animate the transform's scale.
- A `spring` without `fps`, or an `interpolate` without clamping, overshooting into nonsense values.
- A part shown with `{f > 30 && <Mesh3d ...>}` among others of the same shape, without a `name`: give it one so it
  doesn't take over another part's motion.

## Example: blocks springing in one after another, then a turn

```tsx
import { AbsoluteFill, Composition, interpolate, registerRoot, Sequence, spring, useCurrentFrame, useVideoConfig } from "raea";
import { Sphere, Entity } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Quat, Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#e11d48"];

function Blocks() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const turn = interpolate(f, [45, 89], [0, Math.PI / 2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#f5f1ea" }}>
      <Camera3d transform={Transform.fromXyz(0, 2, 7).lookingAt([0, 0.3, 0])} projection={{ Perspective: { fov: (40 * Math.PI) / 180 } }} />
      <AmbientLight brightness={240} />
      <DirectionalLight transform={Transform.fromXyz(3, 6, 4).lookingAt([0, 0, 0])} illuminance={8800} shadow_maps_enabled />
      <Mesh3d transform={Transform.fromXyz(0, -0.45, 0)}>
        <Cuboid half_size={[5, 0.05, 3]} />
        <StandardMaterial base_color="#d9d2c5" perceptual_roughness={0.9} />
      </Mesh3d>
      <Entity transform={Transform.IDENTITY.withRotation(Quat.fromEuler("XYZ", 0, turn, 0))}>
        {COLORS.map((c, i) => {
          const s = spring({ frame: f - i * 6, fps, config: { damping: 12 } });
          return (
            <Mesh3d key={c} transform={Transform.fromXyz((i - 1.5) * 1.1, interpolate(s, [0, 1], [3, 0]), 0).withScale(Math.max(0.01, s))} name={`block-${i}`}>
              <Cuboid half_size={[0.4, 0.4, 0.4]} />
              <StandardMaterial base_color={c} perceptual_roughness={0.4} />
            </Mesh3d>
          );
        })}
      </Entity>
      <Sequence from={40} layout="none">
        <Mesh3d transform={Transform.fromXyz(0, 1.1, 0)} name="ball">
          <Sphere radius={0.3} />
          <StandardMaterial base_color="#111827" perceptual_roughness={0.2} />
        </Mesh3d>
      </Sequence>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="blocks" component={Blocks} width={1280} height={720} fps={30} durationInFrames={90} />);
```
