# Godot projects: open demos and kits, and what of them comes into raea

Licences here were read at the source on 2026-11-10. The licence rule and the sidecar are `bevy/sources`'; running
Godot from raea (`raea setup godot`, `raea godot run`) is `bevy/godot`'s.

## What to do — HEADLESS

- **Read two licences.** A Godot repository's LICENSE covers its code. Its models, textures and sounds often carry
  another, said in the README or a licence file's second half. The sidecar takes the art's licence and its credit.
- **Fetch the project into `src/`**, never into `media/`. One demo out of a large repository is a sparse checkout
  (the example below).
- **Then take what you need by the route its kind has:**

  | in the project | route | arrives as |
  |---|---|---|
  | a model file that doesn't move (`.glb`, `.gltf`, `.fbx`, `.obj`, `.blend`) | `raea blender run blender/convert.py KIT/models/X.glb media/X.glb`, run on the file where it sits | one `.glb` with its textures inside |
  | a model file with clips | the scene that holds it (`res://objects/character.tscn`), by the next row | one `.glb` with its textures inside and its clips as Godot plays them |
  | a scene (`.tscn`, `.scn`), with whatever it holds: imported models, Godot's own mesh resources (`.res`, `.tres`, `.mesh`), a GridMap, CSG shapes | `raea godot run godot/scene-glb.ts --project KIT res://PATH.tscn media/X.glb` (the script is below) | one `.glb`: the node tree, meshes, StandardMaterial3D colours and textures, AnimationPlayer clips |
  | one mesh resource | the same script, given `res://PATH.res` | one `.glb` |
  | a shader (`.gdshader`), particles, a sky, post effects, anything a script builds when the game runs | no asset route. Record it as footage (`raea godot run ... --movie`, `bevy/godot`), or build the effect in raea | frames a composition shows |

- **Write the sidecar and check:** `raea gen check media/X.glb`. A whole level arrives with its origin wherever
  Godot's was and a warning for it; a level is placed once, so that is usually right as it is.
- Prefer one object's scene (`objects/platform.tscn`) over the whole level. raea's scene is still the TSX: a level
  taken whole is for a Godot project the person wants shown as it is.

## What the Godot path can't do yet

- raea has no reader of its own for `.tscn`, `.tres` or `.res`. Every route above runs Godot, so it needs
  `raea setup godot`, and a project Godot never opened is imported first.
- **Shaders don't cross.** A mesh with a ShaderMaterial exports with an empty material, and nothing turns Godot's
  shading language into a raea material. Read the shader and write the look again (`bevy/materials`).
- **Particles don't cross.** A GPUParticles3D exports as an empty node.
- **GDScript doesn't run in raea,** and the export script never adds the scene to Godot's tree, so the scene's own
  scripts don't run either: what a script builds or moves at run time isn't in the `.glb`.
- **Physics doesn't cross as physics.** Bodies and collision shapes are written as glTF extensions that raea's
  loader doesn't use. A game's collisions are rebuilt in raea (`bevy/games`).
- The other way, raea to Godot, is `raea godot export` (`bevy/godot`): a composition's 3D as a project Godot runs,
  and `raea godot back` reads Godot's changes to it as edits to the TSX. Those are raea's own scenes; this guide is
  about bringing other people's projects in.
- A stock Godot can't run these scripts; `raea setup godot` installs the GodotJS build (`bevy/godot`).

## Where open Godot material is

| source | licence, as read | what it has | fetch |
|---|---|---|---|
| Godot's demo projects (`github.com/godotengine/godot-demo-projects`) | MIT for the repository (its LICENSE.md) | 139 small projects; the 33 under `3d/` include a platformer, a truck town, material testers, lights and shadows, CSG and navigation | a sparse checkout of one folder; the whole repository is over 500 MB |
| Godot's third-person shooter demo (`github.com/godotengine/tps-demo`) | code MIT; all assets CC BY 3.0, "Juan Linietsky, Fernando Miguel Calabró"; music CC BY 3.0, Christian Fernando Perucchi | a robot, a level, PBR materials | clone; credit as its LICENSE.md says |
| Kenney's starter kits (`github.com/KenneyNL/Starter-Kit-3D-Platformer`; also FPS, Racing, City-Builder, Basic-Scene) | code MIT; in the platformer kit, read for this guide, models, sprites and sounds are CC0 | a small Godot 4.6 project with `.glb` models and one scene per object | clone, or the branch's tarball from codeload.github.com (5 MB) |
| Kenney, Quaternius and KayKit packs | CC0 | low-poly kits, many with glTF files that Godot and raea both read | `bevy/sources` |
| the Godot Asset Library (`godotengine.org/asset-library`) | per asset; the API's `cost` field holds it (MIT, CC0, GPL ...) | mostly editor add-ons and scripts; 417 projects, templates and demos for Godot 4.6, 15 of them CC0 | `https://godotengine.org/asset-library/api/asset?type=project&godot_version=4.6&cost=CC0` lists them; `/api/asset/ID` gives `download_url` (a zip of the repository at one commit) and `browse_url` |
| Godot Shaders (`godotshaders.com`) | per shader: CC0, MIT or GPL v3, chosen by its author; the licence covers the code, not the pictures beside it | shaders to read and write again in raea | the shader's page. Don't work from a GPL one. |

**Don't take:** GDQuest's demos (`github.com/gdquest-demos`): their code is MIT and their art (textures and models)
is CC BY-NC-SA 4.0, which is outside the rule.

## Why

Godot imports a model into its own resources and builds scenes from them, so a scene file names things only Godot
can open. Godot can also write any scene it has loaded as glTF (`GLTFDocument`), and glTF is what raea loads. So the
bridge is a short script run inside Godot. It carries what glTF can hold, which is geometry, PBR materials, skins
and clips, and leaves behind what is Godot's alone.

## Common mistakes

- **Copying a kit's `.glb` straight into `media/`.** Kenney's models name `Textures/colormap.png` beside them:
  `raea gen check` passes the bare copy and the render refuses it for the missing file. Export the model's scene
  through Godot, which packs the texture in, or copy the model with the folder it names, kept at the same place
  beside it.
- **convert.py on a model animated by moving its parts.** It applies each part's rotation and scale, and the clips
  then pose the parts wrongly: the kit character's antenna sank into its head. convert.py is for models that hold
  still.
- **Taking a repository's MIT for its art.** Read the README's last lines and the licence file to its end.
- **An add-on from the Asset Library taken for an asset.** Most entries are GDScript tools for Godot's editor. Nothing
  of those comes into raea.
- **Expecting the game's look.** The sky, the fog, the glow and every shader stay in Godot. Light the `.glb` in the TSX.
- **A relative output path.** Godot runs in the project's folder; the script's `resolve(out)` names the file where
  raea ran (`bevy/godot`, "Paths").
- **Exporting a scene whose root is a script-driven spawner.** Its children don't exist until the game runs. Export
  the scenes it spawns, one by one.

## Example: a platform and a character out of Kenney's Godot starter kit

Run end to end for this guide on 2026-11-10 with Godot 4.6.1: the platform's scene exported as 144 triangles
(2 x 0.55 x 2 m) and the character's as 550 triangles with its texture inside and its clips `idle`, `jump`, `static`
and `walk`; `raea gen check` found 0 errors and 0 warnings in both, and the composition rendered with the character
posed as the kit's own file poses it. The kit's whole level
(`res://scenes/main.tscn`: 9,038 triangles, four clips) and the stage of Godot's own platformer demo
(`res://stage/stage.tscn`, built from `.res` meshes: 15,008 triangles) went through the same script.

```sh
mkdir -p src && cd src
curl -fsSL https://codeload.github.com/KenneyNL/Starter-Kit-3D-Platformer/tar.gz/refs/heads/main | tar xz && cd ..
KIT=src/Starter-Kit-3D-Platformer-main
SIDE='{"source": "https://github.com/KenneyNL/Starter-Kit-3D-Platformer", "license": "CC0", "credit": "Kenney (kenney.nl)"}'

raea godot run godot/scene-glb.ts --project $KIT res://objects/platform.tscn media/platform.glb
raea godot run godot/scene-glb.ts --project $KIT res://objects/character.tscn media/character.glb
echo "$SIDE" > media/platform.glb.json
echo "$SIDE" > media/character.glb.json

raea gen check media/platform.glb && raea gen check media/character.glb
```

One demo out of Godot's own repository:

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/godotengine/godot-demo-projects.git src/godot-demos
git -C src/godot-demos sparse-checkout set 3d/platformer
raea godot run godot/scene-glb.ts --project src/godot-demos/3d/platformer res://stage/stage.tscn media/stage.glb
```

`godot/scene-glb.ts`, the project's step (type-checked as `sdk/godot/test/guide-scene-glb.ts`):

```ts
// godot/scene-glb.ts: one scene (or mesh resource) of a Godot project as one .glb
//   raea godot run godot/scene-glb.ts --project KIT res://objects/platform.tscn media/platform.glb
import { AnimationMixer, Camera3D, GLTFDocument, GLTFState, Light3D, Mesh, MeshInstance3D, Node, PackedScene, ResourceLoader, resolve, type SceneTree } from "raea/godot";

// the scene's cameras and lights stay behind: in raea those are the TSX's
function strip(node: Node) {
  for (const child of node.get_children()) {
    if (child instanceof Camera3D || child instanceof Light3D) {
      node.remove_child(child);
      child.free();
    } else strip(child);
  }
}

// a clip that moved a camera or light now points at nothing, which glTF's export reports as an error: drop those tracks
function prune(node: Node) {
  if (node instanceof AnimationMixer) {
    const base = node.get_node_or_null(node.root_node);
    const names = node.get_animation_list();
    for (let n = 0; n < names.size(); n++) {
      const clip = node.get_animation(names.get(n));
      for (let i = (clip?.get_track_count() ?? 0) - 1; i >= 0; i--)
        if (!base?.get_node_or_null(clip!.track_get_path(i))) clip!.remove_track(i);
    }
  }
  for (const child of node.get_children()) prune(child);
}

export default async function (_tree: SceneTree, [from, out]: string[]) {
  if (!from || !out) throw new Error("usage: raea godot run godot/scene-glb.ts --project DIR res://SCENE.tscn OUT.glb");
  const res = ResourceLoader.load(from);
  if (!res) throw new Error(`${from}: Godot can't load it`);
  let root: Node;
  if (res instanceof PackedScene) root = res.instantiate()!; // never added to the tree, so its scripts don't run
  else if (res instanceof Mesh) {
    const one = new MeshInstance3D();
    one.mesh = res;
    root = one;
  } else throw new Error(`${from}: a ${res.get_class()}, not a scene or a mesh`);
  strip(root);
  prune(root);
  const doc = new GLTFDocument();
  const state = new GLTFState();
  let err = doc.append_from_scene(root, state);
  if (err === 0) err = doc.write_to_filesystem(state, resolve(out));
  root.free();
  if (err !== 0) throw new Error(`${from}: glTF export failed (Godot error ${err})`);
  console.log(`wrote ${out}`);
}
```

```tsx
import { AbsoluteFill, Composition, registerRoot, staticFile } from "raea";
import { Model } from "raea/3d";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

function Kit() {
  return (
    <AbsoluteFill style={{ background: "#bfd8ee" }}>
      <Camera3d transform={Transform.fromXyz(0, 2.2, 5).lookingAt([0, 0.7, 0])} projection={{ Perspective: { fov: (40 * Math.PI) / 180 } }} />
      <AmbientLight brightness={300} />
      <DirectionalLight transform={Transform.fromXyz(3, 6, 4).lookingAt([0, 0, 0])} illuminance={9600} shadow_maps_enabled />
      <Model src={staticFile("platform.glb")} />
      <Model src={staticFile("character.glb")} animation="walk" position={[0, 0.55, 0]} scale={0.6} />
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="kit" component={Kit} width={1280} height={720} fps={30} durationInFrames={60} />);
```
