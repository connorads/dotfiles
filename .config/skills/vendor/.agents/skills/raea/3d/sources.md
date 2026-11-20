# Sources: open 3D libraries, their licences and how to fetch from them

Every licence and access line here was read at the source on 2026-11-10, except the rows under "Not checked".
Licences change: read the source's own licence page again on the day you take from it.

## What to do

- **The rule.** raea takes an asset only under CC0 (public domain), CC BY with its credit, or MIT-like terms (MIT,
  BSD, Apache-2.0). Not share-alike (CC BY-SA), not non-commercial (NC), not "research only", not a marketplace's own
  licence when the file will sit in a project other people can download.
- **Every asset carries a sidecar** beside it: `chair.glb.json` holding
  `{"source": URL, "license": "CC0", "credit": ""}`. `source` is the asset's own page, `license` is what that page
  says, and `credit` is the line a CC BY licence asks for. The Blender scripts refuse a source without one and carry it
  to their output (`bevy/blender`).
- **Fetch with a saved script**, never by hand: the download goes into the project's `src/` folder, the script writes
  the sidecar from the source's own data, and `media/` gets one `.glb`. Send a User-Agent that names the project.
- **Then route by what arrived:**

  | what arrived | do |
  |---|---|
  | one `.glb` with its textures inside | copy it to `media/` with its sidecar |
  | a `.gltf` with loose files, a `.glb` that names a texture outside itself, a Draco-compressed `.glb`, OBJ, FBX, STL, PLY, `.blend`: a model that holds still | `raea blender run blender/convert.py IN media/OUT.glb` |
  | any of those with clips that move its parts | not convert.py, which applies each part's rotation and scale and so changes the poses: keep the file as it is with the files it names beside it, or take it through its Godot scene (`bevy/godot-projects`) |
  | one object out of a `.blend` that holds many | `bevy/blend-files` |
  | a Godot scene or mesh resource | `bevy/godot-projects` |
  | USD only | convert.py doesn't read USD: take the glTF or FBX download where the source offers one |

- **Check every one:** `raea gen check media/OUT.glb --h REAL_HEIGHT`. Scans come in the scanner's units, so give the
  real height; `-o FIXED.glb` writes it fitted, standing on its origin.
- **Credits.** A film or page that uses CC BY assets lists each sidecar's `credit` and `license` where its credits go.

## CC0: use freely

| source | what it has | fetch |
|---|---|---|
| Poly Haven (polyhaven.com) | 521 models, texture sets, HDRIs; scanned and hand-made, realistic | API, no key: `https://api.polyhaven.com/assets?t=models` lists them, `/info/ID` gives authors and size, `/files/ID` gives every file with its url, size and md5. The API's terms ask for a User-Agent or Referer naming your software, and a visible credit naming Poly Haven in a product that shows its content through the live API. The assets themselves need no credit. |
| ambientCG (ambientcg.com) | PBR materials and HDRIs; only 34 models | API, no key: `https://ambientcg.com/api/v3/assets?type=3d-model&include=downloads` gives each asset's zips (`https://ambientcg.com/get?file=ID_LQ-1K-JPG.zip`): an OBJ, a .blend, a .usdc and the maps. convert.py takes the OBJ. |
| Smithsonian Open Access 3D (3d.si.edu) | about 3,400 scans: furniture, fossils, aircraft, spacecraft, sculpture | API, no key: `https://3d-api.si.edu/api/v1.0/content/file/search?q=WORDS&file_type=glb&quality=Thumb` (or `Low`, `Medium`); each row's `content.uri` is the file. The rows carry no licence field: only items marked CC0 on their 3d.si.edu page are open, the rest have "usage conditions". The .glb files are Draco-compressed and in the scanner's units. |
| The Base Mesh (thebasemesh.com) | 1,250+ untextured base meshes of everyday things | the site's download buttons; no API found |
| Polygonal Mind's sets (opensource3dassets.com) | 18 themed sets of stylised .glb props | a registry on GitHub: `https://raw.githubusercontent.com/ToxSam/open-source-3d-assets/main/data/projects.json` lists the sets with each one's `license` and `asset_data_file`, which holds direct links |
| Kenney (kenney.nl), Quaternius (quaternius.com), KayKit (kaylousberg.com) | low-poly game props, kits and characters | zips from each site; KayKit's packs are also repositories under `github.com/KayKit-Game-Assets`, each with its licence file. Low-poly by design: for games, not for realism. |
| Sketchfab, CC0 filter | a slice of its downloadable models; quality varies | search, no key: `https://api.sketchfab.com/v3/search?type=models&downloadable=true&license=cc0&q=WORDS`; each result names its licence and uploader. Downloading needs the person's Sketchfab login (an OAuth token). The licence is the uploader's choice: prefer a museum's or a studio's own account. |

## CC BY: use with the credit in the sidecar

| source | what it has | fetch | credit |
|---|---|---|---|
| Amazon Berkeley Objects | 7,953 real products as .glb with PBR maps up to 4K: chairs, sofas, lamps, tables, shelves | no account: `https://amazon-berkeley-objects.s3.amazonaws.com/3dmodels/metadata/3dmodels.csv.gz` lists each model's `path`, faces and extents; the file is `.../3dmodels/original/PATH` (or `aws s3 cp --no-sign-request s3://amazon-berkeley-objects/3dmodels/original/PATH .`) | CC BY 4.0; "Amazon.com" for the data, and the dataset's authors as its README lists them |
| Google Scanned Objects | scanned household things: toys, shoes, kitchenware, boxes | Gazebo Fuel, no key: `https://fuel.gazebosim.org/1.0/GoogleResearch/models?per_page=100` lists them with each one's `license_name`; `https://fuel.gazebosim.org/1.0/GoogleResearch/models/NAME.zip` is an OBJ with one texture | CC BY 4.0, Google Research |
| Objaverse (Hugging Face `allenai/objaverse`) | 800K+ objects gathered from Sketchfab | per-object metadata | each object's own: 721K CC BY 4.0, 3.5K CC0, the rest NC or SA. Keep only CC BY and CC0 rows, and the author for the credit. |
| Amazon Lumberyard Bistro | a Paris street (2.8M triangles) and a bistro interior (1M), FBX | NVIDIA ORCA's page: `developer.nvidia.com/orca/amazon-lumberyard-bistro` | CC BY 4.0 |
| Intel Sponza (2022) and Jungle Ruins | the atrium as glTF, FBX and USD (3.7 GB); a rainforest ruin as .blend and USD (4 GB) | Intel's graphics research samples page | "Creative Commons Attribution"; the page states no version |

`bevy/blend-files` lists Blender's own open files (CC0 and CC BY), and `bevy/godot-projects` Godot's.

## Free, but not to pass on

Usable in a render. Never placed in a public project, a shared library or a skill, because the licence forbids handing
the file itself to anyone else.

| source | the term that limits it |
|---|---|
| Fab's Standard License (Quixel Megascans and other listings sold under it) | commercial use in any tool, no credit; "may not resell or redistribute the asset for free on a standalone basis". Needs an Epic account, so the person downloads. |
| BlenderKit | two licences: CC0, and "Royalty Free", which allows commercial use and forbids selling the asset on as an asset. Filter to CC0 for anything a project ships. |
| ShareTextures | a "Custom CC0": no redistribution on other sites, in plugins or in collections, and "no automated downloads". By hand from the site, or not at all. |

## Don't use

| source | why |
|---|---|
| ALab (Netflix Animation Studios, on ASWF) | the ASWF Digital Assets License allows use "solely for education, training, research, software and hardware development, performance benchmarking ... or software and hardware product demonstrations". A film or an ad is none of those. |
| Pixar's Kitchen Set | "only for your personal, non-commercial testing of Pixar's Universal Scene Description technology" |
| NVIDIA Emerald Square | CC BY-NC-SA 3.0 |
| Sketchfab "Standard" and "Editorial" licences | no making the file available on its own; Editorial also forbids commercial use |
| anything CC BY-SA, CC BY-NC or CC BY-ND | outside the rule |

## Make it instead

- **Infinigen** (Princeton, BSD 3-Clause): procedural nature and furnished rooms made in Blender. Heavy to run; not
  run for this guide.
- **ProcTHOR and ProcTHOR-10K** (Allen Institute, Apache-2.0): procedurally laid-out houses. Layouts more than looks.
- `raea gen mesh` for one object with character (`motion/gen`), and solids, `sdf` and `grow` for anything defined by
  numbers or a rule (`bevy/scenes`).

## Not checked

Stated by others, or not reachable when this was written. Read each at its source before first use.

- The Met's 3D models: its Open Access policy puts images of public-domain works under CC0 and names "2D and 3D
  images", but no licence on a downloadable model file was found.
- SMK (National Gallery of Denmark): its scans are on MyMiniFactory through Scan the World; the licence there wasn't read.
- grab3d.com states CC0 for everything and doesn't say who made the models.
- Megascans being free of charge on Fab since 2026-11-05 comes from news reports; Fab's listings weren't read.
- Disney's Moana Island, 3D-FRONT and Unreal-only content were not read again: an earlier survey found them research-only,
  non-commercial and Unreal-only.
- Poly Pizza (the Blender MCP can search it), and how many models Google Scanned Objects holds.

## Why

A render is published, and a raea project is often a public repository, so an asset's licence has to cover both
showing it and handing its file on. CC0, CC BY and MIT-like terms do; a marketplace's "free" usually covers only the
first. The sidecar is what lets anyone check that later, and what a film's credits are built from.

## Common mistakes

- **Free taken as open.** Megascans, BlenderKit's Royalty Free and ShareTextures are free to use and forbidden to
  pass on.
- **One licence assumed for a whole library.** Objaverse, Sketchfab, the Godot Asset Library and blender.org's demo
  files are licensed per item. Read the item's own field and put that in the sidecar.
- **A CC0 scan of a branded product.** CC0 and CC BY cover the scan's copyright, not the logo on it. The Smithsonian
  says so itself ("a third party may claim rights ... such as trademark, privacy, or publicity rights"), and Amazon's
  and Google's scans are of real retail products. Pick unbranded ones, or cover the label with a decal
  (`bevy/materials`).
- **A repository's licence taken for its art.** MIT on a demo's code says nothing about its models
  (`bevy/godot-projects` has two that differ).
- **A research licence that reads like an open one.** ALab and the Kitchen Set download freely and forbid production use.
- **A `.glb` that isn't whole.** A game kit's `.glb` can name a texture file beside it. `raea gen check` passes it and
  the render then refuses it for the missing path. Run convert.py on it where it sits in the kit, which packs the
  texture in, unless it has clips (the table above).
- **A compressed `.glb`.** `raea gen check` reports `KHR_draco_mesh_compression` as an error and names convert.py.
- **A scan placed at the size it came.** A Smithsonian chair measured 9.6 m tall as downloaded. Pass `--h`.
- **`curl` without `-L` on blender.org's demo links,** which answer with a page: the files are under
  `https://download.blender.org/demo/`.

## Example: a Poly Haven stool, fetched, converted and checked

Run end to end for this guide on 2026-11-10 (676 triangles, 0.385 x 0.579 x 0.406 m, `raea gen check`: 0 errors).
The same steps were run on an ambientCG apple (its OBJ) and a Smithsonian side chair (Draco-compressed, 9.6 m as
downloaded).

`blender/polyhaven.sh`, the project's fetch step (it needs `curl` and `jq`):

```sh
#!/bin/bash
# polyhaven.sh ID [RES]: one Poly Haven model as glTF with its textures in src/ID, and its licence sidecar
set -euo pipefail
id=$1 res=${2:-1k} ua="my-project-name"
mkdir -p "src/$id" && cd "src/$id"
curl -fsS -A "$ua" "https://api.polyhaven.com/files/$id" -o files.json
curl -fsS -A "$ua" -O "$(jq -r --arg r "$res" '.gltf[$r].gltf.url' files.json)"
jq -r --arg r "$res" '.gltf[$r].gltf.include | to_entries[] | "\(.key)\t\(.value.url)"' files.json |
  while IFS=$'\t' read -r rel url; do mkdir -p "$(dirname "$rel")"; curl -fsS -A "$ua" -o "$rel" "$url"; done
curl -fsS -A "$ua" "https://api.polyhaven.com/info/$id" |
  jq --arg id "$id" '{source: ("https://polyhaven.com/a/" + $id), license: "CC0", credit: ("Poly Haven: " + (.authors | keys | join(", ")))}' \
  > "${id}_${res}.gltf.json"
```

```sh
bash blender/polyhaven.sh painted_wooden_stool 1k
raea blender run blender/convert.py src/painted_wooden_stool/painted_wooden_stool_1k.gltf media/stool.glb --max-texture 1024
raea gen check media/stool.glb --h 0.58
```

`media/stool.glb.json` then reads
`{"source": "https://polyhaven.com/a/painted_wooden_stool", "license": "CC0", "credit": "Poly Haven: Kirill Sannikov", "steps": [...]}`.

```tsx
import { AbsoluteFill, Composition, registerRoot, staticFile } from "raea";
import { Model } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

function Stool() {
  return (
    <AbsoluteFill style={{ background: "#e9e4da" }}>
      <Camera3d transform={Transform.fromXyz(0, 0.9, 2.4).lookingAt([0, 0.3, 0])} projection={{ Perspective: { fov: (40 * Math.PI) / 180 } }} />
      <AmbientLight brightness={300} />
      <DirectionalLight transform={Transform.fromXyz(3, 6, 4).lookingAt([0, 0, 0])} illuminance={9600} shadow_maps_enabled />
      <Mesh3d transform={Transform.fromXyz(0, -0.05, 0)}>
        <Cuboid half_size={[5, 0.05, 5]} />
        <StandardMaterial base_color="#cfc8ba" perceptual_roughness={0.9} />
      </Mesh3d>
      <Model src={staticFile("stool.glb")} position={[0, 0, 0]} />
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="stool" component={Stool} width={1280} height={720} fps={30} durationInFrames={30} />);
```
