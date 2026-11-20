# The person's fingerprint

A fingerprint is the person's sense of good work, as raea has learned it on their Mac from their notes, marks and
approvals: a list of axes (blur, a black frame, hiss, clipping, a glow over everything, a frozen picture, and taste
axes in their words), each a small model over on-device encoders. You use it to catch what they would catch before
they see it, and you help them teach it. Every command is in [reference/cli.md](reference/cli.md) under
`raea fingerprint`; the long version is raea.io/docs/fingerprint.

Each step says where it runs, as in SKILL.md: **HEADLESS** (the CLI alone), **PAGE** (their feed open), **PERSON**
(only they can do it).

## What it reads

Every axis reads one sense, on this Mac: pictures through SigLIP 2, sound through CLAP and YAMNet, motion from the
frames, and text (scripts, briefs) through EmbeddingGemma 2. Each axis judges a two-second moment, so a file is judged
only on the senses it has, and a whole piece's story or pace isn't judged at all. Picture axes can learn where in the
frame; sound axes judge the whole sound in each moment. raea has no shipped axis for whether a sound is recorded or
generated: never tell the person the fingerprint says a sound is real, or AI-made.

## Before you post a cut — HEADLESS

```sh
raea fingerprint which out/cut.mp4                 # which fingerprint judges this piece, and why
raea fingerprint score out/cut.mp4                 # the moments it expects a note on, first
raea fingerprint score out/v2.mp4 --was out/v1.mp4 # after a fix: each of v1's flags fixed, still there, or disguised
```

- Score every cut before `feed_post` or `raea show`. Fix each moment that holds it back, or tell the person why you
  didn't. Tell them the axis and the moment in their words, never a number.
- A moment on a picture axis may say where in the frame and, on a render with a layer pass (`--layers`), the layers
  there ("top right on Floor"): start the fix with that layer. `--sheet out.png` boxes it on the frames;
  `--timeline` reads the piece second by second.
- After a fix, score it `--was` the cut before. Only **fixed** counts. **Disguised** means the fix hid the defect
  (a sharpen over a blur, a slow zoom over a freeze) instead of removing its cause: fix the cause.
- An axis that **knows** can hold a post back until the person has looked; one that is **learning** only advises.
  `raea fingerprint report` says which is which and what no axis can judge yet (whether a piece works as a whole,
  story and pace across shots). Don't claim the fingerprint passed what it can't judge.
- A script or a brief scores only on axes that read text, and raea's own axes read pictures and sound, so a script
  scores only once the person has added a text axis.
- A 3D shot: render it with `--layers` and `--aov -o out/shot.aov` beside it, run
  `raea fingerprint things out/shot.mp4 --json > things.json`, then `raea check out/shot.mp4 --things things.json`
  for a thing floating or passing through another, the camera lurching mid-move, or an empty frame.
- References the person admires: `raea fingerprint profile REFS... --as NAME`, then `score --profile NAME` says which
  measures fall outside their ranges, where, and which way to move.

## The person's rules

Their standing rules are taste files, nearest first: the project's own `taste.ts`, the workspace's house rules
(`taste.ts` at the workspace's root), then their own (`~/.raea/taste/taste.ts`, and `motion.ts`, `games.ts`,
`sound.ts`, `ui.ts` for each kind of work). A rule may say when it applies and what holds it: a check raea measures, a
script in the project, a fingerprint axis, or nothing but an eye. The file's `about` export keeps these (raea reads
only its default export).

- In the app, `rules_read` lists every rule with the fingerprint that judges the project and its axes, and
  `rule_check out/cut.mp4` holds a file to all of them before `feed_post`: measured rules through
  `raea check --taste`, rules linked to an axis through `raea fingerprint score`, a script by running it, and the
  rest by your own look, which you pass as `verdicts`. Say what broke and where. Headless, run
  `raea check FILE --taste taste.ts` and the score yourself, and look at the rest.
- When the person states a preference for all the work from now, add it with `rule_add` (the project's rules, or the
  workspace's): one plain sentence, why, when it applies, and the axis when one guards against it. It waits in
  Fingerprint › Rules, where they keep, reword, move or drop it (PERSON).
- A rule linked to an axis is only as sure as the axis: one that is **learning** only advises. Linking a rule to an
  axis, or teaching the axis from the notes a rule came from, is the person's (Fingerprint › Rules), not yours.

## Reading their notes

- A note on the picture can carry a mark (a pin, a box, a lasso): fix what's inside it.
- A note on the sound can carry a box drawn on the spectrogram. You read it as "Marked on the sound (box, T0 to T1, LO
  to HI)": a span of time and a band of pitch. The note is about that band in that span (a hiss up high, a hum down
  low), not the whole track: fix it there and leave the rest of the sound alone.
- Notes teach the fingerprint that judged the piece. They become evidence only once the person has checked how they
  were read: `raea fingerprint read PROJECT` reads the pinned notes into kinds and axes (HEADLESS);
  `raea fingerprint readings PROJECT --ask 50` puts them to the person in the app (PERSON); once they agree with 45
  kinds and 40 axes in 50, `raea fingerprint learn-notes PROJECT` makes them evidence. A box's band is kept in the
  label.

## Only when the person asks

These change their fingerprints or commit into their folders. Do each when they ask, not on your own:

| They want to... | Run |
|---|---|
| start a fingerprint, or one for a kind of work that builds on theirs | `raea fingerprint new NAME --about "WHAT IT'S FOR" [--extends me]` |
| teach it from their finished renders | `raea fingerprint bootstrap FILES...` (on-device training; the app's Learn from renders does the same) |
| label a moment, approve a piece, or say one version is better | `teach FILE --axis A --at T --bad`, `approve FILE...`, `pair WORSE BETTER --axis A` |
| keep a fingerprint with a project or workspace, so the team judges with it | `raea fingerprint share NAME --in project PATH` then `raea fingerprint use NAME --in project PATH` (`--in workspace` for all its projects). In the app it's the fingerprint chip beside the project's name: Keep with this project, Keep with the workspace (PERSON) |
| see where two people's tastes differ | `raea fingerprint diff A B` |
| move a lesson from a client's fingerprint up into their own | `raea fingerprint move --fp CHILD --axis A` |
| look back on a finished project | `raea fingerprint postmortem PROJECT` (at most ten yes/no questions in the app, PERSON), then `--tally` |

## Its files

A fingerprint's axes are `~/.raea/fingerprints/NAME/fingerprint.ts`, typed by `raea/fingerprint`
([reference/sdk.md](reference/sdk.md)): add, remove or reword an axis there when the person asks, never its evidence.
Which one judges a piece is decided by where it lives: the project's first, then the workspace's, then the person's
own; at each level the one whose `applies` matches the piece's kind, else that level's default.
