---
name: raea
description: Make video, motion graphics, games and 3D scenes with raea, the Render Anything Engine, by writing React/TypeScript compositions with raea and rendering them on the GPU with the raea CLI (or playing games live). Use when the user names raea, or wants 3D scenes (Bevy materials, lights, physics, Gaussian splats), 3D placed into footage (matchmove), a playable game, footage cut by its words, cuts timed to a song's beat map, or foley and instruments made locally on the Mac. Also for writing or fixing 3D TSX (Camera3d, Mesh3d, lights, materials, glTF models, post effects, an ECS world), a 3D render or play that looks wrong, extending raea's Bevy SDK, rendered video, captions and motion graphics from code, and frames rendered headlessly.
metadata:
  raea-tested-against: 0.1.0-rc1
  raea-verbs: render play run check init cut song guide skill skills app controller workspace project spec doctor next library setup gen context brand scene splat blender
---

# raea

raea renders compositions written in TypeScript and React with a GPU engine built on Bevy. A composition is a function
of the frame: give it frame N and it draws frame N. The same file renders to video, plays live as a game, or renders
single frames to check.

Each step below says where it runs. **HEADLESS**: the `raea` CLI alone, in any shell. **HOST**: needs the raea app
running on this machine (its host answers). **PAGE**: needs the person's feed open in the app. **PERSON**: only the
person can do it. Every PAGE step says what a headless agent does instead.

## 1. Install (on hold)

<!-- LOCAL PATCH (connorads dotfiles): raea is on hold until its attested releases are verified here; agents must not install it. -->

raea is not installed on this machine. Do not install it. Do not run the `raea.io` installers (`curl … | sh` or
`irm … | iex`), `raea skills install`, `cargo build`, `cargo install` or `mise use` for raea. If the user asks for raea
work, tell them it is on hold and why.

Why: the hold was set at `v0.1.0-canary.2` (2026-11-05), whose release binaries were built on the maintainer's
machine with no build provenance. From `v0.1.0` (2026-11-09), GitHub Actions builds the release assets and attests
them. Nobody has verified those attestations here yet.

Before you lift the hold:

1. Verify the release tarball: `gh attestation verify <tarball> -R shinyobjectz/raea` must pass.
2. Pin the version in mise as `"github:shinyobjectz/raea" = "<version>"`. Do not use the official installer or
   `raea skills install`. They copy this skill into agent folders and add hooks and MCP servers, outside the reviewed
   catalogue.
3. Run the first render with network access blocked.
4. Remove the `raea-install-hold` and `raea-tripo-cli-hold` skill patches.

## Reference

Generated from the code by `tools/skills.sh gen`, so they're current. Read the one you need instead of guessing a flag:
- [reference/cli.md](reference/cli.md): every `raea` verb, its flags and where it runs (`raea help` prints the same).
- [reference/feed.md](reference/feed.md): the raea app's tools for an agent it launches, and which need its page.
- [reference/files.md](reference/files.md): a workspace's and a project's files, what lives in `~/.raea`, and each
  spec's fields (brief.ts, NAME.script.ts, taste.ts, plan.ts, controllers/ID.ts).
- [reference/sdk.md](reference/sdk.md): what each `raea` import gives a composition.
- [reference/app.md](reference/app.md): driving the raea app's window over MCP, as a person would (HOST).
- [reference/platforms.md](reference/platforms.md): each network the app publishes to: shapes, lengths, file and
  caption limits, and where its interface covers the frame.

## The guides, by what you're making

raea's craft guides travel with this skill: each file under `motion/`, `3d/` and `craft/` is a copy of the guide
`raea guide NAME` prints, so either works. Open the router for what you're making; it says which one or two files the
task needs.

| Making... | Open |
|---|---|
| a cut of real footage: takes cut by words, faces framed, captions, cuts to a song | [footage.md](footage.md) |
| motion graphics and type: cards, stats, logos, end cards | [graphics.md](graphics.md) |
| sound: voice, beds, foley, music for picture, the mix | [sound.md](sound.md) |
| a 3D scene: lights, materials, models, people, rooms, splats | [3d.md](3d.md) |
| a game, 2D or 3D | [games.md](games.md) |
| an app's interface (web or native) | [apps.md](apps.md) |
| generated images, video, sound or meshes | [gen.md](gen.md) |
| the export, the share copy, platform specs, posting a deliverable | [delivery.md](delivery.md) |
| working with the person in the raea app: the feed, controllers, the editor, boards | [collaborate.md](collaborate.md) |

Across all of them, `craft/`: [craft/ROUTER.md](craft/ROUTER.md) is how to decide what to make (the order of work and
reading notes); [craft/floor.md](craft/floor.md) is read right before every edit; `craft/modes/` says what a pitch,
an explain, a story, a game or a tool has to do; `craft/verbs/` has one file per move a note asks for;
[craft/rubric.md](craft/rubric.md) is how a critique is judged and ranked.

## 2. The workspace and its projects — HEADLESS
<!-- sources: apps/workspace/src -->

Work lives in a workspace: a git repo under raea.root (`~/Studio` unless `git config --global raea.root` says
otherwise), one per studio or client, holding projects and controllers. In the raea app a project shows as a channel.
- `raea workspace init NAME` makes one; `raea workspace adopt DIR` makes an existing folder one. `raea workspace`
  shows it (`--json` for the projects and their paths).
- `raea project new NAME` adds a project: its folder with `brief.ts`, `media/`, `out/` and `brand/`. A project can
  live inline or as its own repo (`raea project split NAME`, `raea project join NAME`); both keep its history.
- Work in the project's folder. Footage and other media go in `media/`, renders in `out/`.

## 3. Read before you make — HEADLESS
<!-- sources: engine/cli/src/guide.rs apps/workspace/src core/brief/src -->

- `raea context .` in the project prints everything to read first, in order: the person's taste
  (`~/.raea/taste/taste.ts`; a line there beats any guide's default), the workspace's taste, the brief, the look, the
  workspace's controllers, the craft floor and each of the brief's modes' guides. Read all of it.
- Run it once a session. If it refuses, say so in one line ("raea context failed: its message; reading the brief and
  controllers directly") and read `brief.ts`, any `*.script.ts`, `~/.raea/taste/taste.ts` and `raea controller ls`
  yourself. A `CONTEXT_STALE` line means `raea doctor` finds files from another version: run `raea doctor --fix`.
- With no request in hand, `raea next` lists the two or three useful next steps from the brief, the compositions,
  the renders and their checks. Offer them; never run one unasked.
- The controllers (`raea controller ls`, `raea controller get PATH`) are the workspace's settings and workflows:
  delivery specs, who reviews what, the tools every agent gets. Work to them. Change one only when the person asks:
  `raea controller set PATH VALUE` (each change is a commit).
- A controller is not a feed item. A feed item is one piece of work (a render, a still, a question): the person
  reviews it once and a note on it is answered by its next version. A controller is a standing decision every agent
  reads before it starts, so changing it changes all the work after. If the person would say it again on the next
  piece ("always 9:16", "Grade checks every cut"), it belongs in a controller; if it's about this piece only, it's a
  note. When the work needs such a decision from the person, put the controller in front of them with the feed's
  `controller_post` (its id, the fields as group.field, a line on what you need decided) rather than asking in prose;
  a controller you make with `controller_write` reaches their feed on its own. Fields are typed (toggle, choice,
  number, text, list, agents, channels, workflow, servers, skills; reference/files.md), so put what they'll adjust in
  fields, one controller per concern.
- If the brief isn't shaped (no `believe`, no `mode`), shape it before making anything: ask who it's for and the one
  thing they should believe, or write your best guess and add its field to the brief's `assumed` list.
- For a pitch, an explain or a story, plan first: write the deliverable's storyboard as `NAME.script.ts` beside the
  brief (`export default script({...})` from "raea/brief": scenes of beats, what's on screen and what each scene must
  land; its fields are in reference/files.md), name it on the deliverable, and add a task "storyboard approved" tagged `gate`. `raea spec NAME.script.ts`
  checks it. Render nothing until the person approves it (PERSON).
- The person's footage and files: `raea library search "WORDS"` finds them by meaning across the libraries they've
  indexed (HEADLESS once indexed; adding a folder waits for the person's yes, PERSON).
- Right before any edit to a composition, even a one-line change, read the floor: `raea guide craft`. Read
  `raea guide router` once for the order of work.

## 4. Make an item — HEADLESS
<!-- sources: sdk/raea/src/index.tsx sdk/raea/src/3d.tsx -->

One `.tsx` file whose root registers compositions (`raea init` in a footage project writes the files to start from):

```tsx
import { AbsoluteFill, Composition, Sequence, interpolate, registerRoot, useCurrentFrame } from "raea";

function Card({ text }: { text: string }) {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#000", color: "#fff", justifyContent: "center", alignItems: "center", fontSize: 96 }}><span style={{ opacity }}>{text}</span></AbsoluteFill>;
}

registerRoot(() => (
  <Composition id="piece" width={1080} height={1920} fps={30} durationInFrames={90} component={() => (
    <><Sequence from={0} durationInFrames={45}><Card text="One" /></Sequence><Sequence from={45} durationInFrames={45}><Card text="Two" /></Sequence></>
  )} />
));
```

Rules that keep renders right (`raea guide motion` has all ten, under "The core rules"; every file needs these):
- **Frame-pure.** Everything that moves reads `useCurrentFrame()`; `useState`, `useEffect` and timers don't animate a
  render. `Math.random()` is seeded per frame, so seed what should hold still from an index.
- **Clamp every interpolate.** Do it unless you mean the line to run on past its ends.
- **Cue on words, not on guessed frames.** `word("phrase")` is the frame where it's said, so cues follow the cut.
- Footage: `<Video>` and `<Audio>`. Games: `useGameState(initial, step)` with a pure `step`, keys from `useInput()`.
- Brand: the kit's `--brand-*` variables in `brand/brand.css` (`raea brand DOMAIN` reads them from a site), then
  `import { css } from "./styles.gen"` and Tailwind classes like `bg-brand-bg`.
- 3D: read [3d.md](3d.md) first; it routes to one file per topic in `3d/`. An asset to fix first (scale, pivot, FBX
  to .glb) goes through Blender (`raea setup blender`, then [3d/blender.md](3d/blender.md)).
- Sound: `raea guide sound` and `raea guide music`; to cut to a song, run `raea song FILE --plot FILE.song.png` and
  time cuts from its map, never a constant BPM. npm packages and React apps: `raea guide apps`.
- Generated media: `raea guide gen` before the first `raea gen`.

`raea check --quick piece.tsx` checks three stills' text (clipped, cramped, safe areas) in about a second: run it
after each save when no hook does. Then render, and look before you call it done:

```sh
raea render piece.tsx --at 0,45,89 -o frames/                 # stills to look at: text fits, nothing overlaps
raea render piece.tsx --alpha -o frames/                     # transparent PNGs, for an overlay in another editor
raea render piece.tsx -o out/piece.mp4 --manifest out/render.json
raea check out/piece.mp4 --manifest out/render.json --taste ~/.raea/taste/taste.ts -o out/piece.check.json   # P0-P3; exits 1 on a P0 or P1
```

`raea guide rendering` covers stills, the check, bitrate and quality; `raea guide rubric` covers judging the rest.

## 5. Show it and read the notes — PAGE, PERSON
<!-- sources: skills/skills/raea/reference/feed.md -->

- In the raea app, post the render to the project's feed with `feed_post` (a watch, look, listen or play item); the
  person watches, plays and leaves notes on it there (PERSON). `feed_items` reads the items and their notes.
- Headless instead: leave the file in the project's `out/`, give the person its path, and take their notes as text.
- Every note, from the feed or as text, gets a move before any edit: pick the one it asks for (quieter, bolder,
  distill, clarify, retime, recut, regrade, remix, harden, layout, typeset, animate, delight, adapt, optimize, extract,
  generate, polish, critique) on the part or moment it names, and read it (`craft/verbs/MOVE.md`, or `raea guide MOVE`)
  before you touch the composition. Answer in their words, and never name the move to them.

## 6. The next version — HEADLESS, then PAGE
<!-- sources: skills/skills/raea/reference/feed.md -->

- Change the composition under the person's hand edits (the `edit` segments and `<Nudge>` props the app writes; see
  `raea guide rendering`), render again and check again.
- Render each version to a new file beside the old (`piece-v2.mp4`), never over it: the earlier version stays
  watchable. In the app, post it with `feed_post` naming the item it `replaces`, so the feed keeps both as versions.

## 7. Deliver — HEADLESS
<!-- sources: runtime/export/src -->

- Final exports: `--quality master` for motion graphics and type; name files with lowercase letters, digits and
  hyphens only (`spring-launch-9x16.mp4`).
- A render is a standard MP4 but large: H.264 High and AAC on a Mac (VideoToolbox), H.264 Constrained Baseline and
  Opus on Windows and Linux (openh264), yuv420p on all. Hand over a share copy too, which any player takes:
  `ffmpeg -i film.mp4 -c:v libx264 -preset slow -crf 23 -maxrate 2600k -bufsize 5200k -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart film-share.mp4`.
- Deliver to the controllers' specs (sizes, platforms, loudness) when the workspace sets them; each network's shapes,
  lengths and UI zones are in [reference/platforms.md](reference/platforms.md), and [delivery.md](delivery.md) routes
  the rest (one composition per shape, cutdowns, tags, handing over).

## Apps: web or native — HEADLESS
<!-- sources: docs/targets.feature apps/targets/src sdk/ui/src/app.ts sdk/rune/src -->

An app is a React file with a default export: DOM elements, inline `style` or Tailwind `className`, on @raea/ui. One
setting picks the host that draws it. Both are desktop windows that draw every pixel themselves (neither uses the
OS's widgets or a browser), with the same kind of text and layout engines. **web** (the default) is Blitz on Bevy: a
browser engine, so all of CSS (grid included), web npm UI packages and the 3D world. **native** is Rune, an app UI
framework: springs on every change, GPU effects and kit components, a screen-reader tree (AccessKit), a ~27 MB host
against web's ~175 MB, a subset of CSS (no grid) and no 3D yet. The SDK is the same; only the setting differs. Pick
native for a small, motion-heavy app with no 3D that passes its check; anything else stays on web. A composition or a
game stays a composition; an app is an application's interface.

- Say the target in the app's own file, as a literal (anything else is refused at its line):
  `export const app = { target: "native", title: "Notes", size: [480, 640], minSize: [360, 480] };`. With no
  `app` export, or no `target` in it, the target is `"web"`. `--target web|native` on the command line overrides it.
- The verbs, the same on both targets: `raea app run app.tsx` opens it in a window; `raea app check app.tsx` runs it
  headless; `raea app bundle app.tsx -o Notes.app` makes a Mac app. `raea app bundle` signs ad hoc unless you give
  `--identity "Developer ID Application: ..."` (or RAEA_SIGN_IDENTITY) and `--notarize PROFILE` (a notarytool
  keychain profile): it always signs with your own identity, never raea's.
- Check before you show it. Give the app its input as `export const steps = [{ press: "add" }, { type: "Ada", into: "name" }, { key: "Tab" }, { wheel: "list", dy: 120 }, { frames: 30 }];`
  (elements by `data-testid`), or as `--script steps.json`. `raea app check app.tsx --png out/` writes a PNG after
  the mount and after each step (00-mount.png, 01-press-add.png, ...) and tree.json (each element's role, label,
  text and box). Read the PNGs. Check on both targets when the app should run on both: `--target web` and
  `--target native`.
- What the check holds each target to. **native** fails on any prop Rune doesn't map or call its host doesn't
  answer, naming each with its element's path (unmapped.json, unanswered.json). Change the prop, or keep the app on
  web. **web** passes when it draws, and says what native wouldn't draw and which Rune props it ignores.
- Native draws flex layout (no grid), sizes, padding, margin, gap, absolute insets, scroll, colours and gradients,
  borders, radius, shadows and rings, outlines, opacity, transforms and transitions, text, images and video, fonts
  from the app's folder, and Tailwind's classes with hover:, focus:, focus-visible:, active:, disabled:, dark: and
  sm: to 2xl:. Anything else is reported, never dropped. An empty unmapped.json means the page maps whole.
- What only Rune does is typed props from `@raea/rune`:
  `<div {...rune({ motion: "pop", transition: { effect: { push: "top" }, enter: "pop" } })}>`, plus `lead`,
  `instant`, `blur`, `backdropBlur` and `glass`, and its `Badge`, `Spinner`, `Progress`, `RollingText` and
  `Switch`. On web, a preset motion becomes a CSS transition and an entrance a keyframe, blur and glass become filters,
  and the rest is ignored and listed by the check. Without these props an element lands at once, as in a browser.
- Part of a web page can be Rune's: `<RuneLayer className="w-80 h-48">...</RuneLayer>` from `@raea/rune` draws its
  children with Rune, on the GPU, in its box, and the rest of the page stays Blitz's. Give it a size: the layer is
  its content box. Clicks and wheel reach its elements, and their handlers run as anywhere else. A
  `getBoundingClientRect` inside one is zero, and keys don't reach a field in one yet. In a browser it's a plain
  div. `RAEA_RUNE_LAYERS=0` draws it with Blitz.
- Host calls (`call` and `callSync` from `@raea/ui/wire`), answered on both targets: `net.fetch`, `net.ws.*`,
  `net.storage.*`, `net.clipboard.*`, `os.open` (http, https, mailto), `fs.pick`, `fs.save`, `fs.read`, `fs.write`
  and `dialog.message`. Headless, a step answers a dialog: `{ pick: ["a.txt"] }`, `{ save: "out.txt" }`,
  `{ dialog: 0 }`. `world.*` (BRP on the 3D world) is web's only: native refuses it with "no world on the native
  target".
- Examples ship with raea and pass the check on both targets: `sdk/rune/examples/signin.tsx` (Tailwind only) and
  `sdk/rune/examples/motion.tsx` (Rune's props). On a native app, `raea app check --video out/app.mp4 [--audio
  music.wav]` films it on the virtual clock at 60 fps, with a cursor gliding to each element it presses. The same app
  and steps give the same frames.

## Go further

- The guides: the routers above, or `raea guide` (it lists them; `raea guide NAME` prints one, the same text as the copy here).
- The SDK's behaviour: `sdk/raea/spec/motion.feature`; what 3D reaches: `raea guide coverage`.
