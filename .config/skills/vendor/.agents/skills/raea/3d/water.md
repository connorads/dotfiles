# Water: seas, pools and what's under them

## What to do

- Decide what the shot needs from the three parts of a believable water:
  - **motion**: the waves, and whether the swell has to rise in silhouette or only move the light;
  - **appearance**: how light meets it (reflection, what shows through, colour by depth, glitter, foam, caustics);
  - **interaction**: things in it (a wake, rings round a post, a splash, foam at the shore).

  Most shots need the first two. Leave out what the camera can't see.
- Pick the technique by the shot:
  - **A sum of waves in a surface shader** (Gerstner, GPU Gems 1 ch. 1): cheap, loops, and fine for calm to choppy
    seas, lakes and pools. This guide's way.
  - **A spectrum by FFT** (Tessendorf; `mate-h/bevy_fft` is a building block): an open ocean of many thousands of
    waves that tiles. Heavier, and not in raea's SDK yet.
  - **A shallow-water simulation** (bevy_fft has one): water that flows and ripples where things move through it.
  - **A baked liquid**: `<Goo solver="sph">` for pours, splashes and spills (`bevy/liquids`).
  - `Neopallium/bevy_water` (vertex waves, a height query for floating things, tiles) is a crate for Bevy 0.18; raea
    is on 0.20. Take its wave set and its height query, not the crate.
- In raea a water surface is a flat `Plane3d` with `<ExtendedMaterial base={<StandardMaterial ...
  opaque_render_method="Forward" />} extension={<ShaderExtension wesl={SRC} uniforms={...} />} />`. Its
  `fn surface(in, pbr)` sets the normal (`(*pbr).N`), the colour, the roughness and the emissive per pixel; read
  uniforms as `u_NAME()`, and the time as `globals.time`. The hook can't move vertices and a `Plane3d` has no
  subdivisions, so the plane stays flat. Waves move the light, not the silhouette. For a swell that rises against the
  sky, bake a displaced mesh per frame (`<MeshSequence>`) or use `<Goo>`.
- Waves as normals:
  - Sum trains of different wavelength `len`, direction `d` and amplitude `a`. For each, `k = 2π/len`, and the speed
    is deep water's: `ω = √(9.8 k)`. Round ω to whole cycles in the shot (or the minute) and the water loops.
  - Steepness `ka` sets the sea state: 0.02-0.03 is a light breeze or a sheltered cove, 0.05 is choppy. Sharpen the
    crests with Gerstner's term (`n.y = 1 - Σ Q·ka·sin`, Q about 0.5).
  - Give each train its own phase, space the wavelengths about 1.4 times apart, and scatter the directions within
    about 50 degrees of the swell's. Trains in simple ratios, or in nearly square pairs, draw a lattice.
- Filter by the pixel, not by distance. Fade each train as it nears six pixels (`keep = clamp(len / (6 *
  length(fwidth(p.xz))) - 1, 0, 1)`). Then add the slope it no longer draws to the roughness: `α² = α0² + Σ (1 -
  keep)·(ka)²/2`, and perceptual roughness is `√α`. Far water then widens the sun's glitter into a path instead of
  shimmering.
- Reflect at water's own strength: `reflectance={0.35}` (Bevy's F0 is 0.16·r², so 0.35 is water's 2%; 0.5 is 4%,
  glass). Fresnel then takes the water from see-through underfoot to a mirror at the horizon.
- What a forward plane reflects: Bevy's lighting gives it the Environment (the panorama or the atmosphere) and the
  sun's highlight, but not the scene: no other objects and no screen-space reflections. Outdoors that's most of what
  the sea shows. Indoors the panorama is some other place, so trace the room in the shader instead: its box, its
  lights and its windows, at the values you metered (`bevy/solari`). Set `reflectance={0}` so Bevy adds no panorama,
  and add the room `* fresnel` to the emissive.
- What shows through, `* (1 - fresnel)`:
  - Refract the view ray into the water (`refract(v, n, 1 / 1.33)`) and trace it to the floor or a wall. Lane lines
    and tiles then bend with the ripples.
  - Absorb along the way down and back up (Beer-Lambert, `exp(-σ·distance)`). Clear water is about σ = (0.45, 0.065,
    0.022) per metre, so red is gone in two metres and the deep end goes blue-green.
  - Add a little scatter from the lamps for the glow round them.
  - For a sea, the body colour is a deep teal or blue base colour, lit by Bevy.
- Caustics are where the bent rays bunch up. Light crossing a surface with height Hessian `H` lands a throw `D`
  further on, where `D = depth × (1 - 1/1.33)` going in (onto a floor) and `distance × 0.33` coming out (onto a
  ceiling over a pool). The brightness is `1 / |det(I + D·H)|`: thin bright lines where the determinant nears
  nought. Draw them on the floor inside the water's shader, and on a ceiling as an added plane (`alpha_mode="Add"`,
  base black, the net as emissive).
- Crests and foam:
  - Where a low sun is ahead, light comes through the thin crests on faces turned to the camera, as a green-gold
    glow. Write it as emissive, and only where the sun really reaches.
  - Foam goes where the Gerstner fold sum gets steep: white, roughness 0.85, broken into streaks along the swell.
  - Shore foam needs the water's depth, which the depth prepass can't give (the opaque water is in it), so give the
    shader the shore's shape as a distance.
- Write the emissive with alpha 1.0, so it's in the scene's light units (`bevy/solari`).
- Under Solari the water isn't traced. Close the basin under it with a traced box, or light from below (a sun parked
  under the ground) comes up through it. Water that must mirror the scene's own objects (a boat, a person on the
  edge) can be a plain `StandardMaterial` instead (roughness 0.02-0.05, `reflectance={0.35}`, a normal map moved
  with `uv_transform`). Solari then traces its reflections, but it can't refract or show the floor.

## Why

Water is almost all light transport. Its own colour is dark, so what you see is the sky or the room it reflects,
weighted by Fresnel, plus what comes up from under it, coloured by how far that light travelled through the water.
The waves matter because they move the reflection and the refraction around. A flat plane with good normals and
honest Fresnel, absorption and caustics reads as water from any height where the swell doesn't break the horizon.
GPU Gems' rule is low-frequency waves as displacement and high-frequency ones as normals. In raea the plane can't be
displaced, so everything is normals, and the long waves are kept gentle.

Sources: GPU Gems 1 ch. 1, "Effective Water Simulation from Physical Models" (Finch: Gerstner sums, mesh resolution
limits); Tessendorf, "Simulating Ocean Water" (the spectrum, caustics, scattering, sunbeams); the ocean rendering
survey (picking a technique); `Neopallium/bevy_water` and `mate-h/bevy_fft` (Bevy implementations);
Bevy Elements' water research note.

## Common mistakes

- `reflectance={0.5}`: 4%, glass. The water looks grey and plastic. Use 0.35.
- Every train with phase 0: they all crest together near the origin and draw a target of rings there.
- Trains in simple ratios or square pairs: a lattice of diamonds. Space them about 1.4x and scatter the angles.
- Too steep near a low camera: 15 cm over the sea, each wave is a glass blob. Keep `ka` near 0.03 for a calm sea.
- Fading short waves by distance (`dist / 80`) instead of the pixel: far water aliases, or near water goes smooth.
- An indoor pool reflecting the HDRI of some other place. Trace the room and set `reflectance={0}`.
- Caustics as `1 / (1 + D·∇²h)`: soft blobs, not the net. Use the Hessian's determinant.
- Expecting the water to stop light under Solari: put a traced floor under it.
- A backtick inside a WGSL comment in a TS template string ends the string ("Expected a semicolon").

## Example: a calm sea at sunset

```tsx
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame } from "raea";
import { Atmosphere, ToneMapping } from "raea/3d";
import { ExtendedMaterial, ShaderExtension, StandardMaterial } from "raea/pbr";
import { Mesh3d, Plane3d, Sphere } from "raea/mesh";
import { DirectionalLight, SolariLighting } from "raea/light";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

// The sea's surface: sixteen Gerstner trains as normals (the plane stays flat), on deep-water speeds, each with its own
// phase, wavelengths 1.39x apart at scattered angles round the swell's. A train under ~6 pixels fades and its slope
// goes into the roughness, so the far sea widens the sun's glitter instead of shimmering.
const SEA = /* wgsl */ `
const TAU: f32 = 6.2831853;
fn surface(in: VertexOutput, pbr: ptr<function, PbrInput>) {
  let p = in.world_position.xz;
  let t = globals.time;
  let fw = max(length(fwidth(p)), 1e-4);
  var slope = vec2<f32>(0.0);
  var q = 0.0;
  var lost = 0.0;
  for (var i = 0; i < 16; i++) {
    let fi = f32(i);
    let len = 14.0 * pow(0.72, fi);
    let a = (fract(sin(fi * 12.9898 + 4.1) * 43758.5453) - 0.5) * 1.75;
    let d = vec2<f32>(sin(a), cos(a));
    let k = TAU / len;
    let om = round(sqrt(9.8 * k) * u_loop() / TAU) * TAU / u_loop();
    let ph = k * dot(d, p) - om * t + fract(len * 7.31) * TAU;
    let ka = u_steep();
    let keep = clamp(len / (fw * 6.0) - 1.0, 0.0, 1.0);
    slope += keep * ka * cos(ph) * d;
    q += keep * 0.55 * ka * sin(ph);
    lost += (1.0 - keep) * 0.5 * ka * ka;
  }
  (*pbr).N = normalize(vec3<f32>(-slope.x, 1.0 - q, -slope.y));
  let a0 = 0.04 * 0.04;
  (*pbr).material.perceptual_roughness = sqrt(sqrt(a0 * a0 + lost));
  // the water's own colour (what comes up from under the surface); the sky and the sun come from Bevy's lighting
  (*pbr).material.base_color = vec4<f32>(0.004, 0.03, 0.045, 1.0);
}`;

function Sea() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <Camera3d transform={Transform.fromXyz(0, 1.2 + 0.002 * f, 6).lookingAt([0, 0.9, -40])} projection={{ Perspective: { fov: (40 * Math.PI) / 180, far: 4000 } }}>
        <SolariLighting bounces={2} />
      </Camera3d>
      <ToneMapping exposure={-1} />
      <Atmosphere light />
      <DirectionalLight illuminance={40000} shadow_maps_enabled transform={Transform.fromXyz(8, 5, -100).lookingAt([0, 0, 0])} />
      <Mesh3d name="sea">
        <Plane3d half_size={[2000, 2000]} />
        {/* reflectance 0.35 is water's 2% (Bevy's F0 = 0.16 r^2); Forward, as a surface hook runs in the main pass only */}
        <ExtendedMaterial
          base={<StandardMaterial base_color="#0a3040" perceptual_roughness={0.04} reflectance={0.35} opaque_render_method="Forward" />}
          extension={<ShaderExtension wesl={SEA} uniforms={{ loop: 3, steep: 0.03 }} />}
        />
      </Mesh3d>
      {/* a rock: a plain StandardMaterial, so Solari traces it (the sea is drawn forward and isn't) */}
      <Mesh3d name="rock" transform={Transform.fromXyz(-6, -0.4, -18).withScale([3, 1.2, 2])}>
        <Sphere radius={1} />
        <StandardMaterial base_color="#3a332c" perceptual_roughness={0.9} />
      </Mesh3d>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="sea" component={Sea} width={960} height={540} fps={30} durationInFrames={90} />);
```

A frame shows the sun's glitter path running to the horizon, widening with distance, and the sky's gradient
reflected in the near ripples. A pool builds on the same waves: refract into the basin, absorb, light the floor and
its caustics, and trace the hall into the reflection, as the list above says.
