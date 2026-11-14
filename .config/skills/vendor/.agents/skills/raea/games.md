# Games and interactive

Pieces a person plays: a composition that reads input and keeps state, drawn in 2D or by Bevy in 3D, played live in
the raea app and rendered to video from the same file. The files under `motion/`, `3d/` and `craft/` are copies of
raea's craft guides (`raea guide NAME` prints the same text).

## Which file to open

| You are... | Open |
|---|---|
| a 2D game: `useInput`, `useGameState`, `useGameEvents`, the build order, a scripted run | [motion/games.md](motion/games.md) |
| a 3D game: state, input, many entities, collisions, state machines | [3d/games.md](3d/games.md), after [3d.md](3d.md) |
| physics (bodies, joints) through a Bevy plugin | [3d/plugins.md](3d/plugins.md) |
| what a game has to do for the people playing it | [craft/modes/play.md](craft/modes/play.md) |
| its sound | [sound.md](sound.md) |
| a game made from shipped game assets (models, kits) | [3d/assets.md](3d/assets.md) |

## The verbs

- `raea play EDIT.tsx` (HEADLESS with `--offscreen`): the game live. `--input-script KEYS.json` plays it from a
  script, `--snapshot T FILE` writes a frame at T seconds, `--json FILE` its report (how fast it opened and ran).
- `raea render EDIT.tsx --input I.json` renders a played run to video, the same frames as the play.
- `raea physics bake|goo|part` bakes what `<Physics>` and `<Goo>` need.
- `raea export-game EDIT.tsx -o OUT --target mac-app|mac-cli` makes the game a program of its own: a Mac app or a
  command, to hand to someone who doesn't have raea.

## Checks

A game is done when `raea play --offscreen` runs its scripted input with no error and its snapshots show what the
script did ([motion/games.md](motion/games.md), "Build order"); render-equals-play rules are in
[3d/limits.md](3d/limits.md).
