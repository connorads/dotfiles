# Match cuts on the thirds

A cut lands well when the eye is already where the next shot needs it. Plan a piece's cuts as a chain: each shot
takes the eye in at a place on the frame's thirds, on a thing (a hook), and its action carries the eye to the place
the next cut leaves from. The next shot picks the eye up there, on something of the same shape, moving the same way,
or simply in the same place on a beat. Read this while you write the storyboard (`NAME.script.ts`), before anything
is built: the chain decides what each shot shows and where.

## The kit

Copy the skill's `craft/match-cuts/` into the project's `checks/match-cuts/`, as you copy a note's worked checks.
It is plain TypeScript with nothing to install:

- `chain.ts`: the thirds, glyphs and hooks, `chain()`, the plan checks, and `toFrame` and `onFrame` (where a point
  in the world falls on the frame, and where to put a part so it falls on a hook's place).
- `plan.ts`: `bun checks/match-cuts/plan.ts NAME.chain.ts [--only lands,glyph]` runs the plan checks by name.
- `thirds.ts`: `landsOnThirds(chain)`, the render check.
- `board.tsx`: `<Board chain places />`, the chain and a library of places drawn for the person to pick from.

The chain lives in `NAME.chain.ts` beside the storyboard. (`cuts.ts` is something else: the footage edit `raea cut`
writes.)

## The frame's places

- **Nine points:** the four thirds crossings `TL TR BL BR`, the middles of the thirds lines `TC ML MR BC`, and the
  centre `CC`.
- **Four lines:** `H1` and `H2` across (the upper and lower thirds), `V1` and `V2` down (left and right). A horizon,
  a water line, a table's edge or a doorframe is a line hook. A point on a line lands on that line.
- **FULL:** a thing that fills the lens. A screen pushed into, a sheet thrown over the camera, a car's flank passing
  it, a hand covering it. FULL only lands on FULL, and it carries any cut: it's the one hook that hides the change.

## Choosing hooks

A hook is what the eye is on at the cut: `{ what, at, glyph, part?, move?, colour?, light? }`. Pick each one by
what the eye will actually lock onto in that frame, which is usually the brightest, most contrasting, moving or
nearest thing. Five things make two hooks the same thing across a cut:

- **Shape** (`glyph`): `circle` (a sun, a wheel, a clock, a cup from above), `rect` (a screen, a window, a door),
  `hline` (a horizon, a water line), `vline` and `diag` (a pole, a stair rail), `vanish` (a corridor's vanishing
  point), and `blob`, `streaks` and `dots` (cloth, rain, sparks), which read as one family.
- **Motion direction** (`move`): `left right up down in out cw ccw`. A pan right cut to a train moving right holds
  through any change of shape.
- **Colour:** a red light cut to a red coat. Put it in `colour` and keep it as strong on both sides.
- **Light:** a lamp switched off cut to a sunrise in the same place, a flash cut to a flash. Put it in `light`.
- **Sound:** the cut is carried by the ear, not the eye (a J or L bridge, below).

Name the part that draws the hook (`part`, its name in the scene, or a text's words). The render check measures it,
and a hook with no part can't be checked.

## The action carries the eye

Each shot's `carry` says what moves the eye from its in place to its out place: the cursor's drag, the camera's
move, a light's sweep, a thrown object, a character walking. A shot whose in and out places differ needs one, or
the eye has to jump. Keep the camera moving through the cut (`raea guide story`), and let the move end where the next
hook is. A shot can also hold the eye where it came in (in and out at one place) and change only what's there.

Plan where the eye travels over the whole piece. A chain that sits on `CC` from start to end is a slideshow with
good registration. Move the eye with intent: One film's montage hands a circle from the lower-left third through the
centre to the upper right, where the sun is waiting for the last shot.

## The joins, and how each is checked

Each shot says how it is cut into (`cut`, graphic when unset). The plan checks (`bun plan.ts`) hold the chain
before anything is built; the render check (`thirds.ts`) holds the composition to it.

| Join | When | The plan holds | The render holds |
|---|---|---|---|
| `graphic` | two things of one shape in one place: the sun to a dryer's window | `lands`, `glyph` | each hook's part at its place on the frames either side |
| `motion` | movement continues: a pan right to a cyclist riding right | `lands`, `motion` (both hooks' `move` the same) | the parts at their places |
| `eye` | anything in the same place, on a beat: the eye is there when the cut comes | `lands`, `beats` (the chain must have them) | the parts at their places |
| `full` | a wipe: something fills the lens and the next shot starts filled | `lands` (FULL to FULL) | the part covers 90% of the frame (`values.full`) |
| `sound` | the picture moves on and a sound carries the cut | `bridge` | the J sound starts `seconds` before the cut, the L sound runs on past it |
| `hard` | the place breaks on purpose (below) | `hard` (says what it lands on) | the cut is on the chain's frame; its hooks aren't measured |

Three patterns run across several cuts:

- **A montage's hand-off:** three or more shots (`montage: true`) handing one hook on, cut to cut, often a beat
  each. `montage` holds that every hook in the run is the same family and no hard cut breaks it. Let the hook travel:
  each shot's out a step on from its in.
- **J and L bridges:** a `bridge: { kind, sound, seconds }` on the shot cut into. J: the next shot's sound starts
  under the end of this one (a train's horn before we see the platform). L: this shot's sound runs on into the next
  (a door slam heard over the street outside). Any join can carry one; a `sound` join must. The bridge's `sound` is
  how the check finds the audio: its name, or the start of its file's name (`brakes` for `media/brakes.wav`).
- **A loop:** `loop: true` when the piece plays again (a social loop, a title card, a game's attract mode). The last
  shot's out matches the first shot's in by the first shot's join, and the render check measures both on the piece's
  last and first frames.

And, whatever the joins: `length` (the chain runs the piece to a frame), `hooks` (every hook says what, where and
its glyph), `carry` (above) and, cut to music, `beats` (every picture cut within a frame of a beat; give the chain
the grid you cut to, halves too if you cut on them).

## When a hard cut beats a match

A match says "this is connected". When the point is that it isn't, cut hard, and land it on something: a hit, a
downbeat, a word, the first frame of a new act.

- **A shock or a reveal:** a quiet room, then the alarm.
- **A jump in time or place that should be felt:** the match would smooth over what the viewer needs to notice.
- **The rhythm needs a break:** after a run of matches, one hard cut resets the eye and makes the next match land.
- **Comedy:** the cut is the joke (cut from "nothing could go wrong" to everything going wrong).

Keep them few. In a minute-long piece, two or three hard cuts against a dozen matches; every one says `on`.

## By mode

- **Story:** the chain is the camera map's backbone. Plan the poster frame first and walk the chain back from it.
- **Pitch:** land the proof where the problem was. The pain at `MR`, then the product solving it at `MR`, reads
  as an answer before a word is said. Keep the hook inside the safe areas: a hook under the platform's buttons is lost.
- **Explain:** the cursor is the hook. The button it presses at `BR` cuts to the result appearing at `BR`; a zoom
  into a panel is a FULL. Each scene moves the project forward, and the eye goes where the next step happens.

## Planning a chain

1. With music, map the song first (`raea song FILE --plot`) and put its beats in the chain.
2. List the places and each place's hooks (a `Place`: what is there, at which thirds place). A long list gives the
   chain room: one film drew from fifty.
3. Chain them: for each cut pick the join, then the hooks that make it. Write `carry` for every shot that moves the
   eye. Write the storyboard's `cut` field to match ("match cut on the circle, upper right").
4. `bun checks/match-cuts/plan.ts NAME.chain.ts` until every check passes.
5. Show the person the board: a `board.tsx` of three lines, `raea show board.tsx`. Their picks and notes come back.
6. Build each shot as its Sequence from `sequences(chain)`, and place hooked parts with `onFrame(...centreOf(at),
   depth, camera, aspect)`. The check reads each shot's first and last frames, so run a shot's progress from 0 to 1
   over `frames - 1`. Where one part is the hook at both ends of a shot, place it for the in hook and aim the shot's
   last camera with `slideTo(camera, at, part, aspect)`, the camera moved so the part falls on the out place. Name
   parts as the hooks do, each with a name no other part's starts with: a hook's `part` finds every name that begins
   with it and takes the nearest, so `door` would also find `doorway`.
7. Hold the composition to the chain with a rule: a file of your own makes the check, and the rule names it. A pass
   prints only `0 errors`, so see it fail once: move one hook's `at` in the chain, run it, and it names that hook.

```ts
// film.chain.ts
import { chain } from "./checks/match-cuts/chain";
export default chain({ fps: 30, length: 12, beats: [0, 0.5, 1 /* ... */], loop: true, shots: [
  { name: "kitchen", scene: "kitchen", seconds: 2, in: { what: "the kettle's lid", at: "CC", glyph: "circle", part: "lid" },
    out: { what: "the steam", at: "TR", glyph: "streaks", part: "steam" }, carry: "the steam rises to the upper right" },
  { name: "window", scene: "window", seconds: 2, cut: "graphic", in: { what: "rain on the glass", at: "TR", glyph: "streaks", part: "rain" },
    out: { what: "the tram", at: "MR", glyph: "rect", part: "tram", move: "right" }, carry: "a drop runs down the glass onto the tram" },
  // ...
] });

// checks/film-cuts.ts: the render check, made from the chain
import { landsOnThirds } from "./match-cuts/thirds";
import film from "../film.chain";
export default landsOnThirds(film);

// controllers/rules.ts: the project's controller, holding the rule; its check is a path from this file (a note's ask
// names the same file in its `check`)
import { controller } from "raea/brief";
export default controller({ title: "Rules", groups: [{ title: "The cuts", fields: [
  { label: "the cuts land on the thirds", type: "rule", check: "../checks/film-cuts.ts", values: { tolerance: 0.06 } },
] }] });
```

`raea check film.tsx --only film-cuts` runs it: a rule goes by its check file's name, and a note's ask by its own id
(`--only n1.1`). It reads the frames' facts, so it needs no render, and it only reads the frames either side of each
cut.

## What the render check can't see

- **A part hidden behind another.** It measures where things are, not what is drawn on top. Look at the cut frames.
- **A camera rolled about its view.** It takes Y as up, as Bevy's `looking_at` does. A camera aimed with a rotation
  is measured; one tilted sideways is not.
- **The eye's way inside a shot.** Only the cut frames are measured; `carry` is the plan's.
- **A hook made of many parts.** A ring of candles or a spray of sparks is measured by its one part nearest the
  place. Name the part that leads the eye.
- **A hook's size.** It measures where a hook is, not how big. Keep sizes close across a cut by hand (below).
- **A 2D graphic that isn't text.** raea world has no box for one. Hook a text by its words, or a part in the 3D.

## Common mistakes

- A hook the eye won't find: a small dark circle while a bright window fills the corner. Pick the thing that wins
  the frame, or make it win (light it, move it).
- Every cut on `CC`. It registers, and the piece goes flat. Move the eye.
- Matching shape but not scale: a sun the size of a coin cut to a dryer window filling a third of the frame reads as
  a jump. Keep a hook's size close across the cut, or make the change of size the move (a push).
- A FULL cut where the thing never fills the frame: 70% covered leaves the old shot showing at the edges.
- A match on a cut that should be hard, smoothing over the moment the viewer needed to notice.
- A chain written after the shots: then it describes whatever happened. Write it first and build to it.
