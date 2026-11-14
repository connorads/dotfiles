# Mode: play

Games and playable scenes: pieces whose job is that someone wants another go.

## It works when

A new player understands what to do within two seconds of looking, their first input does something they can see
and hear, and when it ends they press to play again.

## What to make

- **It plays live.** A game always runs live on the stage, never as a video in its place. If it's too slow, fix the
  cost, not the liveness.
- **Readable in two seconds.** The player, the goal and the danger read at a glance: by shape and contrast first,
  colour second. One look should tell you what you are.
- **The first input answers.** The first key or touch moves something, with a sound. A screen that ignores the
  player loses them.
- **Feel before features.** Get the core move right (its speed, weight, sound, and the frame it lands on) before
  adding a second one.
- **Clear failure, quick restart.** The player sees why they lost and is playing again in a moment.
- **Deterministic.** State lives in `useGameState` with a pure step, so a logged play renders back to the same pixels.

## The decisions

- **The core move and its numbers.** Set the speed, the acceleration, how long a jump hangs and the frame where it
  lands. The easy default is whatever the physics gives you. Tune the numbers by hand while you play.
- **What the camera shows.** Show what the player needs to see coming. The easy default is a fixed camera centred
  on the player, which hides the danger on a fast run toward the edge of the screen.
- **The first minute.** Let the first obstacle teach the move. The easy default is a line of instructions.
- **The run and the restart.** Decide how long a run lasts and how quickly the player is back in after losing. Both
  should be short enough that one more go is easy to say yes to.
- **Sound.** Give every input and every outcome a sound (`games`). Silence after a jump reads as a missed jump.
- **What is random.** Seed it from the game's state, so a logged play renders back the same.

## The rut

A title screen before anything happens. Controls explained in text instead of taught by the first obstacle. A score
that means nothing.

## How it fails

| What you see | Why | What to change |
|---|---|---|
| new players stand still | the goal or the player doesn't stand out | separate them by shape and contrast first, then by colour |
| the controls feel floaty or stiff | the feel numbers were never tuned: slow acceleration, no landing frame | tune them live, one at a time |
| deaths feel unfair | the cause wasn't visible: a hitbox bigger than the sprite, danger off screen | make hitboxes match the drawing, and show danger before it arrives |
| a replay doesn't match the play | some state lives outside `useGameState`: `Math.random()`, the clock, a ref | move it into the step, seeded from state (`harden`) |
| it stutters live | the frame costs too much | reduce the cost (`optimize`). Never swap in a video |

## Check

- Playtest it live, with real input, not from a rendered video.
- Harden the edges: two keys at once, holding a key, losing focus, the very first frame and the last.
