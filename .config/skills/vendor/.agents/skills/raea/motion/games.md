# Games: useInput, useGameState, useGameEvents

## What to do

- **Draw the game in an `<Arena>`** (`import { Arena, Banner, Hint, Score } from "raea/arena"`). Give it the
  field's own size, `<Arena width={1600} height={900}>`, and position every child in those units (0 to 1600 across, 0
  to 900 down): the Arena scales the field whole into the middle of whatever stage the game plays on, as bench Pong
  scales its court, so it plays the same in any window. Keep the state in field units too. Never mix in the stage's
  pixels or `useVideoConfig` fractions inside it: a part sized in stage pixels stays big on a small stage and covers
  the rest.
- **The words go in the Arena's parts, never placed by hand.** `score={<Score items={[{ label: "you", value: g.you,
  accent: true }, { label: "house", value: g.house }]} />}` is the top band, a cell per item; `banner={g.phase ===
  "serve" ? <Banner text="space to serve" sub="first to 5" /> : null}` is one message at a time over the field's
  middle, on a plate; `hint={<Hint keys={[{ keys: "↑ ↓", does: "move" }]} />}` is the bottom band. Each has a band of
  its own, so no word lands on another or on the score. Draw no other text over the field.
- **A person plays it.** While someone plays, each frame's input has `live: true` and their keys (`ArrowUp`,
  `ArrowDown`, `w`, `s`, ` `) and pointer: move the player's paddle from them, and let the other side be the
  computer. When no key is down nobody is playing, live or in a render: the step plays itself (below). Never gate that
  on `live`: a game played live sits still until someone presses a key.
- **Renders are landscape**: the composition's size is 1920x1080 at 60 fps unless the request says otherwise, never a
  vertical 9:16 unless asked for. `raea render` and `raea check` use it.
- Write the game as a pure function: `step(state, input, frame) => nextState`. `input` is that frame's
  `{keys: string[], pointer?: {x, y, down}}`, and the step returns a new state object, never a changed old one.
- Read the state at the current frame with `useGameState(initial, step)`. It is `initial` at frame 0, and at frame
  `f` it is `step` applied to each earlier frame in order. Draw the frame from that state.
- Read this frame's input with `useInput()` (`{keys: []}` when there is none), for example to light the keys on screen.
- Cue sound from what happens in the game with `useGameEvents(initial, step, isEvent)`. It runs the same fold to
  the end of the composition and returns, in order, every frame at which `isEvent(before, after)` holds. Each frame
  is the first one that shows the new state. Then place one sound per event:
  `{hits.map((f) => <Sequence from={f} layout="none"><Audio src={thump} /></Sequence>)}`.
- Keep a contact as a flag on the state for the frame it happens on (`paddleContact`, `bricksHit`), so that both the
  step and `isEvent` can read it.
- Frames count from the nearest enclosing Sequence, so a game inside `<Sequence from={60}>` starts at its own
  frame 0 and reads input at the matching composition frames.
- Give the game its input as a script that lives in the file: an `InputTimeline` (`{"<frame>": {"keys": [...]}}`)
  that the step falls back to when the Clock has none, so `raea render` plays it the same way every time.
- Theme the field and the Arena's parts from the brand (`--brand-text`, `--brand-accent`, `--brand-background`) like any
  other piece, each with a fallback colour (`var(--brand-accent, #ff5a36)`): a project with no brand defines none, and
  a bare `var()` draws nothing (an agent's table-tennis game's paddles and net were invisible).
- When an entity has modes (idle, run, jump, hurt; patrol, chase; playing, won, game over), write each as a state
  machine: `machine<Ctx, Env>()({ id, initial, states })` from `raea`, guards polled every frame, delays in
  frames, the snapshot kept in the entity at `sm` and stepped inside the step (`stepAll` for one per enemy). The rules
  and an example are in `bevy/games` ("State machines"); they are the same in 2D.
- For many entities, keep them in an ECS world (`createWorld()` from `raea/ecs`). `spawn`, `set`, `query` and
  `system(fn)` build it, and `world.at(frame)` gives the world after frames 0 to frame-1 have run, the same every
  time it is asked for.

## Build order: render early, keep the scripted run simple

A game that never renders is nothing, so build in this order and render at each step:

1. One `edit.tsx` (and components it imports) with the state, the step and the drawing, rendered with `raea render`
   and looked at (`raea render edit.tsx --at A,B -o stills/`) within your first dozen moves, even if it's only the field and the player moving.
2. Then the rules (collisions, the enemies' machines, win and lose), rendering again after each.
3. **The render's play-through is an autopilot inside the step, not a planner.** When a frame has no keys down
   (live or not), let the step steer the player itself: toward the nearest gem or coin, jump when a gap or an
   enemy is close ahead, a fixed key script by frame, or a mix. A few lines. Never write a search, a route planner or
   a second "mirror" copy of the step to plan the run: the playtest's bots search for a winning run already.
4. **Export `playtest`** from edit.tsx for every game: `initial`, `step` (the same fold), `actions` (the key chords
   a player uses, `[]` included), `observe` (the player's position and what's near, in the units the state keeps),
   `progress` (0 to 1 toward the goal: gems taken over gems needed, distance to the flag over the level's length),
   `outcome` ("won", "lost" or null) and `machines` when it has state machines. A bot then checks the game can be
   won, softlocks nowhere, and reaches every machine state. The import is type-only:
   `import type { Playtest } from "raea"`.
5. **State machines are `machine()` from `raea`**, in 2D as in 3D: read `raea guide bevy/games` ("State
   machines") before writing them. Each entity keeps its snapshot at `sm`, the step calls `m.step(entity, env)`, and
   the playtest's `machines` is `(s) => ({ player: playerM.watch(s.player), ... })`. Your own transition tables or a
   hand-made `{ state, states }` aren't machines to the playtest: its machine checks fail and say so.

## Why

A video frame is a function of its number. `useGameState` folds from the start on every frame, so any frame renders
on its own and the same input always plays the same game, which is what makes a game renderable, checkable and
re-renderable. The fold reuses `initial` each time, so a step that mutates its state corrupts every later frame.

Sound cued from events lands on the frame the thing happens and stays right when the rules change. The approved
Breakout's 31 sounds come from `useGameEvents`, on the same frames that were once placed by hand from a play log.

## Common mistakes

- Mutating the state in `step` (`s.ball.x += s.ball.vx; return s`). Return new objects.
- `Math.random()` in what draws rather than in `step`: it's new every frame, so the thing jumps. In `step` it's seeded
  for that step's frame and repeats on every render and replay; keep what it decides in the state.
- `useState` or `useEffect` to hold the game. Nothing persists between frames; the fold is the state.
- Hand-placing sound frames. Use `useGameEvents`.
- An `isEvent` that holds for several frames in a row (a ball touching the paddle for 3 frames), so one hit gives
  three sounds. Test for the change: `after.contact && !before.contact`.
- A game with no input script, so it sits idle.
- A heavy `step`. It runs about `frame` times per rendered frame, so keep it to arithmetic on plain objects.

## Example: a catch game in an Arena, with input, a score and a sound per point

```tsx
import { Audio, Composition, Sequence, registerRoot, sao, useGameEvents, useGameState, type FrameInput } from "raea";
import { Arena, Banner, Hint, Score } from "raea/arena";
import { css } from "./styles.gen";

// the field's own units: every position below is in these, and the Arena scales them to the stage
const FW = 1600, FH = 900;
const CHIME = sao("bright short arcade coin chime, dry", { seconds: 0.5 });

interface Game { x: number; drop: { x: number; y: number }; score: number; caught: boolean }
const INITIAL: Game = { x: 800, drop: { x: 400, y: 0 }, score: 0, caught: false };

/** One frame of the rules: move the tray, let the drop fall, catch or respawn it. Pure: returns a new state. */
function step(s: Game, input: FrameInput, frame: number): Game {
  const held = (k: string) => input.keys.includes(k);
  // nobody playing: the tray follows the drop by itself, so the stage is never idle
  const dx = input.keys.length ? (held("ArrowRight") ? 16 : 0) - (held("ArrowLeft") ? 16 : 0) : Math.sign(s.drop.x - s.x) * 12;
  const x = Math.min(FW - 120, Math.max(120, s.x + dx));
  const y = s.drop.y + 9;
  const caught = y >= 780 && y < 789 && Math.abs(s.drop.x - x) < 140;
  const respawn = caught || y > FH;
  const nextX = 160 + ((frame * 389) % (FW - 320)); // a seeded column, the same every render
  return { x, drop: respawn ? { x: nextX, y: 0 } : { x: s.drop.x, y }, score: s.score + (caught ? 1 : 0), caught };
}

const isPoint = (before: Game, after: Game) => after.score > before.score;

export default function Catch() {
  const g = useGameState(INITIAL, step);
  const points = useGameEvents(INITIAL, step, isPoint);
  return (
    <Arena width={FW} height={FH}
      score={<Score items={[{ label: "caught", value: g.score, accent: true }]} />}
      banner={g.score === 0 && g.drop.y < 300 ? <Banner text="catch the drops" /> : null}
      hint={<Hint keys={[{ keys: "← →", does: "move the tray" }]} />}>
      <style>{css}</style>
      <div style={{ position: "absolute", left: 0, top: 0, width: FW, height: FH, borderRadius: 24, backgroundColor: "var(--brand-surface, #1b1d24)" }} />
      <div style={{ position: "absolute", left: g.drop.x - 30, top: g.drop.y, width: 60, height: 60, borderRadius: 30, backgroundColor: "var(--brand-accent, #ff5a36)" }} />
      <div style={{ position: "absolute", left: g.x - 120, top: 790, width: 240, height: 36, borderRadius: 18, backgroundColor: "var(--brand-text, #f4efe6)", transform: `scale(${g.caught ? 1.08 : 1})` }} />
      {points.map((p) => (
        <Sequence key={p} from={p} name={`point ${p}`} layout="none">
          <Audio src={CHIME} gainDb={-6} />
        </Sequence>
      ))}
    </Arena>
  );
}

registerRoot(() => <Composition id="catch" component={Catch} width={1920} height={1080} fps={60} durationInFrames={3600} />);
```
