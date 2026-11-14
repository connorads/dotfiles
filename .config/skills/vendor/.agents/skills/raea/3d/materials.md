# Materials

Bevy's StandardMaterial and raea's extensions of it, from `raea/pbr`. Field names are Bevy's (snake_case), and a
material sits inside the `Mesh3d` it covers.

## What to do

- Each Mesh3d holds one material (toon shading: see "Toon" below):
  - `<StandardMaterial>`: physically based, Bevy's fields: `base_color`, `perceptual_roughness`, `metallic`,
    `emissive`, `base_color_texture`, `normal_map_texture`, `metallic_roughness_texture`, `occlusion_texture`,
    `emissive_texture`, `uv_transform`, `alpha_mode`, `unlit`, `double_sided`, `cull_mode`. `perceptual_roughness` 0
    is a mirror finish, 1 is chalk (0.5 by default); `metallic` 1 is bare metal (its colour tints reflections), 0 is
    plastic, paint, wood.
  - A lacquer or glass layer is StandardMaterial's too: `clearcoat` (0-1: car paint, a phone's glass back),
    `clearcoat_perceptual_roughness`, `reflectance`, `specular_transmission`, `ior`, `thickness`.
  - `unlit`: a flat colour no light changes (a screen, a sign, a backdrop).
- Glow: `emissive` as a hex colour gives off that colour; brighter than white is Bevy's `LinearRgba`:
  `emissive={LinearRgba.from(Srgba.hex("#ff3d7f")).mul(3)}` (`raea/color`). 1-3 glows; with `<Bloom>` (`bevy/post`),
  3-10 blooms like a neon tube. Emissive surfaces don't light their neighbours.
- See-through: `alpha_mode="Blend"` with the alpha in the base colour, `base_color={Srgba.hex("#cfe8ff").with_alpha(0.35)}`,
  for glass or a fade (0.3-0.6 for glass). Keep `perceptual_roughness` low for glass. `alpha_mode={{ Mask: 0.5 }}`
  cuts out where the alpha is under 0.5 (leaves, a fence).
- A picture on a surface: `base_color_texture={staticFile("label.png")}` (PNG or JPEG in the media folder), or
  written inline as a data: URL: an SVG label (`data:image/svg+xml;utf8,<svg ...>`, with `#` written `%23`) or a PNG
  (`data:image/png;base64,...`). On a Cuboid each side gets the whole picture once; for a flat picture on its own use
  `ImagePlane` (`bevy/assets`), whose `src` takes the same.
- Real surfaces (stone, brick, marble, wood, plaster): a PBR texture set, one file per map. Poly Haven's CC0 sets name
  them `_diff` (`base_color_texture`), `_nor_gl` (`normal_map_texture`), `_rough` (`metallic_roughness_texture`: Bevy
  reads roughness from its green, so a greyscale roughness map works as it is while `metallic` stays 0), `_ao`
  (`occlusion_texture`) and `_arm` (ambient occlusion, roughness, metalness packed as Bevy reads them: give it as both
  `metallic_roughness_texture` and `occlusion_texture`, with `metallic={1}`). Bevy multiplies a map by its factor, so
  write `perceptual_roughness={1}` to take the roughness map as it is (Bevy's 0.5 halves it). The normal map is what
  makes bricks and veins catch a raking light; the roughness map makes polished patches shine and worn ones go matt.
  Use the 1k JPGs; 2k only for a surface that fills the frame.
- `uv_transform={Affine2.fromScale([u, v])}` (`raea/math`, glam's Affine2) tiles every map of the material: each face
  of a Cuboid or Plane3d is covered once, times the scale. A 12 m floor with `Affine2.fromScale([6, 6])` shows a 2 m
  texture six times each way; pick the scale so the texture's real size (Poly Haven gives it, usually 1-4 m) matches
  the face's. Faces of different sizes on one Cuboid share one scale, so give a plinth a material whose texture reads
  at both sizes, or build it from separate meshes. `fromScaleAngleTranslation` turns and slides the maps too.
- Animate `base_color` (a hex string per frame), its alpha, `emissive`, `perceptual_roughness` and `metallic` freely:
  each frame's value is drawn. To fade a colour, mix the two hexes yourself from the frame, or declare it with
  `animate`, whose tracks the engine samples (colours blend in Oklab): `animate={{ base_color: track({ 0: "#3060ff",
  30: "#ff4070" }, "in-out-cubic"), metallic: track({ 0: 0, 30: 1 }) }}`. Its keys are those four fields, typed: a
  glow brighter than white is LinearRgba keys of one colour, `emissive: track({ 0: E.mul(0), 30: E.mul(2.5) })` with
  `E = LinearRgba.from(Srgba.hex("#ff4070"))`.

## Toon (cel) shading and ink outlines

- `<ToonMaterial base_color steps shadow_color rim highlight outline>`: flat bands of colour instead of smooth
  shading, the look of a cartoon (Bevy's shape for it is `<ExtendedMaterial base={<StandardMaterial base_color />}
  extension={<ToonExtension ... />} />`, the same material). `steps` is how many bands (2 is classic cel, 3-4 softer);
  the top band is `base_color`, the bottom `shadow_color` (by default a darker, slightly violet-shifted `base_color`,
  never grey), the ones between mixed. The bands follow the scene's own lights and shadows; lights pick the band,
  they don't brighten it, so a bright sun doesn't wash the colour out. More AmbientLight flattens the bands
  (`brightness` 80-160 for a strong terminator).
- For the palette exactly as written, add `<ToneMapping mode="none" />` (`bevy/post`): the default tone mapping mutes
  saturated colours (a `#3aa0ff` lit band shows as `#488fd3`), on toon surfaces as on every other.
- One part toon in a standard scene is this; the whole frame as a cartoon (every part, a boiling line) is `<Look
  mode="cartoon">` (`bevy/post`).
- `outline={{ width: 3 }}` draws an ink line round the silhouette and along creases, `width` in pixels of the
  composition (the same near and far); `color` defaults to a very dark version of the surface colour. 2-4 px at
  1080p reads as a cartoon line.
- `rim={{ intensity: 0.6, width: 0.25 }}` a crisp light band at the edge (white unless `color`); `highlight={{ size:
  0.2 }}` a hard specular spot. `true` takes the defaults.
- An explicit ramp: `bands={[{ at: 0, color: "#3b2a5c" }, { at: 0.35 }, { at: 0.8, color: "#fff4c2" }]}`, darkest
  first; `at` is how much of the light a point faces (0-1) where the band starts.
- A glTF character: put `<ToonMaterial outline={{ width: 3 }} />` inside the `<Model>`: every material of the file
  goes toon with its own colours and textures (rigged and animated models included). Several, each with `material=
  "Skin"` (the glTF material's name from Blender), give parts their own; one without a name covers the rest.
- Animate `base_color`, `shadow_color`, `emissive`, `rim_intensity`, `highlight_intensity` and `outline_width` (an
  outline popping in) from the frame or with `animate`: in an ExtendedMaterial, the base StandardMaterial's `animate`
  takes `base_color` and `emissive`, ToonExtension's the other four. The bands, rim, highlight and outline themselves
  are the first frame's.

```tsx
// cel-shaded: a Manifold banana with two bands, a rim and an ink line, and a rigged glTF robot gone toon (its own
// colours kept), waving
import { AbsoluteFill, Composition, registerRoot, staticFile, useCurrentFrame } from "raea";
import { Model, ToneMapping, manifold } from "raea/3d";
import { ToonMaterial } from "raea/pbr";
import { Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Quat, Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

// a banana: a smoothed sphere stretched long, bent along an arc and pinched at the ends
const BANANA = manifold.sphere(1).smooth({ refine: 4 }).scale(1.1, 0.27, 0.27).refineToLength(0.06).warp((x, y, z) => {
  const t = x / 1.1;
  const pinch = 1 - 0.35 * t * t * t * t;
  return [x, y * pinch + 0.5 * t * t, z * pinch];
});

function Toon() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#fdf3dc" }}>
      <Camera3d transform={Transform.fromXyz(0, 1.6, 7).lookingAt([0, 1, 0])} projection={{ Perspective: { fov: (40 * Math.PI) / 180 } }} />
      <AmbientLight brightness={120} />
      <DirectionalLight transform={Transform.fromXyz(3, 5, 4).lookingAt([0, 0, 0])} illuminance={9600} shadow_maps_enabled />
      <ToneMapping mode="none" />
      <Mesh3d transform={Transform.fromXyz(-1.6, 1, 0).withRotation(Quat.fromEuler("XYZ", 0.2, f * 0.05, 0.3))} shape={BANANA}>
        <ToonMaterial base_color="#ffd23f" steps={2} rim={{ intensity: 0.7, color: "#fff6c8", width: 0.22 }} outline={{ width: 3 }} />
      </Mesh3d>
      <Model src={staticFile("models/robot-expressive/RobotExpressive.glb")} animation="Wave" position={[1.4, 0, 0]} scale={0.45} rotation={[0, -0.5, 0]}>
        <ToonMaterial steps={2} outline={{ width: 2.5 }} />
      </Model>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="toon" component={Toon} width={1280} height={720} fps={30} durationInFrames={60} />);
```

## Decals: pictures pressed onto surfaces

- `<Decal src={staticFile("label.png")} position={...} normal={[0, 0, 1]} size={[w, h]} />` lays a picture onto
  whatever surface it crosses: a label on a box, a coffee ring on a counter, a patch of tiles behind a stove, a sticker
  on a laptop. `normal` is the way the surface faces (out of it). It defaults to `[0, 1, 0]`, a floor or counter. On a
  wall the picture stands upright; `spin` turns it about the normal. On a room's wall, use `{...onSurface(ROOM,
  "right", u, y)}` (`rooms.md`).
- The picture's clear parts show the surface through. `color` tints it and `opacity` fades it; both animate, so a
  stain can darken or a label fade in. `roughness`, `metalness` and `normalMap` give it a finish.
- A decal moves like any part: put it inside a moving Entity, or key its position, and it follows. This works in
  renders and in games.
- A decal lays itself on *everything* its box crosses. Keep it clear of edges you don't want it on: a backsplash
  should stop short of the counter, the hood and the side of the cabinet beside it, or it smears onto them.
  Glossy decals (`roughness` under about 0.4) reflect the sky and look like glass. Use 0.5 or more for tile and paper.

## Wear: chipped paint, grime and rust

- `<ExtendedMaterial base={<StandardMaterial base_color="#d9c69c" perceptual_roughness={0.55} />}
  extension={<WearExtension amount={0.6} />} />` wears the surface: its paint mottled, chipped back to `chip_color`
  (dark metal, shinier) on edges and a few spots, `grime` gathered low and underneath, and `rust` run down in streaks.
  `chips`, `grime` and `rust` are each 0-1 of the amount (0.6, 0.5, 0.25). `scale` is the size of a blotch in metres
  (0.08; larger for a big tank, smaller for a toy). `seed` moves the pattern, so two copies of one part don't wear
  alike.
- The wear is fixed in the part's own space, not the world's. A walking robot's chips stay where they are on each
  limb. Parts built in one shared space (a rigged build's pieces, all made in the rest pose) wear continuously across
  their seams.
- Edges chip because they curve sharply, so a rounded box's edges and a disc's rim wear and broad faces stay mostly
  painted. Give paint a WearExtension; leave lenses, rubber and polished steel without it, or use a small amount.
- Graph paper for a greybox (`GridExtension`) and the paint look's breakup (`PaintExtension`) go in `extension` the
  same way; two extensions nest, an ExtendedMaterial as the base of another.

## Procedural surfaces: wood, stone, brick, tiles and use over them

- `<ExtendedMaterial base={<StandardMaterial />} extension={<ProceduralExtension pattern="brick" dirt={0.3} />} />`
  draws the surface on the GPU in place of a flat colour. The patterns are `noise`, `wood`, `marble`, `stone`
  (concrete too), `brick`, `tiles`, `fabric`, `brushed` (metal) and `plaster`. Each has its own colours, roughness and
  scale by default, so `pattern` alone already looks like the thing.
- Tune it with these fields:
  - `colors` (two colours) and `rough_a`/`rough_b`, one per colour.
  - `scale`, how many metres one feature spans: a wood ring band, a marble vein, a stone mottle.
  - `bump`, the surface's relief (0.5; 0 for flat).
  - `seed`, so that two copies don't match.
  - For brick and tiles: `tile` [width, height] in metres (brick 0.215 x 0.065, tiles 0.3 x 0.3), `gap` (the joint's
    width, 0.01 m) and `gap_color`.
- Use goes on top, each 0-1, and is 0 by default:
  - `dust` settles on what faces up.
  - `dirt` collects in joints, hollows, undersides and along the floor line.
  - `edges` wears corners lighter and smoother.

  Give every surface in a scene the same three at different strengths. That one shared recipe is what makes a room
  read as lived in.
- The pattern overrides the base's colour and roughness; the base's lighting, shadows and transparency stay. Like
  wear, it is fixed in the part's own space, so it moves with the part. Brick, tiles, fabric and brushed metal lie on
  each face's dominant plane, so a box's sides each get a straight course.
- It goes in `extension` alone, with no WearExtension or GridExtension. On raea/3d's MeshStandardMaterial, the same
  thing is the `procedural` prop, with camelCase fields (`roughA`, `gapColor`, ...).
- `raea render --clay` and the clay half of `--review` draw it plain grey, the same as every other surface.

## Re-covering a model's materials

- `<Model src={CHAIR}><StandardMaterial material="Fabric" base_color="#7a3b2e" /></Model>` changes one glTF material
  (by its name). Without `material`, it changes all of them. Inside a Model only the fields you give change; the rest
  of the model's material (its maps, its finish) is kept.
- `<Refinish materials={[{ material: "MI_KitchenWood", color: "#7f9479", map: null, roughness: 0.55 }]}>...</Refinish>`
  does the same for every Model inside it: a run of cabinets with its doors and drawers, a whole set of chairs (its
  list takes the material props by their short names: `color`, `map`, `roughness`; `map: null` takes a picture off,
  wood painted over). A model's own material children go first.
- Read a glb's material names from its JSON chunk (`materials[].name`) or from the pack's docs.

## Why

Materials become Bevy's StandardMaterial on each mesh (a toon one extends it with its own lighting, and its outline is
the mesh drawn a second time, inside out and pushed out a few pixels). Its values are columns keyed per frame, so a
colour sweep or a glow pulse plays exactly as it renders.

## Common mistakes

- `metallic` or `perceptual_roughness` outside 0-1, or an alpha above 1: they throw.
- `roughness`, `metalness`, `color`, `map` on a StandardMaterial: those are the old material's names; Bevy's are
  `perceptual_roughness`, `metallic`, `base_color`, `base_color_texture`.
- A roughness map with no `perceptual_roughness={1}`: Bevy's default 0.5 halves it, and the surface looks wet.
- Faking toon shading by splitting a mesh along the light or by placing black copies behind parts: use
  `ToonMaterial` with `outline` instead.
- A toon `outline` on a see-through part: the line fades with it, but the part shows its own hull through itself.
  Turn the outline off (`outline_width` 0) while it's faded.
- A colour as a CSS variable or a Tailwind class: hex only (names like "white" and `rgb()` are converted).
- Expecting an emissive object to light the room: add a PointLight at it for that.
- Everything at `metallic={1}` with no `<Environment>`: metal shows only what it reflects, and without a panorama
  (`bevy/lights`) that's the lights' small highlights, so fully metallic surfaces look dark. Add an Environment for
  real metal, or keep `metallic` at 0.2-0.6 with low roughness.
- A texture on a Sphere or a Torus: the picture is projected box-wise and smears on curves. Use maps on cuboids,
  planes and Manifold solids with flat faces.
- A `_nor_dx` normal map (DirectX layout, green down): bumps light from the wrong side. Use `_nor_gl`.
- A tiled floor with no `uv_transform`: one 1k texture stretched over 12 m reads as a blurry giant tile. Tile it.
- Forgetting the texture's real size: bricks twice the height of a door. Count the texture's courses or tiles and set
  the scale from the face's size.

## Example: a marble floor, a brick wall and a plinth

```tsx
// media/: Poly Haven CC0 1k JPGs (marble_01_*, castle_brick_07_*)
const marble = {
  base_color_texture: staticFile("marble_01_diff_1k.jpg"),
  normal_map_texture: staticFile("marble_01_nor_gl_1k.jpg"),
  metallic_roughness_texture: staticFile("marble_01_rough_1k.jpg"),
  occlusion_texture: staticFile("marble_01_ao_1k.jpg"),
  perceptual_roughness: 1,
};
const brick = {
  base_color_texture: staticFile("castle_brick_07_diff_1k.jpg"),
  normal_map_texture: staticFile("castle_brick_07_nor_gl_1k.jpg"),
  metallic_roughness_texture: staticFile("castle_brick_07_arm_1k.jpg"),
  occlusion_texture: staticFile("castle_brick_07_arm_1k.jpg"),
  perceptual_roughness: 1,
  metallic: 1,
};

<>
  <Camera3d transform={Transform.fromXyz(0, 1.7, 5.5).lookingAt([0, 0.9, -1])} projection={{ Perspective: { fov: (50 * Math.PI) / 180 } }} />
  <AmbientLight brightness={60} />
  <SpotLight transform={Transform.fromXyz(sweep, 2.6, 0.6).lookingAt([0, 1.2, -3])} intensity={2700000} outer_angle={0.7} inner_angle={0.35} shadow_maps_enabled />
  <Mesh3d transform={Transform.IDENTITY.withRotation(Quat.fromEuler("XYZ", -Math.PI / 2, 0, 0))}>
    <Plane3d normal={[0, 0, 1]} half_size={[6, 6]} />
    <StandardMaterial {...marble} uv_transform={Affine2.fromScale([6, 6])} />
  </Mesh3d>
  <Mesh3d transform={Transform.fromXyz(0, 2, -3)}>
    <Cuboid half_size={[6, 2, 0.2]} />
    <StandardMaterial {...brick} uv_transform={Affine2.fromScale([6, 2])} />
  </Mesh3d>
  <Mesh3d transform={Transform.fromXyz(0, 0.6, -0.5)}>
    <Cuboid half_size={[0.45, 0.6, 0.45]} />
    <StandardMaterial {...marble} base_color="#f0ece4" perceptual_roughness={0.5} clearcoat={0.3} />
  </Mesh3d>
</>
```

`base_color` tints the base map (white keeps it); the plinth's `perceptual_roughness={0.5}` halves its roughness map,
a polished stone. The whole fixture is `sdk/raea/bench/bevy/texmaps/edit.tsx` in raea.

## Example: four finishes side by side

```tsx
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame } from "raea";
import { Bloom, Sphere, Torus } from "raea/3d";
import { LinearRgba, Srgba } from "raea/color";
import { StandardMaterial } from "raea/pbr";
import { Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

function Finishes() {
  const f = useCurrentFrame();
  const pulse = 3 + 2 * Math.sin(f * 0.2);
  return (
    <AbsoluteFill style={{ background: "#111318" }}>
      <Camera3d transform={Transform.fromXyz(0, 0.8, 6).lookingAt([0, 0, 0])} projection={{ Perspective: { fov: (40 * Math.PI) / 180 } }} />
      <AmbientLight brightness={120} />
      <DirectionalLight transform={Transform.fromXyz(2, 4, 5).lookingAt([0, 0, 0])} illuminance={10400} shadow_maps_enabled />
      <Bloom intensity={1.2} threshold={0.9} />
      <Mesh3d transform={Transform.fromXyz(-2.4, 0, 0)}>
        <Sphere radius={0.55} />
        <StandardMaterial base_color="#8a0f1e" perceptual_roughness={0.45} metallic={0.5} clearcoat={1} clearcoat_perceptual_roughness={0.05} />
      </Mesh3d>
      <Mesh3d transform={Transform.fromXyz(-0.8, 0, 0)}>
        <Sphere radius={0.55} />
        <StandardMaterial base_color={Srgba.hex("#cfe8ff").with_alpha(0.35)} perceptual_roughness={0.05} alpha_mode="Blend" />
      </Mesh3d>
      <Mesh3d transform={Transform.fromXyz(0.8, 0, 0)}>
        <Torus major_radius={0.45} minor_radius={0.12} />
        <StandardMaterial base_color="#202020" emissive={LinearRgba.from(Srgba.hex("#ff3d7f")).mul(pulse)} />
      </Mesh3d>
      <Mesh3d transform={Transform.fromXyz(2.4, 0, 0)}>
        <Sphere radius={0.55} />
        <StandardMaterial base_color="#f2c14e" unlit />
      </Mesh3d>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="finishes" component={Finishes} width={1280} height={720} fps={30} durationInFrames={60} />);
```
