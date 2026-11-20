# npm packages and React apps in a composition
<!-- sources: io/npm/src -->

What works today. The "not yet" list is the gaps: when one is built, delete its line here.

This page covers an app inside a composition. An app that is its own program, a window on the web target (Blitz) or
the native one (Rune) chosen by `export const app = { target }`, is `raea app run|check|bundle`: see the raea skill's
"Apps: web or native", and `sdk/rune/examples/` for two that pass the check on both targets.

- Packages: `raea add @assistant-ui/react` writes `package.json` and `raea.lock` and lays out `node_modules`. raea's own package
  manager does it; no Node, npm or bun is needed, and install scripts never run.
- A React library that needs a real DOM (assistant-ui, Radix, shadcn) runs as an app: a module whose default export is
  a component taking `{ width, height }`, running on react-dom in a document of its own (@raea/ui's, on a Blitz page:
  what raea feed runs on), with the CSS its modules import and Tailwind's for its folder. Place it:
  - on a screen in 3D: `<Screen name="chat" app="chat.tsx" resolution={[480, 640]} crt={false} />` (beside the 3D, or
    as a Model's `screens` entry). The path is relative to the composition's folder;
  - as an app panel or tool: `export const surface = "dom"` in the panel's file.
- Input in live play: the pointer reaches an app screen through the 3D (where it lands on the picture). Pressing on the
  screen gives it the keys, and the game gets none until a press elsewhere or Escape.
- Renders: an app screen is stepped once a frame on the frame clock (its timers and `performance.now` follow the frame),
  so a render repeats frame for frame. A render of a play's input log (`render --input`) gives it what reached it in
  the play, so the render draws what was played.
- Exported games: `export-game` bundles each app with its packages (`chat.tsx.surface.js` and `.surface.css`), and the
  player draws it on its own Blitz page.

Not yet:
- An app as a flat 2D layer of a composition. It can be a 3D `<Screen>` or an app panel only; for a flat look, put a
  `crt={false}` screen square to the camera.
- A composition itself importing a DOM library. Only an app (above) can; the composition's own React is raea's lite
  runtime.
- `Date` in an app screen: it reads the wall clock, so a render shows another time than its play. Use timers or
  `performance.now`.
- A drag that leaves an app screen: it ends at the edge (a browser's goes on). A double click on one.
- The page host's desktop calls in an app screen (the clipboard, links, notifications).
- Anything in front of a screen blocking its clicks: the ray hits the nearest screen, through other objects. It also
  assumes the 3D fills the stage.
- Network calls in an app during a render: nothing records and replays them, so a render that calls a model doesn't
  repeat. Keep renders offline.
- Packages that need Node (`fs`, `child_process`, native addons, postinstall steps), and `git:`, `file:` and `link:`
  dependencies. Browser-only packages work.
- A package's own `.css` imports and Tailwind inside an app are untested; style with style objects until they are.
