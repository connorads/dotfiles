# Apps

An application's interface written as a React file on @raea/ui, run in its own window (web: Blitz on Bevy; native:
Rune), checked headless and bundled as a Mac app. A composition or a game stays a composition; an app is an
interface someone uses. SKILL.md's "Apps: web or native" is the full guide; the files under `motion/` are copies of
raea's craft guides (`raea guide NAME` prints the same text).

## Which file to open

| You are... | Open |
|---|---|
| what an interface has to do for the people using it | [craft/modes/tool.md](craft/modes/tool.md) (read it first) |
| building it: the task first, every state as real UI, roles and labels, steps that walk it, the check | [motion/interface.md](motion/interface.md) |
| choosing web or native, the verbs, the check, host calls, Rune's props | [SKILL.md](SKILL.md) ("Apps: web or native") |
| npm packages and React components inside a composition (not an app) | [motion/apps.md](motion/apps.md) |
| layout and type in the interface | [motion/layout.md](motion/layout.md), [craft/verbs/layout.md](craft/verbs/layout.md), [craft/verbs/typeset.md](craft/verbs/typeset.md) |
| the brand's colours and type | [motion/brand.md](motion/brand.md) |
| making it work at every size, or faster | [craft/verbs/adapt.md](craft/verbs/adapt.md), [craft/verbs/optimize.md](craft/verbs/optimize.md) |

## The verbs

- `raea app run APP.tsx` opens it; `raea app check APP.tsx --png out/` runs it headless with its steps and writes a PNG
  per step and tree.json; `raea app bundle APP.tsx -o Name.app` makes a Mac app (HEADLESS).
- `raea add PKG` adds an npm package to the project (raea.lock).

## Checks

`raea app check` on every target the app should run on, with steps that reach every state, then read each PNG and
tree.json ([motion/interface.md](motion/interface.md)).
