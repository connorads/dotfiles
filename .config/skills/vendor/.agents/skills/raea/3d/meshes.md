# Meshes and solids

## What to do

- A `<Mesh3d transform>` holds one shape and one material (`raea/mesh`). Sizes are scene units (think metres: a
  phone is 0.15, a person 1.8, a room 4). The shapes, Bevy's primitives with Bevy's fields, all centred on the
  Mesh3d's translation:
  - `<Cuboid half_size={[w / 2, h / 2, d / 2]} />` (half sizes, as Bevy's)
  - `<Sphere radius />`
  - `<Cylinder radius half_height />`, standing along y
  - `<Cone radius height />`, point up
  - `<Torus major_radius minor_radius />`, lying in the x-y plane (turn the Mesh3d by `Math.PI / 2` about x to lay
    it flat)
  - `<Capsule3d radius half_length />`, standing along y
  - `<Plane3d normal half_size />`: `normal={[0, 0, 1]}` faces +z (a wall), `[0, 1, 0]` up (a floor, Bevy's default)
  - `Text3D size depth`: solid letters, centred, e.g. `<Text3D size={0.6} depth={0.2}>SALE</Text3D>`
- Place and turn a Mesh3d with its transform: `Transform.fromXyz(x, y, z)`, `.withRotation(Quat.fromEuler("XYZ",
  rx, ry, rz))` (radians), `.withScale([x, y, z])`. All three may change every frame (a pillar growing, a squash on
  landing).
- Model anything else as a Manifold solid and pass it as `<Mesh3d shape={solid}>`: `manifold.box(w, h, d)`,
  `roundedBox(w, h, d, r)`, `sphere(r)`, `cylinder(r, h)` (along z), `cone(r1, r2, h)` (a tapered cylinder too),
  `torus(R, r)` and `text3d(text, size, depth)`, combined with `.union()`, `.minus()`, `.intersect()`, `.hull()`,
  moved with `.move(x, y, z)`, `.rotate(x, y, z)` (**degrees**) and `.scale(...)`. Build a solid once at module
  level, never per frame, and move the Mesh3d instead.
- Give a Mesh3d a `name` when it comes and goes, or swaps places with another of the same shape.

## Many copies: `<Instances>`, `scatter()` and `<Grass>` (`raea/3d`)

- `<Instances src={staticFile("tree.glb")} at={placements} />` draws one glTF at every placement, loaded once and drawn
  by the GPU as instances; without `src`, a geometry child (or `shape={solid}`) and a material child draw a mesh at
  every placement. Each placement is `{ position, rotation?, scale? }` (radians). A list that changes moves the copies
  (each distinct list is kept, so thousands moving every frame cost a list a frame); moving, turning, scaling or hiding
  the whole set with the Instances' own props costs nothing. The count is the first frame's. Copies share one surface and
  play no clip. `shadow={false}` for grass and flowers by the thousand.
- `scatter({ area: { min: [x0, z0], max: [x1, z1] }, count, spacing, avoid, margin, clearOf, seed, yaw, tilt, scale,
  y, density })` makes the placements: seeded (the same every frame, render and play), at least `spacing` apart, off
  the `avoid` boxes, on the ground height `y(x, z)`, kept where `density(x, z)` says. Call it once at module level.
- `<Grass area height density patch size tints>` is a lawn or a meadow the engine grows itself from functions of the
  ground, cut into tiles with detail by distance; under `<Look mode="paint" wind>` the wind bends it.

## Organic shapes and growth: `sdf` and `grow` (`raea/3d`)

- **Blended bodies.** A creature, a limb, a handle grown out of a body, or a melted form is a distance field. Build
  it from `sdf.sphere`, `box`, `capsule(a, b, r)`, `cone(a, b, ra, rb)`, `tube([[x, y, z, r], ...])`, `ellipsoid`,
  `torus` and `cylinder` (y up, metres).
  - Join the parts with `sdf.smoothUnion(k, ...)`. Within `k` metres of each join it blends them into one surface,
    which is what makes the parts read as one thing.
  - Carve with `smoothSubtract(k, a, b)`, for example an eye socket.
  - Modify with `.move`, `.rotate` (degrees), `.scale`, `.mirrorX()` (both sides from one), `.round(r)`,
    `.shell(t)` and `.displace(amp, freq, octaves, seed)` (bark, rock, lumpy skin).
  - `.solid(step)` meshes the field into a Solid. The default cell is a 96th of its size; pass about a third of the
    thinnest part. Cut, union and measure it like any solid.
- **Grown things.** These are seeded, so the same settings give the same shape on every frame:
  - `grow.tree({ height, crown: "dome"|"sphere"|"cone"|"column"|"umbrella"|"vase", points, leaves, seed }, "wood"|"leaves")`
    grows branches into the crown's shape by space colonization, thinned from trunk to twig. Draw the wood and the
    leaves as two meshes with two materials. With `points` 600-2000 a tree is 20k-120k triangles: put a forest in
    `<Instances>`.
  - `grow.loft([[0, "circle 0.2"], [0.3, "circle 0.3"], [0.6, "rect 0.1 0.1"]])` skins outlines at heights into a
    vase, a bottle, a lamp base or a column. An outline is `circle r`, `ellipse rx rz`, `rect w d`, `ngon n r`, or
    `[x, z]` points.
  - `grow.terrain({ size, height, freq, seed, flat })` is ground as a closed slab. `flat` clears a disc in the middle
    to stand things on, and the slab can be cut with `minus` for a path or a pond.
  - `grow.boulder({ size, squash, rough, seed })` is a rock resting on y 0.
  - `grow.rosette({ leaves, length, tilt, rise })` is a succulent, an agave, a lettuce or a flower's petals, set at
    the golden angle and blended from one heart.

## Text in the 3D world, animated glyph by glyph (`RichText`)

`<RichText>` is flat lettering standing in the scene: every glyph its own lit, shaded entity (it takes the lights,
casts a letter-shaped shadow, and things in front hide it). Use it for titles, signs and captions that animate in;
use `Text3D` for solid, extruded letters.

- Props: `size` (the em in metres, 0.5), `font`, `weight`, `italic`, `color`, `align` (left/center/right edge at
  `position`), `lineHeight`, `maxWidth` (wraps), `roughness`, `metalness`, `emissive`, `emissiveIntensity`,
  `unlit`, `castShadow`, `name` (its glyphs are then `name:0`, `name:1`... for world.*).
- Runs: `<RichText>Hello <Span font="Playfair Display" italic color="#ffd400" size={1.2}>world</Span></RichText>`.
- Per glyph, with 2D's moves: `enter="pop"` (or `["pop", "rise"]`, `slide({ from: "left" })`...) `each={3}` frames
  apart from `at`, `by="word"` to stagger words; `exit` + `exitAt` (+ `exitEach`). Move px count 100 to the em.
- A typewriter: `reveal={(frame - 10) / 2}` (glyphs shown; the next fades in over the fraction).
- Free motion: `glyph={(g) => ({ position, rotation, scale, color, opacity, visible })}`, `g` = { index, count, char,
  word, words, inWord, wordLength, line, span }; compute from `useCurrentFrame()`, `spring`, `interpolate` as in 2D.
- The text itself is fixed for the part's life (like a mesh's shape); change it by giving another `name`.

## Manifold in full (`raea/3d`)

Everything below returns a new Solid (or CrossSection) and leaves the old one as it was. Build at module level.

- **Solids from scratch**: `manifold.box`, `roundedBox`, `sphere`, `cylinder` (along z), `cone(r1, r2, h)`, `torus`,
  `text3d`; `manifold.extrude(outline, h, {divisions, twist, scaleTop})` and `manifold.revolve(outline, {degrees,
  segments})` from a 2D shape; `manifold.levelSet(sdf, {min, max, resolution})` from a signed distance function
  (negative inside); `manifold.hull([[x, y, z], ...])` from points; `manifold.fromMesh(verts, tris)` and
  `manifold.import("x.glb")` from triangles.
- **Booleans**: `a.union(b, c)`, `a.minus(b)`, `a.intersect(b)`; for many at once `manifold.union(...list)`,
  `manifold.difference(first, ...cutters)`, `manifold.intersection(...list)`; `manifold.compose(...)` holds solids
  that don't touch as one, `s.decompose()` splits a solid into its separate pieces.
- **Moves**: `.move(x, y, z)`, `.rotate(x, y, z)` (degrees), `.scale(s)` or `.scale(x, y, z)`, `.mirror(nx, ny, nz)`,
  `.transform([12 numbers, column by column])`, `.warp((x, y, z) => [x, y + x * x, z])` (refine first so there are
  vertices to bend: `.refineToLength(0.05).warp(...)`).
- **Cutting**: `.trim(nx, ny, nz, offset)` keeps the normal's side of a plane; `.splitByPlane(...)` gives both halves;
  `.split(cutter)` gives [inside, outside].
- **Surfaces**: `.refine(n)`, `.refineToLength(len)`, `.refineToTolerance(tol)`, `.smooth({angle, refine})` (a box
  becomes a pebble), `.simplify(tol)`; `.hull(...others)` wraps them; `.minkowski(manifold.sphere(0.05))` rounds every
  edge, `.minkowskiDiff(...)` erodes.
- **2D shapes** (`crossSection`): `crossSection.rect(w, h)`, `circle(r)`, `polygon(points)`, `hull(points)`,
  `of(contours)`; then `.union/.minus/.intersect`, `.offset(d, {join: "round" | "miter" | "square" | "bevel"})` (grow
  or, negative, shrink), `.hull()`, `.minkowski()`, `.move(x, y)`, `.rotate(deg)`, `.scale()`, `.mirror()`,
  `.simplify()`, `.decompose()`, and `.extrude(h, ...)` / `.revolve(...)` into a solid. `outline.rect/circle/polygon`
  are the same shapes as plain arrays.
- **From 3D back to 2D**: `s.project()` is its shadow on the x-y plane (seen down the z axis, so project before
  standing a solid up), `s.crossSection(z)` its slice at height z,
  both CrossSections to offset and extrude again (a base plate that follows a model's footprint).
- **Asking**: `.volume()`, `.area()`, `.genus()` (holes through it), `.bounds()`, `.triangles()`, `.isEmpty()`,
  `.slice(z)` ({area, contours, polygons}), `.minGap(other, searchLength)`, `.rayCast(from, to)` (where a line meets
  the surface: put one thing on top of another), `.export("x.glb")`.

Extruded and revolved shapes grow along z: `.rotate(-90, 0, 0)` stands them up along y, the scene's up.

```tsx
// a vase: a profile revolved (along z) and hollowed, a base from its footprint (project looks down z), then the whole
// piece stood up along y
const profile = crossSection.polygon([[0, 0], [0.3, 0], [0.45, 0.3], [0.25, 0.8], [0.3, 1], [0, 1]]);
const outer = profile.revolve({ segments: 64 });
const body = outer.minus(outer.scale(0.88, 0.88, 1).move(0, 0, 0.06));
const base = body.project().offset(0.08).extrude(0.05).move(0, 0, -0.05);
const vase = body.union(base).rotate(-90, 0, 0);
```

## Why

Every geometry reaches the engine as a Manifold expression (`box(1, 2, 3)`), built once per distinct expression and
cached, then drawn by Bevy. A modelled solid and a primitive travel the same way.

## Common mistakes

- Two shapes, or none, in a Mesh3d: give it exactly one, plus one material.
- A shape's size that changes per frame (a cuboid growing by its `half_size`): that's a new shape each frame.
  Animate the transform's scale.
- Degrees in `Quat.fromEuler`, radians in `.rotate()`: it's the other way round.
- `half_size` given full sizes: the cuboid comes out twice as big. Bevy's sizes are halves.
- A Plane3d facing +z as a floor: it stands up like a wall. Give it `normal={[0, 1, 0]}`, or use a thin Cuboid.
- Text3D with quotes or backslashes in it: they throw.
- A 2D outline revolved with points at negative x: revolve takes x >= 0 (the axis is x = 0).
- Building solids inside the component body: every frame rebuilds them. Build once (module level, `??=`).

## Example: a sign with the word cut through it, and solid letters in front

```tsx
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame } from "raea";
import { Cone, Text3D, manifold, type Solid } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Quat, Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

let sign: Solid | null = null;
const getSign = () => (sign ??= manifold.roundedBox(2.6, 1.1, 0.25, 0.1).minus(manifold.text3d("OPEN", 0.6, 0.6)));

function Sign() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#0f1720" }}>
      <Camera3d transform={Transform.fromXyz(0, 0.3, 6).lookingAt([0, 0, 0])} projection={{ Perspective: { fov: (45 * Math.PI) / 180 } }} />
      <AmbientLight brightness={200} />
      <DirectionalLight transform={Transform.fromXyz(2, 3, 4).lookingAt([0, 0, 0])} illuminance={9600} shadow_maps_enabled />
      <Mesh3d transform={Transform.fromXyz(0, 0.6, 0).withRotation(Quat.fromEuler("XYZ", 0, Math.sin(f * 0.05) * 0.4, 0))} shape={getSign()}>
        <StandardMaterial base_color="#e11d48" perceptual_roughness={0.4} />
      </Mesh3d>
      <Mesh3d transform={Transform.fromXyz(0, -0.8, 0.5)}>
        <Text3D size={0.45} depth={0.15}>DAILY</Text3D>
        <StandardMaterial base_color="#facc15" perceptual_roughness={0.3} metallic={0.3} />
      </Mesh3d>
      <Mesh3d transform={Transform.fromXyz(2.2, -0.6, 0)}>
        <Cone radius={0.35} height={0.9} />
        <StandardMaterial base_color="#38bdf8" perceptual_roughness={0.5} />
      </Mesh3d>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="sign" component={Sign} width={1280} height={720} fps={30} durationInFrames={90} />);
```
