---
name: hyperframes-cli
description: The HyperFrames CLI by job - scaffold, check, look at frames, edit the timeline, preview, render locally or in the cloud, publish, project history - plus reading its JSON and recovering from build or render failures.
---

<!-- LOCAL PATCH (connorads dotfiles): reviewed vendoring, managed tools and explicit reporting consent. -->

Use the managed installed CLI and provision missing tools through the local tool workflow. Do not bootstrap executables, install or refresh skills, or upgrade packages during video work. Preserve telemetry opt-outs. Feedback, catalogue-gap reports, ratings, host-app reports and public reproduction uploads require an explicit user request for each report. Publishing or uploading project content requires explicit user authorisation. Never run harness usage probes or add telemetry-only provider tags.

# HyperFrames CLI

Run `hyperframes <command>` unless the project gives a wrapper; then use the wrapper. It needs Node.js 22+ and FFmpeg. Every command has `--help`; most take `--json`, and a failure prints `✗ …`, a `Fix:` line and exits non-zero.

## Commands by job

| Job | Commands |
| --- | --- |
| Start | `init <dir>` (blank; `--example <name>` only when asked), `capture <url>` |
| Read a project | `info`, `compositions`, `timeline --json`, `docs <topic>` |
| Check it | `lint` while writing; `check --json` as the gate (lint, runtime, layout, contrast) |
| Look at it | `snapshot` (`--at <t,…>`, `--range START,END`, `--composition <id>`, `--zoom`, `--angle`, `--against <video>`), `keyframes`, `compare`, `audio` |
| Edit the timeline | `timeline` with `move`, `trim`, `split`, `set`, `duplicate`, `delete`, `apply`, `undo`, `ids` |
| Reuse | `catalog`, `add` (`/hyperframes-registry`) |
| Media and sound | `media-treatment`, `grade-compare`, `remove-background`, `tts`, `transcribe`, `beats`, `normalize-audio` (`/media-use`) |
| Show and ship | `preview`, `present` (`/slideshow`), `render`, `publish`, `cloud`, `lambda`, `cloudrun` |
| Desktop app | `open`, `catch-up` |
| Upkeep | `doctor`, `browser`, `clean`, `feedback` |

`validate`, `inspect` and `layout` are deprecated aliases of `check`; `events` is telemetry for skills' own scripts. Don't run them.

## The loop

1. Write, then `hyperframes lint` after the first pass and after structural changes.
2. `hyperframes check --json` and fix every error. While a lint error remains the layout and contrast audits don't run; "0 samples" means nothing was checked. Contrast failures carry a `suggestedColor`. A finding at a single sample (an entrance in flight) is info; a 3 s+ video with no visible change fails `sweep_static`.
3. `hyperframes snapshot` and read the PNGs (under `.hyperframes/artifacts/snapshots/`): that is how you see the video. With sub-compositions, snapshot a midpoint of every scene; tiny unstyled content or a missing hero is a mount defect (`../hyperframes/references/format.md`).
4. `hyperframes preview --background`, check the URL answers 200, give the person the project URL and wait, unless they asked for the file or for no stops. Passing checks alone is not a reason to render.
5. When it is time to render (step 4): `hyperframes render --quality looks --output out.mp4` (`draft` while iterating, `delivery` for the final). Confirm the file is non-empty and its `ffprobe` duration matches the root `data-duration`, then look at decoded frames.

"This element" or the current selection: `hyperframes preview --context --json --context-fields selection`; `no-selection` means ask them to click it.

## Edit the timeline

These are the edits Studio itself makes, so the result stays in Studio's shape.

- `timeline --json` lists clips with absolute `absStart`/`absEnd`, owning `file` and the `#id` ref the edit commands take (`timeline ids` stamps missing ids).
- `timeline move|trim|split|set|duplicate|delete <ref> … --plan --json` previews one edit; run it again without `--plan`. `--start`, `--end`, `--duration` set one edge or the length.
- An edit is refused when the clip would overlap a neighbour (`--overwrite`, or move the neighbour first) or end past its composition: raise the root's `data-duration` first. No command changes `data-duration`.
- Several edits at once: a JSON file such as `[{"verb": "move", "ref": "#outro", "time": "9"}]`, then `timeline apply plan.json --json`. Each run prints a `receipt`; save it and `timeline undo receipt.json` reverts it.

<!-- history (trial): remove this block together with the command -->

## Project history

Every write is kept and can be undone. At the start of a turn, `hyperframes history begin --who <you> --label "<plan>"`, then `history --since mine --who <you>` to see what the person changed; build on their edits. A check failed or they say it got worse: `history undo --who <you>`, never hand-edit back. End the turn with `history end`.

<!-- /history (trial) -->

## Render where

| Need | Command |
| --- | --- |
| Local | `render --quality looks --output out.mp4` (`draft`, `delivery`) |
| Reproducible container | `render --docker --strict --output out.mp4` |
| Batch from variables | `render --batch rows.json --output "renders/{name}.mp4"` |
| Hosted, no local Chrome or FFmpeg | `cloud render` (`references/cloud.md`) |
| Your own AWS or GCP | `lambda render`, `cloudrun render` (`references/lambda.md`, `references/cloudrun.md`) |

A 30 s film renders in a minute or two: run it in the foreground. Detach only a render longer than your tool's timeout (`HYPERFRAMES_RENDER_DETACHED=1`, its own group, output to a log) and wait with `until grep -qE 'Render (complete|failed)' render.log; do sleep 5; done`, never `pgrep -f`, which matches its own loop and waits until the tool times out.

Send feedback only when the user explicitly asks for that report. If telemetry is disabled or the user opted out, do not send it. Search results, a completed render and tool warnings are not requests to send feedback. Read `references/feedback.md` only after that request.

## When a command fails

| Symptom | Fix |
| --- | --- |
| Chrome missing or won't start | `hyperframes browser ensure`; `doctor --json` always exits 0, gate on `.ok` |
| A heavy page isn't ready in time | Raise `--timeout` on `check` or `snapshot` |
| Unusual codec looks blank | Keep `--proxy` on (the default) |
| Render slow on Linux | The summary's second line says `screenshot` + `software gpu`: the slow path |
| `capture` fails or writes `BLOCKED.md` | Take nothing from its partial files; retry into a new `-o` folder |
| Disk tight | `clean --dry-run`, then `clean`; never delete `.hyperframes` (it holds history) |

## References

Read the row before running its command.

| Commands | Read |
| --- | --- |
| `init`, `capture`, `skills` | `references/init-and-scaffold.md` |
| `lint`, `check`, motion sidecars, `snapshot` | `references/lint-validate-inspect.md` |
| `compare`, `grade-compare`, `render --batch` | `references/compare-and-batch.md` |
| `beats` | `references/beats.md` |
| `preview`, `play`, `render`, `publish`, Studio context | `references/preview-render.md` |
| `doctor`, `browser` | `references/doctor-browser.md` |
| `auth`, `cloud`, template variables | `references/cloud.md` |
| `lambda`, `cloudrun` | `references/lambda.md`, `references/cloudrun.md` |
| `info`, `upgrade`, `compositions`, `timeline`, `docs`, `usage`, telemetry | `references/upgrade-info-misc.md` |
| `--strict` flags, run ids, `clean`, shader lint, JSON paths | `references/conventions.md` |
| `keyframes` | `../hyperframes/references/motion.md` (Seeing motion) |
