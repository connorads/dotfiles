# Assets: models and pictures in space

## What to do

- Files live in the space's media folder and are named with `staticFile("path/in/media.ext")` (from
  `raea`). Never a URL, never an absolute path.
- A glTF model: `<Model src={staticFile("chair.glb")} position rotation scale />`. `.glb` (one file) is best; a
  `.gltf` needs its `.bin` and textures beside it. Models come at their author's scale and origin: render one still
  first, then set `scale` and `position` so it sits on the floor at a sensible size.
- Its animation: `animation="Run"` (the clip's name in the file, or its index `0`) poses it at the Sequence's time;
  `time` and `loop={false}` as in `bevy/animation`. A wrong clip name fails the render and lists the clips the file
  has: read the message and use one of them.
- `scene={1}` picks another scene in a file that has several.
- A model's look: `look="pixel"` draws the model alone as pixel art (a cell per `pixelSize` frame pixels, 6 by
  default, outlined in `edgeColor`, `"none"` for no outline); `look="site"` draws it in raea.io's grain (its light
  ordered-dithered into the site's six greys; `theme="light"` for the light greys, `lift`/`gain` for how much ink).
  `"solid"` is the default. The look may change from frame to frame (`look={f < 60 ? "solid" : "pixel"}`); the rest
  of the scene draws as it is, and the model is still lit and still casts its shadow.
- `flat` draws a model's surfaces without light: its shape and colours alone, like a drawing (with
  `<ToneMapping mode="none" />` so white stays white). The site look keeps the light, since its grain is made of it.
- raea's cat (for raea's own pieces; it's in a raea checkout only, not the release) is
  `content/cat3d/media/cat-white.glb`: white with black eyes, drawn
  `look="site" theme="dark"` on black. That is how the cat is shown; its other looks (and `cat.glb`, the black cat
  for light grounds, shown `flat`) are for when a piece asks for them. Clips: Logo, Idle, Walk, Trot, LookAround,
  Pounce, Blink (Sit exists but isn't good enough to use). Copy it into the space's media folder;
  `content/cat3d/cinematic.tsx` is a worked example.
- A picture in the scene: `<ImagePlane src={staticFile("poster.png")} width={2} position rotation />` (PNG or JPEG):
  an unlit card, its height from the picture's shape unless you give `height`. For a picture on a solid's side, use
  `map` on its material (`bevy/materials`).
- Models are loaded once before the first frame is drawn; there's no loading state to handle.
- Where a model comes from is the scene's routing (`bevy/scenes`): built in code when it's exact or architectural,
  a library or the person's file when one exists, generated with `raea gen mesh` (Tripo) when it has character.
  Generation costs money: quote it first (`raea gen plan`), and every generated mesh goes through `raea gen check`
  (size, facing, pivot, triangles) before a scene uses it.

## Why

The engine loads models with Bevy's glTF loader (materials, textures, skins and clips included) and waits for them,
so the first frame and every frame after show the whole model, in renders and in play alike.

## Common mistakes

- `src="models/chair.glb"` without `staticFile`, or a web URL: use `staticFile`.
- A model 100 times too big or sunk into the floor: set `scale` and `position` from a still.
- Guessing a clip's name: read the render's error, which lists them.
- An ImagePlane facing away from the camera: it faces +z by default; rotate it with `rotation={[0, angle, 0]}`.

## Example: a model playing its clip beside a poster

This one expects `media/model.glb` (with a clip named "Spin") and `media/poster.png` in the space.

```tsx
import { AbsoluteFill, Composition, registerRoot, staticFile } from "raea";
import { ImagePlane, Model } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

function Showcase() {
  return (
    <AbsoluteFill style={{ background: "#e9e4da" }}>
      <Camera3d transform={Transform.fromXyz(0, 1.8, 6).lookingAt([0, 0.7, 0])} projection={{ Perspective: { fov: (40 * Math.PI) / 180 } }} />
      <AmbientLight brightness={200} />
      <DirectionalLight transform={Transform.fromXyz(3, 6, 4).lookingAt([0, 0, 0])} illuminance={9600} shadow_maps_enabled />
      <Mesh3d transform={Transform.fromXyz(0, -0.05, 0)}>
        <Cuboid half_size={[5, 0.05, 5]} />
        <StandardMaterial base_color="#cfc8ba" perceptual_roughness={0.9} />
      </Mesh3d>
      <Model src={staticFile("model.glb")} animation="Spin" position={[-1.2, 0, 0]} />
      <ImagePlane src={staticFile("poster.png")} width={2} position={[1.4, 1, -0.5]} rotation={[0, -0.3, 0]} />
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="showcase" component={Showcase} width={1280} height={720} fps={30} durationInFrames={60} />);
```
