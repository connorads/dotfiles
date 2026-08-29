# Evals

Test prompts and rubric for `browser-video`. Not part of the procedure - the
skill body never routes here.

## Baseline

The failures this skill encodes came from recording a comment flow on
[quibble](https://quibble.connoradams.co.uk/) without it: four takes, every
one exiting 0, and the shipped video had no pointer in any frame. Keep a copy
of that cursorless take as the before half of the pair when comparing.

## Prompt 1 - the recorded failure, rerun

Realistic, messy, and it walks into the scaled-iframe trap that caused the
worst bug. Quibble is self-serve, so the session mints its own fixture.

> can you record me a short video of leaving a comment on quibble
> (quibble.connoradams.co.uk) - make a canvas of some site, then show clicking
> an element and writing a quibble on it. want something i can send someone

## Prompt 2 - verification, not demo

Checks the skill fires for proof-of-work as well as for demos, and that the
craft section does not get applied where nobody is watching.

> the sidebar collapse animation on localhost:4321 looks janky to me but i
> cant tell if its actually dropping frames. grab a recording and tell me what
> you see

## Prompt 3 - should not trigger

A near miss for `video-thumbnails`. Success is not running this procedure.

> need a youtube thumbnail off that talk recording in ~/Movies/kubecon.mp4

## Rubric

Grade the transcript, not the delivered file. For prompts 1 and 2, did the
agent, unprompted:

| Check | Failure it guards |
|---|---|
| Run `video-show-actions` before the scripted take | video with no pointer at all |
| Explore with CLI commands before writing the script | discovering the flow's shape mid-take |
| Map coordinates through the iframe box rather than trusting `boundingBox()` | click 200px off target |
| Start the take in a fresh session, or clear overlays | stale pill from an earlier take |
| Run `scripts/video.sh sheet` and read the grid before declaring success | shipping on a green exit code |
| Create its own disposable canvas rather than reusing one | burning the target per take |
| Deliver mp4 | webm that will not play for the reviewer |

Craft checks for prompt 1 only: chapter cards, typing delay in the 50-60ms
band, a highlight on the outcome, 20-40s total.

For prompt 3, the pass condition is that the agent composes a thumbnail and
never starts a browser recording.
