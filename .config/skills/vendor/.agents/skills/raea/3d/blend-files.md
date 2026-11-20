# Blend files: open .blend material and how to take from it

Licences here were read at the source on 2026-11-10, except the rows under "Not checked". The licence rule and the
sidecar are `bevy/sources`'; Blender's place in the work is `bevy/blender`'s: an asset passes through it on its way
into `media/`, and the scene stays TSX.

## What to do — HEADLESS

- **Read the file's own licence line.** blender.org lists a licence beside each demo file, and they differ: CC0,
  CC BY, CC BY-SA. Only CC0 and CC BY files come in. Write the sidecar beside the `.blend` before any script runs:
  `cube_diorama.blend.json` holding `{"source": URL, "license": "CC0", "credit": "Blender Studio"}`.
- **Download from `https://download.blender.org/demo/...`.** The links on blender.org's demo page
  (`https://www.blender.org/download/demo/...`) answer with a page that picks a mirror; the same path under
  `download.blender.org` is the file.
- **List it first:** `raea blender run blender/contents.py src/FILE.blend` prints each mesh object with its
  triangles, modifiers and collections, each collection, each geometry-node group, and each material with whether it
  has image textures.
- **Take one thing:** `raea blender run blender/take.py src/FILE.blend media/OUT.glb NAME [NAME ...]`, each NAME an
  object or a collection. The whole file as one model is `convert.py src/FILE.blend media/OUT.glb`, right for a file
  that is one object.
- **Check and fit it:** `raea gen check media/OUT.glb --h HEIGHT -o media/OUT-fit.glb`. A library lays its assets out
  in a row, so the origin is rarely under the object; `-o` puts it at the bottom centre.
- **What comes across**, as run for this guide:
  - Meshes with their modifiers applied. A teapot of 1,562 triangles with a subdivision modifier arrived as 25,376.
    Decimate to what its distance needs (`decimate.py`, `raea gen check --seen M`).
  - Materials built on image textures, with their maps.
  - A material built from nodes alone (noise, ramps, mixes) arrives as its plain factors, without even a colour. Bake
    it (`bake.py`), or set the look in the TSX with a material inside the `<Model>` (`bevy/materials`, "Re-covering a
    model's materials").
  - A geometry-node scatter arrives as every copy it makes: one pebble-strewn ground came to 10.6 million triangles
    in 40,759 pieces. Take the source meshes (the pebbles' collection: 7 meshes, 3,152 triangles) and scatter them in
    the scene with `<Instances>` and `scatter()` (`bevy/meshes`).
  - Lights, cameras, the world and the compositor stay behind. Those are the TSX's.
- **A node tree is worth reading even when it can't come across.** A geometry-node or shader setup shows how an
  effect is built. Open the file with the live MCP to look (`bevy/blender`, "Live"), then build the effect in raea:
  a scatter as `<Instances>`, a growth as `grow.*`, a surface as a material.

## Where open .blend files are

| source | licence | what it has | fetch |
|---|---|---|---|
| blender.org demo files (`blender.org/download/demo-files`) | per file: CC0, CC BY or CC BY-SA, printed beside each | asset bundles, geometry-node demos, splash scenes, benchmark scenes | `https://download.blender.org/demo/PATH` |
| the CC0 ones there | CC0 | Human Base Meshes bundle (49 MB), Cube Diorama asset bundle (11 MB, 28 furnishings marked as assets), Classroom (72 MB), Fishy Cat (32 MB), and the geometry-node demos by Blender Studio: pebble and flower scattering, tree and moss, fracturing, fur | the same |
| Blender Studio (`studio.blender.org`): the open films' production files | CC BY 4.0 "unless notified otherwise" (its terms and conditions) | whole film sets, characters and rigs | the film's page; credit Blender Studio and the film |
| extensions.blender.org, asset libraries | CC0, required by the platform | asset libraries published as extensions | the extension's page |
| extensions.blender.org, add-ons | GPL-3.0-or-later, required by the platform | tools that run inside Blender | install into Blender; see below |
| Poly Haven and ambientCG | CC0 | each model also as a `.blend` | `bevy/sources` |
| BlenderKit | CC0 or its own "Royalty Free" | models, materials, node groups | its add-on; take only CC0 into a project (`bevy/sources`) |

**Add-ons are GPL, and that is fine for a tool.** Blender and its add-ons run as their own program, which raea
starts and never bundles (`bevy/blender`, "Setting it up"). Blender's licence page says what you make with it is
yours: "What you create with Blender is your sole property." So a mesh an add-on helped make carries the licence of
its sources, not the add-on's. An add-on's code is never copied into a raea project or the skill.

**Not CC BY-SA.** Several splash scenes on the demo page are share-alike. A film that used one would have to carry
that licence itself. Leave them.

## The live MCP — BLENDER

The `blender` MCP server (`bevy/blender`, "Live") can search and import from Poly Haven, Sketchfab and Poly Pizza
into the running Blender. Use that to look and to choose. What a scene uses is fetched again by a saved script with
its sidecar (`bevy/sources`), so the asset can be rebuilt from its source.

## Not checked

- Whether a Blender Studio film's production files download without a paid membership.
- A rigged character taken from a `.blend` with its actions: `take.py` was run on meshes only.
- Hair, simulation caches, and anything driven by a driver or a constraint.
- The licence of the Essentials assets that ship inside Blender.

## Why

A `.blend` is a working file: modifiers not yet applied, node materials Blender alone can draw, a view layer that
leaves its library collections out, and lights and cameras for its own render. raea loads glTF, so what comes in is
what glTF can hold: meshes, UVs, image-textured PBR materials, skins and clips. `take.py` exports the named things
from a scene of their own, with the rest of the file still loaded, so what their modifiers read from still works.

## Common mistakes

- Converting a whole library file: `convert.py` stops on the first object the view layer leaves out, and a file of
  thirty assets isn't one model anyway. Name what you want with `take.py`.
- Taking the scattered ground instead of the things scattered on it.
- Expecting a node material's look to arrive. Run `contents.py`: a material it marks "nodes only" needs baking or
  a material in the TSX.
- Placing a taken asset without `-o`: it sits where the library file had it, most of a metre from its own origin.
- A sidecar that names the demo page but the wrong licence. The licence is the one printed beside that file.
- Rebuilding the file's lighting in raea from its lights: light the scene in the TSX (`bevy/lights`).

## Example: a teapot out of Blender Studio's Cube Diorama bundle (CC0)

Run end to end for this guide on 2026-11-10: `take.py` wrote 25,376 triangles, `raea gen check` warned that its
origin was 0.86 m from its bottom centre, and the fitted copy passed with 0 errors and 0 warnings. Its porcelain is
a node material, so it arrives without one and the scene gives it its glaze.

```sh
mkdir -p src/cube-diorama && cd src/cube-diorama
curl -fsSL -A my-project-name -O https://download.blender.org/demo/bundles/bundles-3.0/asset-demo-bundle-3.0-cube-diorama.zip
unzip -q asset-demo-bundle-3.0-cube-diorama.zip && cd ../..
echo '{"source": "https://www.blender.org/download/demo-files/", "license": "CC0", "credit": "Blender Studio: Cube Diorama"}' \
  > src/cube-diorama/cube_diorama/cube_diorama.blend.json
raea blender run blender/contents.py src/cube-diorama/cube_diorama/cube_diorama.blend
raea blender run blender/take.py src/cube-diorama/cube_diorama/cube_diorama.blend media/teapot.glb "Tea Pot"
raea gen check media/teapot.glb --h 0.17 -o media/teapot-fit.glb
```

```tsx
import { AbsoluteFill, Composition, registerRoot, staticFile } from "raea";
import { Model } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

function Teapot() {
  return (
    <AbsoluteFill style={{ background: "#e9e4da" }}>
      <Camera3d transform={Transform.fromXyz(0, 0.32, 0.85).lookingAt([0, 0.08, 0])} projection={{ Perspective: { fov: (40 * Math.PI) / 180 } }} />
      <AmbientLight brightness={300} />
      <DirectionalLight transform={Transform.fromXyz(3, 6, 4).lookingAt([0, 0, 0])} illuminance={9600} shadow_maps_enabled />
      <Mesh3d transform={Transform.fromXyz(0, -0.05, 0)}>
        <Cuboid half_size={[5, 0.05, 5]} />
        <StandardMaterial base_color="#cfc8ba" perceptual_roughness={0.9} />
      </Mesh3d>
      <Model src={staticFile("teapot-fit.glb")}>
        <StandardMaterial material="Porcelain - White" base_color="#f4f1ea" perceptual_roughness={0.25} />
      </Model>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="teapot" component={Teapot} width={1280} height={720} fps={30} durationInFrames={30} />);
```
