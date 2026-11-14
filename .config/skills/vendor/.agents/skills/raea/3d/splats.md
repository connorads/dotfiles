# Gaussian splats: real scenes and objects from footage

## What to do

- Make a splat from footage: `raea splat train CLIP.mp4 -o media/scene.ply` (or a folder of photos). It
  takes frames, solves the cameras (COLMAP) and trains the splat on this Mac (Brush, on Metal), and writes
  `scene.ply.json` beside it: the splat placed in raea's world (+Y up, centred, metres) and the cameras that shot it.
  The same input is trained once (cached by its content). Good footage orbits the subject slowly, sharp, with
  parallax; a turntable object on a plain background trains alone with `--matte black`.
- Draw it: `<Splat src={staticFile("scene.ply")} position rotation scale />` beside the camera. `.ply` (3D
  gaussian splatting, spherical harmonics up to degree 3), `.splat` and `.spz` all work. A file from elsewhere has no
  sidecar and may be upside down or far from the origin: render a still, then `rotation={[Math.PI, 0, 0]}` and
  `position`/`scale` to place it.
- Fly the camera the footage flew: import the sidecar (`import side from "./media/scene.ply.json"`) and put the
  `Camera3d` at `Transform.fromTranslation(side.cameras[i].position).lookingAt(side.cameras[i].lookAt)` with its `.fov`
  (degrees there: times `Math.PI / 180`), i moved by the frame
  (interpolate between neighbours for a smooth move). The splat is sharpest from where it was shot; far off that path
  it smears.
- Meshes and models stand in it: a `<Mesh3d>` or `<Model>` in front hides the splat behind it, and a splat in front of a
  mesh shows over it. The frame's `<Look>` (pixel, ink, paint, cartoon) applies to splats too; under paint and cartoon
  their light falls into flat bands (`bands` to set your own).
- Animate it with props, every one a value of the frame (keyed per frame):
  - `reveal` 0..1: splats scale in as a front passes, out from `revealFrom` (a point; the centre by default) or along
    `revealAxis` (a plane sweeping through, `[0, 1, 0]` from the ground up); `revealSoft` (0.15) is the front's width,
    `revealGlow` (0..1) lights it in `glowColor`.
  - `assemble` 0..1: from a cloud of dust round the scene into its shape (1 is whole). `disperse` 0..1: blown away on
    a curl-noise `wind` ([1, 0.15, 0] by default; `curl` 1), the upwind side first, shrinking to specks. One or the
    other, not both.
  - `explode` 0..1: thrown out from the centre, falling and fading.
  - `wave={{ amplitude, wavelength, phase }}`: a ripple running out from the centre (animate `phase`).
  - `twist`: radians a metre about the vertical through the centre.
  - `morph={{ to: staticFile("other.ply"), amount }}`: each splat flies to its match in the other file and takes its
    size, turn and colour. The other is fitted to this one (same centre, same size), so any two splats morph in place.
  - `pulse` (a value you pass, e.g. a beat's envelope) with `pulseScale` (0.15) and `pulseGlow` (0).
  - Grade: `brightness`, `saturation`, `contrast`, `tint`, `opacity`; `splatScale` (below 1 breaks it into points);
    `crop` (metres from the centre past which nothing draws: trims a trained scene's floaters).
  - `paint` 0..1: the splats themselves painted, flat bands of light (`bands`, 4), each splat grown into a
    hard-edged dab. Use it for a painted shot in a timeline whose frame `<Look>` isn't paint.
  - `seed` picks the randomness of the scatter and jitter.
- Beats from the song map, never a BPM constant: `const s = songAt(map, frame / fps)` (sdk/raea/src/song.tsx) and
  `pulse={Math.pow(1 - s.phase, 3)}`.

## Example

```tsx
import { AbsoluteFill, Composition, interpolate, registerRoot, staticFile, useCurrentFrame } from "raea";
import { Splat } from "raea/3d";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

function Shot() {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 119], [-0.5, 0.5]);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Camera3d transform={Transform.fromXyz(Math.sin(a) * 4, 1.6, Math.cos(a) * 4).lookingAt([0, 0.5, 0])} projection={{ Perspective: { fov: (40 * Math.PI) / 180 } }} />
      <Splat
        name="scene"
        src={staticFile("scene.ply")}
        assemble={interpolate(f, [0, 45], [0, 1], { extrapolateRight: "clamp" })}
        twist={interpolate(f, [0, 45], [1.2, 0], { extrapolateRight: "clamp" })}
        seed={2}
      />
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="splat" component={Shot} width={1920} height={1080} fps={30} durationInFrames={120} />);
```

## Why

Each frame the engine sorts the splats far to near for that frame's camera, from where that frame's effects put them
(a stable sort, ties by index), then draws each as the ellipse its 3D gaussian projects to. Nothing carries over from
the frame before, so a frame rendered alone equals the same frame in play, and nothing pops as the camera moves.

## Common mistakes

- A splat upside down or tiny: it has no sidecar (not trained here). Rotate and scale it from a still.
- The camera far from where the footage was shot: the back of a half-orbit was never seen, so it's empty or smeared.
- `Math.random()` for a scatter: use `seed`.
- A `<Bloom>` makes the camera HDR and tone-maps the splats too, shifting their trained colours; leave splat scenes
  without bloom unless you want that.
- A wrong path: `src` takes `staticFile`, as a Model's does.
