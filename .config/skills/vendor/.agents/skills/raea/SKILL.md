---
name: raea
description: Make video, motion graphics, games and 3D scenes with raea, the Render Anything Engine, by writing React/TypeScript compositions with raea and rendering them on the GPU with the raea CLI (or playing games live). Use when the user wants an agent to produce a rendered video or animation from code, cut footage by its words, add captions or motion graphics, build a small playable game, or render frames headlessly.
---

# raea

raea renders compositions written in TypeScript and React (`raea`) with a GPU engine built on Bevy. A
composition is a function of the frame: give it frame N and it draws frame N. The same file renders to video, plays
live as a game, or renders single frames for checking.

## Set up (on hold)

<!-- LOCAL PATCH (connorads dotfiles): raea is on hold until its releases are built in CI with provenance; agents must not install it. -->

raea is not installed on this machine. Do not install it. Do not run the `raea.io` installer, `cargo build`,
`cargo install` or `mise use` for raea. If the user asks for raea work, tell them it is on hold and why.

Why: the release binaries (reviewed at `v0.1.0-canary.2`, 2026-11-05) are built on the maintainer's machine, not in
CI. They have ad-hoc code signatures, no notarisation and no build provenance attestation. The published SHA-256 only
proves that the download equals the upload. Static checks found nothing malicious, but nothing ties the binary to the
public source.

Before you lift the hold:

1. Confirm that GitHub Actions builds the release assets and attests them:
   `gh attestation verify <tarball> -R shinyobjectz/raea` must pass.
2. Pin the version in mise as `"github:shinyobjectz/raea" = "<version>"`. Do not use the official installer. It
   copies skills into `~/.claude/skills`, outside the reviewed catalogue.
3. Run the first render with network access blocked.
4. Remove the `raea-install-hold` and `raea-bevy-install-hold` skill patches.

## Before working on a project

Run `raea context PROJECT` (a project folder with `brief.brief`, or a `.brief` file) and read all of it first. It
prints the person's taste (`~/.raea/taste/`; a line there beats any guide's default), the brief, the look, the craft
floor and the guide for each of the brief's modes. If it says the brief isn't shaped (no `believe`, no `mode`), shape
it before making anything: ask who it's for and the one thing they should believe, or write your best guess with
`(assumed)` after it and go on.

For a pitch, an explain or a story, plan before you make: write the deliverable's storyboard as `name.board` beside
the brief (a table: scene · on screen · narration · payoff), name it on the deliverable's line, and add a
`- [ ] … storyboard approved #gate` task. Render nothing until the person approves it.

When the person leaves a note, read it as one move (quieter, bolder, distill, clarify, retime, recut, regrade, remix,
harden, polish, critique) on the part or moment it names, and read that move's playbook first: `raea guide quieter`.
Answer in their words; never name the move to them.

Right before any edit to a composition, even a one-line change, read the floor again: `raea guide craft`. For the
order of work (shape, storyboard, direction, floor, evidence) and how to read the person's notes, read
`raea guide router` once.

## Write a composition

One `.tsx` file whose root registers compositions (for a footage edit, `raea init` in its folder writes the files it
starts from: edit.tsx over cuts.ts, components/, styles.gen.ts and AGENTS.md):

```tsx
import { AbsoluteFill, Composition, Sequence, interpolate, registerRoot, useCurrentFrame } from "raea";

function Card({ text }: { text: string }) {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#000", color: "#fff", justifyContent: "center", alignItems: "center", fontSize: 96 }}>
      <span style={{ opacity: interpolate(f, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{text}</span>
    </AbsoluteFill>
  );
}

function Piece() {
  return (
    <>
      <Sequence from={0} durationInFrames={45}><Card text="One" /></Sequence>
      <Sequence from={45} durationInFrames={45}><Card text="Two" /></Sequence>
    </>
  );
}

registerRoot(() => <Composition id="piece" component={Piece} width={1080} height={1920} fps={30} durationInFrames={90} />);
```

Rules that keep renders right (`raea guide motion` has all ten, under "The core rules"; these are the ones every
file needs):
- **Frame-pure.** Everything that moves reads `useCurrentFrame()`; `useState`, `useEffect` and timers don't animate a
  render. `Math.random()` is seeded for each frame (new numbers every frame, the same on every render), so seed what
  should hold still from an index; `Date` is the frame's time.
- **Clamp every interpolate.** Pass `{extrapolateLeft: "clamp", extrapolateRight: "clamp"}` unless you mean the line
  to run on past its ends.
- **Cue on words, not on guessed frames.** `word("phrase")` returns the frame where the phrase is said (`raea render`
  passes the cut's words.json), so cues follow the words if the cut moves.
- Footage: `<Video src=...>` and `<Audio src=...>`.
- Games: keep state in `useGameState(initial, step)`, where `step(state, input, frame)` is pure; read keys with
  `useInput()`. The game plays live and renders from a logged play to the same pixels.
- Brand and Tailwind: put the kit's `--brand-*` variables in `brand/brand.css`, `import { css } from "./styles.gen"`
  and render `<style>{css}</style>` once. `raea render` (and `play`, `bundle`) writes `styles.gen.ts` beside
  the composition from brand.css and the Tailwind classes your files use (`bg-brand-bg`, `text-brand-accent`,
  `font-brand`, plus all of Tailwind's own).
- Fonts: a face this Mac doesn't have goes in `media/fonts/`, declared with `@font-face { font-family: "Sohne";
  font-weight: 600; src: url("/media/fonts/Sohne-600.woff2"); }` (in brand.css or a `<style>`; `staticFile("fonts/...")`
  gives the same path). woff2, woff, ttf and otf load; a `data:` URL works too. Google Fonts families load by name.
- Counters: `<Animate enter={tick({ to: 9130, separator: true, prefix: "$", suffix: "\u00a0pts" })} at={30} />` is
  hidden until its `at`. In JSX, `\u` escapes work only inside braces: `unit={"\u00a0pts"}`, never `unit="\u00a0pts"`.
- 3D: Bevy's names (Camera3d, Mesh3d, StandardMaterial, the lights) from `raea/camera`, `raea/mesh`, `raea/pbr`, `raea/light`, or `raea/prelude`. Read the raea-bevy skill (`sdk/skills/raea-bevy/SKILL.md`) first;
  its "modules, in the order a frame is made" maps every Bevy-named module (sources, evaluate, compose, render, output).
- 3D in footage (matchmove): `raea track clip.mp4 --subject X,Y,W,H` solves the clip's camera once (COLMAP,
  kept in the asset store; check the APPLIED line's registered frames and error, and its notes for a rotation-only
  fallback). Then `<Matchmove src={staticFile("clip.mp4")} subject={[x, y, w, h]} crop={0.4}>` with 3D children draws
  the footage, follows its camera and keeps the subject in front. Its world is metres, ground at y = 0, frame 0 looking
  down -Z; `crop` places a 9:16 window on 16:9 footage.
- Sound: music in Tone.js (`import * as Tone from "raea/tone"`): instruments in a `Tone.Sampler` playing a
  `Part` or `Sequence`, their notes from `Tone.tokensynth("a warm upright bass", ["C2", "C3", "C4"])` (TokenSynth, on
  this Mac) or from an open sample library (`raea sounds`); foley with `sao("prompt", { seconds })` in an
  `<Audio>` (Stable Audio Open, on this Mac); narration with `fish("words")`. One `<Mix lufs={-14} />` masters it.
  Both local models install themselves on first use. No generated images or video.
- Music-led pieces: before cutting anything to a song, run `raea song FILE --plot FILE.song.png` and look at
  the plot. Time every cut, slam and move from the map's beats, downbeats and events (`useSong`, `song(map).cutsAt()`),
  never from a constant BPM: a tempo times bar count drifts off the real beats within a minute, and it can't see a
  build, a stop or a drop.
- Music SOP: a library instrument first; a TokenSynth instrument is curated, not trusted (several seeds a root, roots
  3-4 semitones apart, `tools/tokensynth/curate.py` picks the clean takes); under a voice, write a sparse drone score,
  not genre pastiche. Read `raea guide music` ("Instruments from TokenSynth", "Writing music for picture")
  before scoring anything. A drum kit from `raea sounds kick` / `hihat` / `rimshot` goes on `Tone.buses.music`
  (what `sounds get` prints for drums); `Tone.buses.sfx` is for hits on the picture.

## npm packages and React libraries

What works today. The "not yet" list is the gaps: when one is built, delete its line here.

- Packages: `raea add @assistant-ui/react` (also `add PKG@RANGE`, `--dev`, `remove NAME`, `install`,
  `install --offline`, `--in DIR`) writes `package.json` and `raea.lock` and lays out `node_modules`. raea's own package
  manager does it; no Node, npm or bun is needed, and install scripts never run.
- A React library that needs a real DOM (assistant-ui, Radix, shadcn) runs as an app: a module whose default export is
  a component taking `{ width, height }`, running on real react-dom in a document of its own. Place it:
  - on a screen in 3D: `<Screen name="chat" app="chat.tsx" resolution={[480, 640]} crt={false} />` (beside the 3D, or
    as a Model's `screens` entry). The path is relative to the composition's folder;
  - as an app panel or tool: `export const surface = "dom"` in the panel's file.
- Input in live play: the pointer reaches an app screen through the 3D (where it lands on the picture). Pressing on the
  screen gives it the keys, and the game gets none until a press elsewhere or Escape.
- Renders: an app runs on the frame clock (timers, `Date`, `performance.now`, `requestAnimationFrame` follow the frame),
  so a render repeats frame for frame.
- Exported games: `export-game` bundles each app with its packages. The player must be built with them:
  `cargo build --profile game -p raea-app-game --bin raea-game --features player,surfaces` (+6.7 MB); export refuses
  an app screen with a player built without.

Not yet:
- An app as a flat 2D layer of a composition. It can be a 3D `<Screen>` or an app panel only; for a flat look, put a
  `crt={false}` screen square to the camera.
- A composition itself importing a DOM library. Only an app (above) can; the composition's own React is raea's lite
  runtime.
- Input to an app in a render: `render --input` replays the page's input, but an app screen gets none. Script what it
  should show inside the app, on its own timers.
- Anything in front of a screen blocking its clicks: the ray hits the nearest screen, through other objects. It also
  assumes the 3D fills the stage.
- Network calls in an app during a render: nothing records and replays them, so a render that calls a model doesn't
  repeat. Keep renders offline.
- Packages that need Node (`fs`, `child_process`, native addons, postinstall steps), and `git:`, `file:` and `link:`
  dependencies. Browser-only packages work.
- A package's own `.css` imports and Tailwind inside an app are untested; style with style objects until they are.

## Render and check

```sh
raea render piece.tsx -o piece.mp4                 # the whole composition
raea render piece.tsx --frame 60 -o frame60.png    # one frame, to look at
raea render piece.tsx --at 0,45,89 -o frames/      # a few frames
raea render piece.tsx --quality master -o piece.mp4  # a final export: constant quality
raea play game.tsx --input                          # play a game live
```

A video's bitrate follows its size and frame rate (about 20 Mbit/s at 1080p30, 80 at 4K30; VideoToolbox spends less on
flat pictures), and `--kbps N` sets it. `--quality draft|high|master` (or 0..1: 0.6, 0.85, 0.95) asks for constant
quality instead, each frame getting the bits it needs: `master` keeps thin type and hard vector edges clean at 4K
(about 31 Mbit/s on flat motion graphics), so a final motion-graphics export needs no PNG folder through x264.

Sound from the command line, through the same cache the composition's render uses (run them in the composition's
folder, or pass `--dir`):

```sh
raea sao "deep punchy impact hit, tight" --seconds 1.2 -o hit.wav     # foley (Stable Audio Open)
raea tokensynth "a soft wooden marimba" --notes C3,C4,C5 -o marimba/   # an instrument's notes (TokenSynth)
raea sounds piano                                                       # open sample libraries
raea sounds get salamander/piano --notes C3,C4,C5                       # into media/sounds/, with its Sampler
raea setup-audio                                                        # install both local models now
raea song song.wav --plot song.song.png                                 # the song's energy map (song.song.json)
```

`song` runs `raea-perceive` (installed beside raea in `~/.raea/bin`; from a checkout, `cargo build --release
-p raea-perceive`, or set `RAEA_PERCEIVE`) and its beat model, which the install ships.

To cut to a song, map it first: `raea song` finds beats, bars, sections (the file's `[Section]` lyrics markers
when it has them), builds, drops, stops (the beat dropping out, with its hits), hits and dips, and a cut rate per
section. Look at the plot, then pace with it: `import map from "./song.song.json"`, `useSong(map)` for the frame's
beat, energy, section, `inBuild`/`buildProgress` and `untilDrop`, and `song(map, { fps }).cutsAt()` for the frames to
cut on. Hold through low sections, cut faster through a build, smash-cut on the drop, cut on a stop's hits.

Look at the frames you rendered before you call the work done: check text fits, nothing overlaps, and cues land
where the transcript says. Then measure the export against the floor:

```sh
raea render piece.tsx -o piece.mp4 --manifest render.json
raea check piece.mp4 --manifest render.json --words words.json [--platform tiktok|reels|shorts] [--taste ~/.raea/taste] [-o check.json]
```

It ranks what it finds P0 to P3 (clipped text, text under a platform's buttons, captions too brief to read, caption
contrast, frozen stretches, cues off their words, loudness, blotching in the darks) and exits 1 while a P0 or P1
stands. `--taste` adds the person's own mechanical rules, the `## Checks` lines of their taste briefs (`- text-above
54%: Text sits well clear of the bottom of the frame.`), each a P1 when broken. Fix those before anyone sees it. To judge the rest (the open, the point, the pacing, the sound), read
`raea guide rubric`: it lists the questions a critique asks for each mode and how answers become ranks. Blotching in
dark areas is the encoder, not the composition: export dark material as PNG frames (`RAEA_READBACK=rgba raea render
piece.tsx -o frames/`) and encode them with more bits for the darks.

A person's hand edit in the raea app comes back as props, so keep them when you revise: `<Composition ... edit={{ segments:
[[0, 412], [430, 3285]] }}>` plays those frame ranges of the composition one after another (a trim, a split, a cut
word), and `<Nudge x={0} y={-156}>` around an element moves it by those px. Edit the composition under them; change
the segments only when the cut itself should change.

## Deliver

- Name exported files with lowercase letters, digits and hyphens only (`tag-adnanna.mp4`): no `@`, `#`, spaces or
  other sigils. Messages, mail and some uploaders refuse or mangle names with them.
- A render is already a standard file (H.264 High, yuv420p, AAC). It is large, though (its bitrate: see Render and
  check), so hand over a share copy as well, small enough to text:
  `ffmpeg -i film.mp4 -c:v libx264 -preset slow -crf 23 -maxrate 2600k -bufsize 5200k -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart film-share.mp4`
  (about 1 MB for every 4 seconds).

## Go further

Paths here are relative to the root of the raea repository.

- Writing guides (pacing, captions, layout, sound, games, 3D): `raea guide` lists them and
  `raea guide NAME` prints one (`motion` first, then `animating`, `layout`, `brand`, `music`, `sound` and the
  rest; `bevy` and `bevy/NAME` for 3D). They ship with the install; in the repository they're under `sdk/guides/craft`.
- The SDK's behaviour: `sdk/raea/spec/motion.feature`; what 3D reaches: `sdk/raea/docs/bevy-coverage.md`.
