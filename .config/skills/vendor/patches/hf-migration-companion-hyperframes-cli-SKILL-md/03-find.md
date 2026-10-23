## The loop

1. Write, then `npx hyperframes lint` after the first pass and after structural changes.
2. `npx hyperframes check --json` and fix every error. While a lint error remains the layout and contrast audits don't run; "0 samples" means nothing was checked. Contrast failures carry a `suggestedColor`. A finding at a single sample (an entrance in flight) is info; a 3 s+ video with no visible change fails `sweep_static`.
3. `npx hyperframes snapshot` and read the PNGs (under `.hyperframes/artifacts/snapshots/`): that is how you see the video. With sub-compositions, snapshot a midpoint of every scene; tiny unstyled content or a missing hero is a mount defect (`../hyperframes/references/format.md`).
4. `npx hyperframes preview --background`, check the URL answers 200, give the person the project URL and wait, unless they asked for the file or for no stops. Passing checks alone is not a reason to render.
5. When it is time to render (step 4): `npx hyperframes render --quality looks --output out.mp4` (`draft` while iterating, `delivery` for the final). Confirm the file is non-empty and its `ffprobe` duration matches the root `data-duration`, then look at decoded frames.

"This element" or the current selection: `npx hyperframes preview --context --json --context-fields selection`; `no-selection` means ask them to click it.

## Edit the timeline
