---
name: media-use
description: Get or make any media for a HyperFrames video - music, sound effects, images, icons, logos, voiceover, avatar and generated video, transcripts, cutouts, colour grades and looks - with HeyGen or free local tools, and mix placed audio. Also for footage that looks dark, flat or dull, or should be stylized or hidden.
---

<!-- LOCAL PATCH (connorads dotfiles): reviewed vendoring, managed tools and explicit reporting consent. -->

Use the managed installed CLI and provision missing tools through the local tool workflow. Do not bootstrap executables, install or refresh skills, or upgrade packages during video work. Preserve telemetry opt-outs. Feedback, catalogue-gap reports, ratings, host-app reports and public reproduction uploads require an explicit user request for each report. Publishing or uploading project content requires explicit user authorisation. Never run harness usage probes or add telemetry-only provider tags.

# Media in HyperFrames

Media lands as a local file in the project's `assets/` with a ledger record; renders never fetch. One verb finds or makes it:

```bash
hyperframes media-use resolve --type <type> --intent "<what you need>" --project <dir>
```

It prints one line, `resolved <id> → <path> (<type>, <metadata>)`. List reusable assets first with `--candidates` and judge the fit yourself; reuse, ingest (`--from`) and adopt are in `references/resolve.md`.

## Where it comes from

| Need | Free | HyperFrames credits | Local or the person's own key (only when they ask) |
| --- | --- | --- | --- |
| Music (`bgm`) | HeyGen catalog of 10k+ tracks (signed in) | Generated track | Local MusicGen |
| Sound effects (`sfx`) | HeyGen (signed in); Openverse (credit CC BY); bundled | | |
| Images, icons | HeyGen asset search, 75k+ (signed in) | Generated images | Local FLUX (mflux), if installed |
| Logos (`logo`) | theSVG, GitHub avatar, favicon; never redrawn | | |
| Voiceover (`voice`) | Voice Turbo, Free plan: 3 min a month | Voice Turbo on a paid plan, other HeyGen voices, cloning | `hyperframes tts` (Kokoro on device) |
| A presenter speaking | | Avatar video (`--type video`) | Local LTX for generic clips, if installed |
| Transcripts | `hyperframes transcribe` (Parakeet or whisper) | | |
| Cutouts | | Video: `--type cutout` | `hyperframes remove-background` |
| Grades, LUTs, looks | `hyperframes media-treatment` | | |

**Sign in.** When a request needs a HeyGen model or the catalog, run `hyperframes auth status` first. If not signed in, report the missing auth and offer the choice between signing in (`hyperframes auth login`) or using an installed local/free path; wait for the user's choice.

**Host apps.** Inside an app with its own media tools, use those first. When `HEYGEN_API_BASE` is set, the host pays: don't ask for a sign-in; relay a refused call's message as written and stop.

**HeyGen.** `hyperframes media-use generate` makes images, shots, talking photos, voices and music using configured HyperFrames auth. Helpers and direct recipes use the managed installed `heygen` CLI; if it is missing, report the prerequisite and wait for the user to install it. Direct `heygen` recipes bill that CLI's own login: use them only when that payer is selected.

**Credits and cost consent.** Confirm before making paid generation calls that the user did not explicitly request, and share `--plan` cost/credit estimates when they affect the user's decision. Honour any credit limit recorded in `.hyperframes/credit-limit.json` (`--max-credits` only tightens). If a step exceeds the limit or a call is refused, explain why and ask the user how to proceed.

## Looks on real footage

Feedback that footage is dark, flat or dull, should feel retro or printed, needs a face hidden, or needs a reveal is media intent. Inspect the real `<img>`/`<video>`, pick one intent, and follow `references/media-treatments.md`; persist with `hyperframes media-treatment`, never a CSS, SVG or `.cube` stand-in.

## Offer once, never add silently

Scan a piece you build or review once for concrete gaps (on-screen text with no voiceover, emoji standing in for icons, placeholder images, silent cuts, 10 s+ with no music, a colour cast) and offer the fixes in one ask. No signal, no suggestion; respect "leave it".

## Where to look

| Task | Read |
| --- | --- |
| Resolve, reuse, adopt, ingest, flags | `references/resolve.md` |
| Grading, LUTs, `grade-compare` | `references/grading.md` |
| Voiceover, music, sound effects, captions, transcription | `references/audio.md` |
| Cut, reframe or transform media; direct `heygen` recipes | `references/operations.md` |
| Treatments, realtime effects, overlays, reveals | `references/media-treatments.md` |
| Install, sign-in, credentials, `--provider`, `--local-only`, RAM ladders | `references/setup-providers.md` |
| `media-use generate`, HeyGen transcription, prices | `references/heygen.md` |
| Fades, gain, ducking, automation, effects, buses on placed tracks | `references/mixing.md` |
| Local commands: grade, cutout, loudness, beats | `references/local.md` |
| Remembered preferences | `references/memory.md` |
