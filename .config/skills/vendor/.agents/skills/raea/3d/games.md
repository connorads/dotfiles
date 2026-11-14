# A 3D game

Read `motion/games` first: the step, `useGameState`, `useInput`, `useGameEvents` and the input script work the same
in 3D. This file is what changes when the play field is 3D.

## What to do

- Keep the game's state as plain numbers in world units (`x` from -3 to 3 across the lane, `z` towards the camera),
  step it purely, and draw it: each entity in the state is a `<Mesh3d>` whose `transform` comes from the state at
  this frame (`Transform.fromXyz(e.x, 0, e.z)`). The step never touches meshes; the meshes never hold state.
- Give every entity a stable `name` from its id in the state (`name={"rock-" + r.id}`), so an entity that's removed
  doesn't hand its motion to the next one.
- Collisions are arithmetic in the step: distance between centres under the sum of radii, or overlapping boxes per
  axis. Keep the hit as a flag on the state for the frame it happens (`hit: true`) so `useGameEvents` can cue a sound.
- Randomness in the step: `Math.random()` there is seeded for that step's frame, the same on every render and replay;
  keep what it decides (a spawn's place) in the state. Where an entity is drawn, it's new every frame: seed from the
  id there, `const r = ((id * 9301 + 49297) % 233280) / 233280`.
- A fixed camera behind and above the player (`Transform.fromXyz(0, 4, 8).lookingAt([0, 0, 0])`) reads best; a chase camera
  is the player's position plus an offset, computed from the state, looking at the player.
- Score and prompts go on the page over the 3D, opaque.
- For hundreds of entities, keep them in an ECS world (`createWorld()` from `raea/ecs`, systems stepping it)
  and draw it with `<Entities world={game.at(useCurrentFrame())} />`: the engine draws each entity's `Mesh` component
  without a React element per entity.
- **Live play:** a 3D game plays live in the feed as it renders: each frame's 3D is made from the state the game
  just computed from the player's keys, and drawn by the same engine from the same rows a render uses, so a render of
  the play's logged input is the same frames. What a part looks like besides its placement, colour, roughness,
  metal, alpha and glow (its shape, map, light colour, model file) is taken from the frame it first
  shows: to change a shape, give the part a new name. A part gone for 240 frames is freed and comes back as a new one.

## Why

A 3D frame is a function of the state at that frame, and the state is a pure fold over the input, so a render, a
re-render and a play-through all show the same game.

## Common mistakes

- Moving a mesh by mutating a ref or an object inside the step: return new state, draw from it.
- Entities without names, drawn from an array that shrinks: the survivors swap motion.
- Collision against the mesh's look rather than the state's numbers: the engine never reports contacts back.
- `Math.random()` where an entity is drawn rather than in the step: it's new every frame, so the entity jumps. Decide
  it in the step and keep it in the state.

## Example: steer a cube through falling rocks (scripted input for the render)

```tsx
import { AbsoluteFill, Composition, registerRoot, useGameState, type FrameInput } from "raea";
import { Sphere } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Quat, Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

const FRAMES = 150;
interface Rock { id: number; x: number; z: number }
interface Game { x: number; rocks: Rock[]; next: number; hits: number; hit: boolean }
const INITIAL: Game = { x: 0, rocks: [], next: 0, hits: 0, hit: false };

/** The scripted run a render plays when nobody is pressing keys: left, then right, then left. */
function scripted(frame: number): string[] {
  const t = frame % 60;
  return t < 20 ? ["ArrowLeft"] : t < 45 ? ["ArrowRight"] : [];
}

function step(s: Game, input: FrameInput, frame: number): Game {
  const keys = input.keys.length ? input.keys : scripted(frame);
  const dx = (keys.includes("ArrowRight") ? 0.12 : 0) - (keys.includes("ArrowLeft") ? 0.12 : 0);
  const x = Math.max(-3, Math.min(3, s.x + dx));
  let rocks = s.rocks.map((r) => ({ ...r, z: r.z + 0.18 })).filter((r) => r.z < 6);
  let next = s.next;
  if (frame % 12 === 0) {
    const seed = ((next * 9301 + 49297) % 233280) / 233280;
    rocks = [...rocks, { id: next, x: -3 + seed * 6, z: -14 }];
    next += 1;
  }
  const struck = rocks.find((r) => Math.abs(r.z - 3) < 0.5 && Math.abs(r.x - x) < 0.8);
  if (struck) rocks = rocks.filter((r) => r !== struck);
  return { x, rocks, next, hits: s.hits + (struck ? 1 : 0), hit: Boolean(struck) };
}

function Dodge() {
  const g = useGameState(INITIAL, step);
  return (
    <AbsoluteFill style={{ background: "#0d1321" }}>
      <Camera3d transform={Transform.fromXyz(0, 4, 9).lookingAt([0, 0, 0])} projection={{ Perspective: { fov: (50 * Math.PI) / 180 } }} />
      <AmbientLight brightness={140} />
      <DirectionalLight transform={Transform.fromXyz(3, 8, 5).lookingAt([0, 0, 0])} illuminance={9600} shadow_maps_enabled />
      <Mesh3d transform={Transform.fromXyz(0, -0.55, -4)}>
        <Cuboid half_size={[4, 0.05, 11]} />
        <StandardMaterial base_color="#1d2d44" perceptual_roughness={0.9} />
      </Mesh3d>
      <Mesh3d transform={Transform.fromXyz(g.x, 0, 3).withScale(g.hit ? 1.25 : 1)} name="player">
        <Cuboid half_size={[0.4, 0.4, 0.4]} />
        <StandardMaterial base_color={g.hit ? "#ef4444" : "#f0ebd8"} perceptual_roughness={0.4} />
      </Mesh3d>
      {g.rocks.map((r) => (
        <Mesh3d key={r.id} transform={Transform.fromXyz(r.x, 0, r.z).withRotation(Quat.fromEuler("XYZ", r.z, r.id, 0))} name={`rock-${r.id}`}>
          <Sphere radius={0.45} />
          <StandardMaterial base_color="#748cab" perceptual_roughness={0.8} />
        </Mesh3d>
      ))}
      <div style={{ position: "absolute", left: 48, top: 36, fontFamily: "Inter", fontWeight: 800, fontSize: 48, color: "#f0ebd8" }}>{`HITS ${g.hits}`}</div>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="dodge3d" component={Dodge} width={1280} height={720} fps={30} durationInFrames={FRAMES} />);
```

## State machines: what an entity is doing

When an entity's behaviour has modes (a player that can be idle, running, jumping, landing, hurt; an enemy that
patrols, waits, chases; a game that is playing, won or over), write each as a machine instead of a tangle of flags.
`machine` comes from `raea` (or `raea/games`); the shape is XState's, the rules are a game's:

- **Triggers, not events.** A transition `{ to: "jump", when: (ctx, env) => env.jump }` is a guard polled every frame
  inside the step. Nothing is sent. `always: [...]` is checked in order and the first that holds fires; at most one
  transition a frame; the innermost state's transitions are checked before its parent's.
- **Delays are frames.** `after: { 30: "idle" }` fires once the state has been active 30 frames (never milliseconds,
  never timers). `{ to, after: 6, when }` waits and checks a guard.
- **Actions return the new context.** `entry`, `exit` and `tick` (every frame the state is active, the entry frame
  too) are `(ctx, env) => newCtx`; there is no `assign`. Put the physics in `tick` of the state that has it.
- **Each entity carries its own machine.** Its snapshot is plain data in the entity, at `sm`: start it with
  `sm: m.start()` in the initial state, step it with `m.step(entity, env)` inside the game's step, and step a list
  with `stepAll(m, list, env)` (one machine per enemy). The fold stays pure, so renders and live play agree.
- **Read it to draw.** `m.state(ctx)` is the leaf, `m.is(ctx, "air")` matches any active state, `m.steps(ctx)` counts
  frames in the state (for squash and blink timing), `m.entered(before, after, "hurt")` is an event for
  `useGameEvents` and the playtest's `events`.
- **Nested states**: a state with `initial` and `states`; names are unique across the machine, so `to: "run"` reaches
  it from anywhere. A parent's transitions apply from every substate. `history: "shallow"` or `"deep"` resumes where it
  left; `type: "final"` marks an end (a dead enemy); `onDone` leaves a parent once its substate is final.
- **Input edges**: keep last frame's keys in the state and pass `keyEdges(prev, now)` as the step's events; `on:
  { "keydown:ArrowUp": "jump" }` fires only on the press.
- **Typed and checked.** `machine<Ctx, Env>()({ id, initial, states })` (note the `()`): a transition to a missing
  state or a guard reading a missing field doesn't compile; an unreachable state or a non-final state with no way out
  throws when the file loads.
- **Playtests see them.** Add `machines: (s) => ({ player: player.watch(s.player) })` to the `playtest` export; the
  bots then report each machine's state and transition coverage and any softlock, and `edit.playtest.ts` can check
  them with `coversStates`, `coversTransitions`, `noSoftlock`, `noUnreachable` and `reaches` (sdk/react/docs/playtest.md).

From XState: `target`/`guard` work as `to`/`when`; `after` counts frames; there are no parallel regions (give the
entity two machines), no `invoke`, `spawn` or actors (entities in the state, each with its machine), and no `send`
(a guard reads what changed). Common mistakes: `machine<Ctx>({...})` without the `()`; a context without its `sm`
field; mutating the context in an action; a delay written in milliseconds.

## Example: a hero that jumps and two patrolling guards (machines, scripted input)

```tsx
import { AbsoluteFill, Composition, machine, registerRoot, stepAll, useGameState, type FrameInput, type Playtest, type Snapshot } from "raea";
import { Sphere } from "raea/3d";
import { StandardMaterial } from "raea/pbr";
import { Cuboid, Mesh3d } from "raea/mesh";
import { AmbientLight, DirectionalLight } from "raea/light";
import { Transform } from "raea/transform";
import { Camera3d } from "raea/camera";

const FRAMES = 240;
interface Hero { y: number; vy: number; sm: Snapshot }
interface Guard { x: number; z: number; sm: Snapshot }
interface Game { hero: Hero; guards: Guard[] }

const hero = machine<Hero, { jump: boolean }>()({
  id: "hero",
  initial: "ground",
  states: {
    ground: { always: { to: "jump", when: (_h, e) => e.jump } },
    jump: {
      entry: (h) => ({ ...h, vy: 0.3 }),
      tick: (h) => ({ ...h, y: Math.max(0, h.y + h.vy), vy: h.vy - 0.02 }),
      always: { to: "land", when: (h) => h.y <= 0 && h.vy < 0 },
    },
    land: { entry: (h) => ({ ...h, y: 0, vy: 0 }), after: { 12: "ground" } },
  },
});

// one machine per guard: walk right, wait, walk back left
const guard = machine<Guard, null>()({
  id: "guard",
  initial: "right",
  states: {
    right: { tick: (g) => ({ ...g, x: g.x + 0.04 }), always: { to: "wait", when: (g) => g.x >= 2.5 } },
    wait: { after: { 30: "left" } },
    left: { tick: (g) => ({ ...g, x: g.x - 0.04 }), always: { to: "right", when: (g) => g.x <= -2.5 } },
  },
});

const INITIAL: Game = {
  hero: { y: 0, vy: 0, sm: hero.start() },
  guards: [{ x: -2.5, z: -2, sm: guard.start() }, { x: 1, z: -4, sm: guard.start() }],
};

/** The scripted run a render plays when nobody presses keys: a jump every second. */
const scripted = (frame: number) => (frame % 60 < 4 ? ["ArrowUp"] : []);

function step(s: Game, input: FrameInput, frame: number): Game {
  const keys = input.keys.length ? input.keys : scripted(frame);
  return { hero: hero.step(s.hero, { jump: keys.includes("ArrowUp") }), guards: stepAll(guard, s.guards, null) };
}

// what a playtest bot steps and traces (sdk/react/docs/playtest.md)
export const playtest: Playtest<Game> = {
  initial: INITIAL,
  step,
  actions: [["ArrowUp"], []],
  machines: (s) => ({ hero: hero.watch(s.hero), ...Object.fromEntries(s.guards.map((g, i) => ["guard-" + i, guard.watch(g)])) }),
};

function Hop() {
  const g = useGameState(INITIAL, step);
  const state = hero.state(g.hero);
  const squash = state === "land" ? 1 - 0.3 * (1 - hero.steps(g.hero) / 12) : 1;
  return (
    <AbsoluteFill style={{ background: "#0d1321" }}>
      <Camera3d transform={Transform.fromXyz(0, 3, 8).lookingAt([0, 0.5, -1])} projection={{ Perspective: { fov: (50 * Math.PI) / 180 } }} />
      <AmbientLight brightness={160} />
      <DirectionalLight transform={Transform.fromXyz(3, 8, 5).lookingAt([0, 0, 0])} illuminance={9600} shadow_maps_enabled />
      <Mesh3d transform={Transform.fromXyz(0, -0.05, -2)}>
        <Cuboid half_size={[4, 0.05, 4]} />
        <StandardMaterial base_color="#1d2d44" perceptual_roughness={0.9} />
      </Mesh3d>
      <Mesh3d transform={Transform.fromXyz(0, 0.4 + g.hero.y * 4, 1).withScale([1, squash, 1])} name="hero">
        <Cuboid half_size={[0.4, 0.4, 0.4]} />
        <StandardMaterial base_color={state === "jump" ? "#f59e0b" : "#f0ebd8"} perceptual_roughness={0.4} />
      </Mesh3d>
      {g.guards.map((w, i) => (
        <Mesh3d key={i} transform={Transform.fromXyz(w.x, 0.45, w.z)} name={`guard-${i}`}>
          <Sphere radius={0.45} />
          <StandardMaterial base_color={guard.state(w) === "wait" ? "#ef4444" : "#748cab"} perceptual_roughness={0.7} />
        </Mesh3d>
      ))}
      <div style={{ position: "absolute", left: 48, top: 36, fontFamily: "Inter", fontWeight: 800, fontSize: 44, color: "#f0ebd8" }}>{state.toUpperCase()}</div>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="hop3d" component={Hop} width={1280} height={720} fps={30} durationInFrames={FRAMES} />);
```

## Sound: one-shots on transitions, a bed under the voice

A game's sound is Tone.js on raea (`motion/music` has the whole of it). Build the instruments at the top level, give
the bed and the sounds their buses, and fire each one-shot on the frame its event happens:

- `useGameEvents(INITIAL, fold, (before, after) => machine.state(after.hero) === "land" && machine.state(before.hero) !== "land")`
  gives the frames where a transition happened. `<Tone.Sfx when={landings.includes(frame)} play={(t) => thump.triggerAttackRelease("C2", "8n", t)} />`
  plays the one-shot on exactly that frame. A replay of the same input plays the same sound.
- `Tone.vary(instrument, { pitch: 0.4, volume: 2 })` gives seeded pitch and volume variation, so ten hits don't sound like one
  copied. `maxPolyphony: 4` caps an instrument's voices: the oldest is stolen, faded out over 5 ms.
- Round-robin a set of samples by the frame: `coin.triggerAttackRelease(frame % 2 ? "C5" : "G5", "8n", t)` on a
  Sampler whose notes hold different takes.
- `Tone.buses.music.duck(Tone.buses.voice, { amount: -12 })` keeps a voice line clear. Give the voice's `<Audio bus="voice">`.
- Keep `<Mix lufs={-14} ceiling={-1.5} />`: the master measures the game's whole sound, its Tone included.

```tsx
const thump = Tone.vary(new Tone.MembraneSynth({ octaves: 4, maxPolyphony: 4, poly: true }), { pitch: 0.5, volume: 2 }).connect(Tone.buses.sfx);
const landed = (b: Game, a: Game) => ball.state(a.ball) === "land" && ball.state(b.ball) !== "land";

function Game() {
  const frame = useCurrentFrame();
  const lands = useGameEvents(INITIAL, fold, landed);
  return (
    <AbsoluteFill>
      {/* ...the scene... */}
      <Tone.Sfx when={lands.includes(frame)} play={(t) => thump.triggerAttackRelease("C2", "8n", t)} />
    </AbsoluteFill>
  );
}
```

sdk/react/bench/tone/game is a working game with all of this (a machine, a ducked bed, an SAO coin, a voice line).
