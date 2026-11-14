# Lights

Bevy's lights in Bevy's units, from `raea/light`: a sun in lux, bulbs, spots and panels in lumens, ambient in cd/m².
Each takes a `transform` like any entity; a sun, a spot and a panel shine along their transform's -Z, so turn them
with `.lookingAt(point)`.

## What to do

- Start every scene with a key light and a little fill: one `<DirectionalLight transform illuminance
  shadow_maps_enabled>` (the sun: parallel rays, `Transform.fromXyz(3, 6, 4).lookingAt([0, 0, 0])`) and an
  `<AmbientLight brightness={80-200}>` so the shadow side isn't black.
- Add `<PointLight transform intensity color range>` for a bulb or a warm rim, and `<SpotLight transform intensity
  outer_angle inner_angle>` for a stage spot or a hero pool of light. `outer_angle` is the cone's half-angle in
  radians (0.3-0.6 for a pool); the light starts to fall off at `inner_angle` (half the outer angle softens its edge
  well, 0 the most).
- A softbox, window glow or light panel: `<RectLight transform intensity width height color>` lights from a whole
  rectangle facing its -Z (soft, wide falloff; no shadows). A sky drawn and lit by the sun: `<Atmosphere />` (add
  `light` to light the scene from it too); a low sun gives a sunset.
- Brightness at the default exposure: `illuminance` 8,000-12,000 on a DirectionalLight is bright daylight on a matte
  surface (Bevy's default is 10,000). A PointLight or SpotLight of `intensity` 900,000 lumens lights a surface 3 m
  away about as brightly; it falls off with distance squared, so a bulb 6 m away needs about 3,600,000. `range` is how
  far it reaches at all (20 m by default).
- Under `<Look mode="paint">` (or cartoon) only the suns shade, unless a PointLight or SpotLight has `paint`: then it
  paints a hard band of its colour out to about `6 * sqrt(intensity / 900000)` metres (post.md).
- Shadows: a light casts them with `shadow_maps_enabled` (Bevy's default is none, so write it on the sun). Point and
  spot lights cast them the same way. Every mesh casts and receives. A floor (a wide thin Cuboid) is what makes
  shadows read. A Mesh3d's `shadow={false}` casts none; `shadow="only"` casts its shadow (and blocks the sun's shafts
  in fog) without being drawn: a roof or wall out of frame, a blind's slats. `shadow="catch"` is the reverse: only the
  shadows falling on it are drawn, in its material's colour and opacity, and it's clear elsewhere (a floor under a
  product over a picture or the page; three.js's ShadowMaterial). Clouds, smoke and contrails cast too (post.md).
- Shadow quality: by default the maps are 4096 texels a side and the sun's four cascades cover 150 m from the camera,
  the first ending at 8 m, so shadows are sharp up close and still there down a long street. For a different scale
  put one `<Shadows>` beside the camera: `distance` (metres the sun's shadows reach; shorter is sharper),
  `firstCascade` (about the distance of the nearest subject), `mapSize` (1024-8192), `cascades`, `overlap`, and
  `bias` / `normalBias` if a lit surface shows stripes of its own shadow (acne) or shadows float off what casts them.
  `filter="hardware"` gives crisper, cheaper 2x2 edges instead of the smooth Gaussian ones. Its first frame's values
  hold for the whole piece.

  ```tsx
  <Shadows distance={60} firstCascade={5} mapSize={4096} bias={0.03} normalBias={2} />
  ```
- Light colour is a hex string: warm key `#ffe2c0`, cool fill `#9fc4ff`. Animate `illuminance`, `intensity` and the
  transform from the frame for a light sweep or a flicker (`Math.random()` is seeded per frame, so a flicker from it
  repeats on every render).

- Soft shadows (PCSS): on a DirectionalLight `soft_shadow_size`, the sun's size as its shadows see it (0.5 is a real
  sun; 5-10 for a studio's big softbox key); on a SpotLight or PointLight `soft_shadows_enabled` with
  `shadow_maps_enabled`, and `radius`, the bulb's radius in metres (0.25 by default). The shadow is sharp where it
  touches and softens with distance, like a real one. Bevy dithers the penumbra in a fixed pattern (the same on every
  render, but visible at 1:1); a larger `<Shadows mapSize>` and a smaller size reduce it, and `<Shadows bias={0.2}
  distance={30} />` keeps a big soft sun from speckling the floor it falls on (`sdk/raea/bench/bevy/studio` is a
  high-key product shot lit so).
- Light from a place: `<Environment src={staticFile("sky.hdr")} intensity rotation background />` lights the scene
  from an equirectangular panorama (Poly Haven's CC0 HDRIs, the 1k or 2k `.hdr`; `.exr`, `.png` and `.jpg` work too):
  soft light from every side, and the panorama reflected in every glossy and metal surface, which is what makes metal
  and polished stone look real. `background` draws the panorama as the sky; leave it off indoors behind walls, or when
  the page draws its own backdrop. `intensity` 1 is the panorama as shot at the default exposure; `rotation`
  (radians, counter-clockwise from above) turns the light and sky together, to put the sun behind the subject or on
  its side. Keep a DirectionalLight for crisp shadows: an environment lights but casts none. An AmbientLight adds to
  it.
- A film of many places through one camera: give each scene its own `src` (and intensity, rotation, background);
  the panorama changes on the frame the scene does, the light and reflections with it. Every panorama the piece uses
  is loaded before the first frame, so use a handful, not dozens.

## Why

Lights are rows the engine moves every frame, the same in render and play. Bevy lights physically: a light's power
spreads with distance, so placing and sizing it matters more than in a flat renderer.

## Common mistakes

- No light at all, or only an AmbientLight: the scene renders flat or black.
- `intensity={1}` on a PointLight: lumens, so 1 is darkness. A bright bulb a few metres off is around 1,000,000.
- A sun with no `shadow_maps_enabled`: nothing casts a shadow, and the scene looks pasted on.
- A PointLight inside a mesh: its light never leaves the mesh.
- Many shadow-casting point lights: each renders six shadow maps. Keep shadowed point lights to one or two.
- A sun, spot or panel with no `.lookingAt`: it shines along -Z, which is rarely where the subject is.
- Blurry sun shadows in a small scene: the cascades are spread over 150 m. A `<Shadows distance={20} firstCascade={3} />`
  puts the map's texels where the scene is.
- Speckle on a model's lit stone or brick that doesn't change with shadows on or off is its texture, not its shadow:
  the engine gives glTF textures mipmaps at load, so it shouldn't appear; if it does, the model's textures are float
  or compressed (KTX2/basis with no mips), which it leaves as they are.
- `outer_angle` in degrees on a SpotLight (`outer_angle={30}` throws: it's a half-angle in radians up to π/2).
- A light colour from CSS (`var(--brand-accent)`): hex only.
- An Environment and a bright ambient on top: the panorama already fills the shadows; an AmbientLight of 20-80 at
  most, or none.
- Expecting a sharp sky from a 1k panorama: it covers 360 degrees, so on a 50-degree lens a 1k (or even 2k) sky is
  soft. Use it for light and reflections, blur the background with depth of field, or put a picture plane in front
  for a crisp horizon.
- An outdoor HDRI indoors: the scene is lit by a sky it can't see. Match the panorama to the place (an interior's
  for a hall), and switch it when the film cuts.

## Example: one panorama outside, another inside, cut on frame 30

```tsx
import { AbsoluteFill, Composition, interpolate, registerRoot, staticFile, useCurrentFrame } from "raea";
import { Environment, Sphere, Torus } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { AmbientLight } from "raea/light";
import { Quat, Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

function Shot() {
  const f = useCurrentFrame();
  const outside = f < 30;
  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <Camera3d transform={Transform.fromXyz(0, 1.2, 5).lookingAt([0, 0.6, 0])} projection={{ Perspective: { fov: (50 * Math.PI) / 180 } }} />
      <AmbientLight brightness={20} />
      <Environment
        src={staticFile(outside ? "venice_sunset_1k.hdr" : "museum_of_ethnography_1k.hdr")}
        intensity={interpolate(f, [0, 59], [0.8, 1.2])}
        rotation={interpolate(f, [0, 59], [0, 1.2])}
        background
      />
      <Mesh3d transform={Transform.fromXyz(0, -0.05, 0)}>
        <Cuboid half_size={[4, 0.05, 4]} />
        <StandardMaterial base_color="#8a8580" perceptual_roughness={0.6} />
      </Mesh3d>
      <Mesh3d transform={Transform.fromXyz(-1.4, 0.6, 0)}>
        <Sphere radius={0.6} />
        <StandardMaterial base_color="#ffffff" perceptual_roughness={0.04} metallic={1} />
      </Mesh3d>
      <Mesh3d transform={Transform.fromXyz(1.4, 0.6, 0).withRotation(Quat.fromEuler("XYZ", 0.4, f * 0.03, 0))}>
        <Torus major_radius={0.45} minor_radius={0.16} />
        <StandardMaterial base_color="#e0b050" perceptual_roughness={0.25} metallic={1} />
      </Mesh3d>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="places" component={Shot} width={960} height={540} fps={30} durationInFrames={60} />);
```

The panoramas live in the media folder (`media/venice_sunset_1k.hdr`): download them from polyhaven.com (CC0).

## Example: a soft spot on a product, a warm bulb circling it, a cool sun

```tsx
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame } from "raea";
import { Sphere } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight, PointLight, SpotLight } from "raea/light";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

function Stage() {
  const f = useCurrentFrame();
  const a = f * 0.06;
  return (
    <AbsoluteFill style={{ background: "#0a0b0f" }}>
      <Camera3d transform={Transform.fromXyz(0, 2.5, 6).lookingAt([0, 0.5, 0])} projection={{ Perspective: { fov: (45 * Math.PI) / 180 } }} />
      <AmbientLight brightness={60} />
      <DirectionalLight color="#9fc4ff" transform={Transform.fromXyz(-3, 6, 2).lookingAt([0, 0, 0])} illuminance={2400} shadow_maps_enabled />
      <SpotLight transform={Transform.fromXyz(0, 5, 1).lookingAt([0, 0, 0])} intensity={2700000} outer_angle={0.45} inner_angle={0.225} shadow_maps_enabled />
      <PointLight color="#ffcf8a" transform={Transform.fromXyz(Math.cos(a) * 2, 1.2, Math.sin(a) * 2)} intensity={720000} range={8} />
      <Mesh3d transform={Transform.fromXyz(0, -0.05, 0)}>
        <Cuboid half_size={[5, 0.05, 5]} />
        <StandardMaterial base_color="#8d939b" perceptual_roughness={0.85} />
      </Mesh3d>
      <Mesh3d transform={Transform.fromXyz(0, 0.6, 0)}>
        <Sphere radius={0.6} />
        <StandardMaterial base_color="#d8d2c4" perceptual_roughness={0.3} />
      </Mesh3d>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="stage" component={Stage} width={1280} height={720} fps={30} durationInFrames={90} />);
```
