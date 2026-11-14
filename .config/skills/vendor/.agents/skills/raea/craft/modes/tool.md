# Mode: tool

App screens, panels, editors, dashboards: pieces whose job is that someone gets their task done without thinking
about the screen.

## It works when

The person finishes what they came to do, knows what happened, and never wondered where something was.

## What to make

- **The task first.** The screen opens on what the person is most likely here to do, with the next step in plain
  view. Everything else waits a click away.
- **Controls people already know.** Standard controls, standard places, standard keys. The look shows in the details:
  type, spacing, one accent used for meaning.
- **Every state.** Empty, loading, one item, many, an error, no permission, a very long name. Design each one; an
  empty screen is an invitation to start, not a blank.
- **Quiet by default.** One accent colour for what can be acted on or what changed. Motion only to show where
  something came from or went.
- **Real content.** Lay it out with real names, real lengths and real numbers, never placeholder text.
- **Built for real.** A screen for a raea app is built in the app itself, never mocked up as a picture.

## The decisions

- **The task.** Decide what the person came to do, and the two or three steps that do it. The first screen opens on
  that task. The easy default is an overview dashboard, which makes everyone hunt for the task.
- **Density.** Design for the person who uses it most. Someone who uses it all day wants more on screen and keyboard
  shortcuts. Someone who opens it once a month wants less, with labels.
- **Where things live.** Follow the platform's conventions for menus, settings, shortcuts and Undo. The easy default
  is a custom layout, and it costs every user a moment of looking.
- **What's in view and what's a click away.** Keep the task's next step in view. Put settings and rarely used
  actions behind a click.
- **How an action answers.** Every action shows that it happened, at the place where it happened. A toast in a far
  corner is easy to miss.
- **The target.** Choose web or native for the app (`motion/interface`).

## The rut

Cards in cards. A dashboard of numbers nobody asked for. Icons with no labels. Every element given the same weight.

## How it fails

| What you see | Why | What to change |
|---|---|---|
| people ask "where is…" | the action is buried in a menu, shown only as an icon, or out of view | put the task's next step in view, with words |
| people don't know whether it worked | the action gives no answer where it happened | show the change in place |
| an error leaves them stuck | it says what happened, but not what to do next | say what to do, and clear the error once they act |
| it breaks with real data | a long name overflows, an empty list is blank, 500 rows are slow | design every state with real content (`harden`) |
| it looks busy | everything has the same weight, with cards inside cards | one accent, one level of container, and the rest quieter (`quieter`, `layout`) |
| keyboard or screen reader can't use it | controls have no role or label in tree.json | real buttons with words in them, and `role` and `aria-label` where there's no button |

## Check

- Do the task yourself, start to finish, at the size it ships.
- Find the state nobody designed.
- `raea app check APP --png out/` with steps that walk every state, read PNG by PNG (`motion/interface`).
