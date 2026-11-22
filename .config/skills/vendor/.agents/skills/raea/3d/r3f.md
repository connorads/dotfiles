# three.js and React Three Fiber, drawn by raea

raea draws three.js work as it's written: a React Three Fiber scene inside `<R3F>`, or a plain three.js page's script
inside `<Three program>`. Each frame its three.js scene becomes raea's 3D parts, and raea's engine (Bevy) draws them in a
render, a live play and the web export alike. Use these when the work starts as three.js: a demo or tutorial to bring
in, an R3F scene, drei helpers, a TSL node material, a shader written for three. A new scene made from nothing is
plainer in raea's own components (`bevy/scene`).

Both need the project's own three (and React Three Fiber for `<R3F>`):

```bash
raea add three@0.185.0 @react-three/fiber@9.8.2   # and @react-three/drei, @react-three/postprocessing when used
```

## An R3F scene: `<R3F>`

R3F's JSX goes inside, as it would inside `<Canvas>`, and `<R3F>` takes `<Canvas>`'s settings (`camera`,
`orthographic`, `shadows`, `flat`, `linear`, `scene`). In a box smaller than the frame, it's framed by its box, as
`<Canvas>` is by its element; give it the box's `width` and `height` (frame px) so R3F's own size is the box's too.

```tsx
import { R3F } from "raea/r3f";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

function Spinner() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((_s, dt) => void (ref.current.rotation.y += dt));
  return (
    <mesh ref={ref} castShadow>
      <boxGeometry />
      <meshStandardMaterial color="#e05a2b" />
    </mesh>
  );
}

export const Scene = () => (
  <R3F camera={{ position: [0, 1.5, 4], fov: 45 }} shadows>
    <ambientLight intensity={0.3} />
    <directionalLight position={[3, 5, 2]} intensity={2.5} castShadow />
    <Spinner />
  </R3F>
);
```

Inside `<R3F>`, `useFrame`, refs and mutation are fine, unlike the rest of a composition: raea steps R3F's clock 1/fps
a frame from the composition's frame, never the wall clock, and a seek back starts the scene again from frame 0, so
a render still equals its play. `Math.random()` is seeded for the scene. raea's hooks (`useCurrentFrame`) work inside
too. Two scenes in one composition that come and go each take a `name`.

Played live (raea 0.1.5), R3F's pointer events work as they do in a browser: `onClick`, `onPointerOver`,
`onPointerOut`, `onPointerMove`, `onPointerDown`, `onPointerUp`, `onWheel` and `onPointerMissed` fire on the mesh under
the pointer, and drei's `<OrbitControls>` turn and zoom the camera from the pointer and the wheel. They come from the
play's input frame by frame, so a render given the input the play logged (`raea render --input`) draws the same
frames, and a render with no input draws as before. An `<R3F>` in a box smaller than the frame takes the pointer in
its box: give it the box's `width` and `height`.

## A plain three.js page: `<Three program>` (raea 0.1.5)

A single-file demo's script, wrapped in a function, is the program. It makes its renderer as it always did
(`new THREE.WebGLRenderer({ canvas })` with the canvas it's given, or `document.body.appendChild(renderer.domElement)`,
or three/webgpu's `WebGPURenderer` with `await renderer.init()`), its scene and camera, and renders from
`renderer.setAnimationLoop` or `requestAnimationFrame`. raea's bundler gives it a renderer that draws nothing and
records what it renders; the scene it last rendered is what raea draws.

```tsx
import * as THREE from "three";
import { Three } from "raea/r3f";

function demo(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 2, 6);
  // ... lights and meshes, as the page had them
  renderer.setAnimationLoop((time) => {
    knot.rotation.y = time / 1000;
    renderer.render(scene, camera);
  });
}

export const Scene = () => <Three program={demo} />;
```

Its loop runs once a frame at that frame's time (`time` is frame × 1000 / fps ms), `performance.now()` and three's
`Clock` read the same time, and `Math.random()` is seeded, so frame 40 is the same played to or rendered alone; a seek
back runs the program again from the start. Code at a module's top level can't start again: it must be inside the
function. A program may return a function that undoes it. `<Three>` needs three alone.

## What draws, and what doesn't yet

Drawn: meshes, groups, instanced and batched meshes, points, lines, sprites; standard, physical, basic, Lambert,
normal, matcap, shadow, points and line materials; ShaderMaterial and RawShaderMaterial (their GLSL translated and run
by raea); TSL node materials, unlit and lit, and TSL compute (`renderer.compute`, `computeAsync`: run on raea's GPU,
its storage buffers shared with the node materials that read them, an InstancedMesh with a node material drawn as one
mesh of copies; 0.1.5); standard and physical materials patched by `onBeforeCompile` (drei's `<MeshWobbleMaterial>`,
`<MeshDistortMaterial>` and `<MeshReflectorMaterial>`, an app's own vertex displacement: three's own program with the
patch applied, its surface lit by raea); render targets an app draws itself (a `useFBO`, GPUComputationRenderer's
ping-pong, the reflector's mirrored view: drawn on raea's GPU and read by the materials that use them, 0.1.5);
textures, environment maps, fog, the background, shadows; drei's
`<Text>`, `<Sky>`, `<Stars>`, `<Clouds>`, `<ContactShadows>`, `<Environment>`; @react-three/postprocessing's effects
that raea has (bloom, vignette, depth of field and bokeh, chromatic aberration, lens distortion, SSAO,
anti-aliasing, pixelation, tone mapping, brightness, contrast, hue and saturation), and, as raea frame passes running
the effect's own shader (0.1.5), noise, scanlines, sepia, dot screen, colour average and depth, grid, glitch, shock
wave, LUT, ASCII and `<TiltShift2>`; three/webgpu's `PostProcessing` (`RenderPipeline`, 0.1.5): its
`pass(scene, camera)` is the frame, its bloom, GTAO, depth of field, FXAA, SMAA and pixelation nodes are raea's, and
its film, dot screen, RGB shift, chromatic aberration, LUT, sepia and bleach nodes are frame passes; an `Fn` of the
chain's own isn't run. Close, not exact: hemisphere lights, light probes, Phong and toon materials, `<TiltShift>` and
`<GodRays>`, bloom (raea's, added on top as three's is), and a very dark surface, which reads a little lighter than
three's.

Ambient light is where a three.js scene most often comes out wrong. Three has no ambient light unless the scene adds
one, while Bevy lights every camera with a white ambient of 80 cd/m² unless it's told otherwise. A three.js scene's
metals and dark surfaces then glow evenly where three draws them black (a product shot on black: crop SSIM 0.83 against
0.996 with the ambient matched). Since 0.1.6, `<R3F>` sends an ambient of 0 for a scene that has none, so nothing needs
doing there. Apply the compensation yourself in two cases:

- on raea 0.1.5 and earlier: put `<ambientLight intensity={0} />` in the R3F scene that has no ambient light
- in a three.js scene rebuilt with raea's own components (`<Camera3d>`, `<Mesh3d>`): add
  `<AmbientLight brightness={0} />` from `raea/light` (or the scene's own level) beside its other lights

Three's ambient, hemisphere and light-probe lights light only the diffuse; raea's ambient lights the specular too, so a
glossy surface under one reads a little brighter than three's.

What raea can't draw is named once in the render's output (`raea/r3f: ...`), and the frame draws without it:

- a TSL compute with an indirect dispatch, a texture or a matrix uniform: the scene is drawn without what it computes
  (one first dispatched after the first frame isn't run either, and points and sprites don't read its buffers yet)
- a cube or 3D render target, or a target's depth texture: the target stays empty (a depth texture reads white)
- three's EffectComposer in a plain program: the scene is drawn without its passes
- an `onBeforeCompile` patch to a material other than standard or physical, or the part of one past three's lighting
  (its light, its output colour): drawn without it

Look at the render (`raea render scene.tsx --frame 24 -o f.png`) and read its warnings: each says what was left out.
