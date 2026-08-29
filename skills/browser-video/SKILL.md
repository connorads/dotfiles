---
name: browser-video
description: >-
  Records demo and verification videos of web pages using playwright-cli's
  screencast, and checks the result by inspecting extracted frames. Use when
  asked to record a video, screen recording, demo, or walkthrough of a web app
  or page; to show a flow working end to end; or to capture visual proof that
  a UI change behaves correctly. Not for making a thumbnail from an existing
  video (video-thumbnails), or for terminal recordings (terminal-control,
  terminal-fabricate).
---

# Browser Video

**You cannot see what you recorded.** Every rule here exists because a script
succeeded and the video was still wrong: the run returned `"done"`, exited 0,
and shipped a take with the click 200px off target and no pointer in frame.
A green run is evidence the script ran, not evidence the video is right.

Assumes `playwright-cli` is on PATH. Begins where its
`references/video-recording.md` ends - that reference has the screencast and
overlay API; this skill has what it takes to get a correct take.

## One take per browser session

Overlays leak. An overlay with `duration: 3400` outlived its duration,
survived `page.goto`, survived `screencast.stop()`, and reappeared in two
later recordings as a stale pill nobody put there. Start every take in a
fresh named session and close it after:

```bash
playwright-cli -s=take1 open https://example.com/
playwright-cli -s=take1 video-show-actions
playwright-cli -s=take1 run-code --filename hero.js
playwright-cli -s=take1 close
```

`page.screencast.hideOverlays()` clears leaked overlays and is worth calling
before `stop()`, but only a fresh session is deterministic.

## Make actions visible

**The screencast records no cursor.** Not the OS pointer, not a synthetic
one - `page.mouse.move()` moves an invisible thing. Run
`video-show-actions` on the session before the scripted run and the recording
gains both an animated pointer and a callout naming each action:

```bash
playwright-cli -s=take1 video-show-actions --duration=600 --position=top-right
```

`--cursor pointer` is the default; `--cursor none` disables the pointer and
keeps the callouts. It annotates `run-code` actions, not just CLI-driven ones,
so it replaces any hand-rolled cursor overlay entirely.

## Work in two phases

1. **Explore with CLI commands.** Drive the real flow with
   `playwright-cli goto/snapshot/click/fill`, recording nothing. This is where
   you learn the locators, what the app actually anchors to, and where the flow
   surprises you. Skipping it means discovering the surprise inside a take.
2. **Script the take with `run-code`.** One file, run once, so pauses and
   pacing are deliberate. Copy `assets/hero-template.js` and adapt it - it
   carries the coordinate mapping, the glide helper, and the chapter brackets.

## Coordinates inside a scaled iframe

`boundingBox()` does not correct for a CSS transform scaling an iframe. It
reported (766, 538) for an element rendering at (442, 350) inside an iframe at
`Fit 55%`; the click landed 200px low and pinned a comment to the wrong thing.
Map through the iframe box instead:

```js
const ib = await page.locator(FRAME).boundingBox();          // iframe in the page
const r = await locator.evaluate(el => {                     // element in the frame
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, vw: innerWidth };
});
const s = ib.width / r.vw;                                   // the real scale
const point = { x: ib.x + r.x * s, y: ib.y + r.y * s };
```

Outside a scaled frame `boundingBox()` is correct and needs none of this. The
tell that you need it: the app renders a page inside a page, or shows a zoom
control such as "Fit 55%".

## Verify before delivering

Extract frames and look at them. This is the only step that has ever caught
any of the above.

```bash
scripts/video.sh probe take.webm                  # duration, size, codec
scripts/video.sh sheet take.webm                  # 6 frames tiled into one PNG
scripts/video.sh sheet take.webm -n 6 --around 5 --window 2   # hunt a short overlay
```

Read the sheet, not the frames one at a time. Check four things:

- the pointer is visible and near what is being clicked
- the intended target was hit, and the app responded to it
- no overlay from an earlier take is on screen
- text is legible at the delivered size

A short annotation can hide entirely between evenly spaced frames; `--around`
with a narrow `--window` is how you confirm a 900ms callout rendered.

Deliver `.mp4` unless asked otherwise - `.webm` will not play in several
places a reviewer might open it:

```bash
scripts/video.sh mp4 take.webm     # H.264, yuv420p, faststart
```

## Record against a disposable fixture

A flow that mutates state burns its target on every take, and you will need
more than one take. Recording a comment flow consumed three real canvases
before a clean run. Create the fixture you can recreate *before* recording -
a fresh account, board, document or seeded row - rather than after the first
take has dirtied the real one. Where the flow is read-only, none of this
applies.

## Craft

For a video a human watches, as opposed to a verification artefact:

- Type with `pressSequentially(text, { delay: 55 })`. Instant fills read as a
  glitch; 50-60ms reads as a person.
- Move with `page.mouse.move(x, y, { steps: 28 })`, then wait ~500ms before
  clicking. The settle pause is what makes the action legible.
- Bracket sections with `page.screencast.showChapter(title, { description,
  duration: 2400 })`. Open on one, close on one.
- Highlight the outcome with `showOverlay` for ~3s at the end, so the viewer
  knows which part was the point.
- Aim for 20-40s. Under 20s a viewer misses the setup; over 40s they scrub.

## Boundaries

- `playwright-cli` - the screencast, overlay and chapter API itself.
- `video-thumbnails` - a still image composed from a video that already exists.
- `terminal-control`, `terminal-fabricate` - recordings of a terminal, not a
  browser.
- `prove-it` - whether evidence supports a claim; this skill is how the
  evidence gets captured.

`tests/video.bats` covers `scripts/video.sh`'s CLI contract; run it after
changing the script. `evals/` holds this skill's own test prompts and rubric;
neither is part of the procedure.
