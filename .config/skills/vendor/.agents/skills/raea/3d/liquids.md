# Liquids and goo: baked simulations

## What to do

- `<Goo>` (from `raea/3d`) bakes a simulation once, the first time a render asks for it, into the
  composition's asset store, then draws it by the frame as a `<MeshSequence>`. The same props reuse the same bake;
  change one and it bakes again. A bake takes minutes, not frames: get the shot right with a few `--frame` renders.
- Pick the solver by what it is:
  - `solver: "sph"` for a thin liquid that pours, splashes and spreads: coffee dumped from a mug, water from a tap,
    honey drizzled. SPlisHSPlasH, about 40k particles at the 1 mm default; a spill settles 4-5 mm deep, as coffee does.
  - the default (`"mpm"`) for things that melt into goo: a cake slumping, a figure going soft. Each object is a glTF's
    nodes that soften from `start` over `melt` seconds; `useGoo(props).gone(name)` says when to hide the solid part.
- Where the liquid comes from (sph; each object is its own liquid, `liquid` naming what it is: water, coffee, tea, milk,
  juice, oil, syrup or honey set its colour, density and viscosity):
  - `cup: 0, level: 0.065`: filling `cups[0]` to 6.5 cm above its foot. A cup is a hollow cylinder (`radius` inside,
    `height`, `base`, `wall`) moved along `poses`: `[t, 16 numbers]`, t in seconds from the goo's start, the numbers
    the cup's frame to world, column-major, its axis +y. Lift and tip it there and the liquid sloshes and pours out.
  - `block: { min, max }`: a box of liquid that falls where it is.
  - `src` + `nodes`: a closed glTF mesh, filled.
  - `emitter: { at, dir, radius, speed, start, end }`: a round stream from a tap or a jug's lip.
- What it runs over: `colliders` (boxes: a counter, a floor) and, for sph, `obstacles` (glTF meshes, standing or moved
  along `poses`). Keep `bounds` tight round the action; liquid leaving them is gone, and big bounds cost time.
- How it looks: `<Goo color roughness clearcoat />` for an opaque liquid; for a clear one (water, tea) draw the
  bake yourself with `useGoo` and `<MeshSequence transmission={1} ior={1.33} attenuationColor attenuationDistance />`.
  Transmission is screen-space: it bends what's on screen behind it, and one clear layer doesn't show another.

## The sph block

`sph: { radius, viscosity, tension, threads, maxSpeed, step, boundary }`. Leave it at its defaults unless something is
wrong:

- `radius` (0.001 m): finer is slower; 0.002 is fine for a quick look.
- `threads` (8): `1` makes the bake the same byte for byte every time, about 2.5x slower.
- `tension` (0, off): at millimetre particles even 30 beads a spill into balls, and 100 blows up.
- `maxSpeed` (25 m/s): a particle past it stops the bake with an error saying when. That means the setup is wrong
  (a cup moving too fast, a wall too thin), not that the limit is low.

## Example: a mug dumped onto a counter

```tsx
import { Goo } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { DirectionalLight } from "raea/light";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

// the mug's frame at t: lifted 12 cm over 0.4 s, then tipped 2.2 rad about x over the next 0.5 s
function pose(t: number): number[] {
  const s = (u: number) => { const v = Math.min(Math.max(u, 0), 1); return v * v * (3 - 2 * v); };
  const lift = 0.12 * s(t / 0.4), a = 2.2 * s((t - 0.4) / 0.5), c = Math.cos(a), n = Math.sin(a);
  return [t, 1, 0, 0, 0, 0, c, n, 0, 0, -n, c, 0, 0, 0.9 + lift, 0, 1];
}
const poses = Array.from({ length: 61 }, (_, i) => pose(i / 30));

export default function Spill() {
  return (
    <>
      <Camera3d transform={Transform.fromXyz(0.5, 1.2, 0.6).lookingAt([0, 0.9, -0.1])} projection={{ Perspective: { fov: (35 * Math.PI) / 180 } }} />
      <DirectionalLight transform={Transform.fromXyz(2, 4, 1).lookingAt([0, 0, 0])} illuminance={32000} shadow_maps_enabled />
      <Mesh3d transform={Transform.fromXyz(0, 0.88, 0)}><Cuboid half_size={[0.6, 0.02, 0.4]} /><StandardMaterial base_color="#e8e4dc" /></Mesh3d>
      <Goo seconds={4} solver="sph" bounds={{ min: [-0.5, 0.85, -0.4], max: [0.5, 1.2, 0.4] }}
        colliders={[{ box: { min: [-0.6, 0.86, -0.4], max: [0.6, 0.9, 0.4] } }]}
        cups={[{ radius: 0.04, height: 0.1, base: 0.008, wall: 0.006, poses }]}
        objects={[{ name: "coffee", liquid: "coffee", cup: 0, level: 0.065, start: 0 }]}
        color="#2a160b" roughness={0.05} clearcoat={1} subsurface={0} />
    </>
  );
}
```

Draw the mug on the same curve so it carries the liquid where it's seen: an `<Entity
transform={Transform.fromXyz(0, 0.9 + lift, 0).withRotation(Quat.fromEuler("XYZ", a, 0, 0))}>` round its meshes or `<Model>`, `lift` and `a` worked out from the frame's seconds as in `pose`.
