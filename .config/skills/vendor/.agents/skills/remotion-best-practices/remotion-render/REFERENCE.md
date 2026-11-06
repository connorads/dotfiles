---
name: remotion-render
description: Export a Remotion video
version: 4.0.541
---

## General rendering strategy

<!-- LOCAL PATCH (connorads dotfiles): Use the browser required by the locked Remotion version without unreviewed runtime updates -->
Use the browser required by the project's locked Remotion release for rendering,
including compositions using `<HtmlInCanvas>`. Keep existing runtime versions
and package protections. If that browser is unavailable, report the missing
prerequisite before downloading or updating a runtime. Do not reuse a recording
browser or set `--browser-executable`, `browserExecutable`, or `chromeMode`
unless the user explicitly requests a different browser.

Render a video using:

```
pnpm exec remotion render
```

Full list of options: https://www.remotion.dev/docs/cli/render.md

Render a still using:

```
pnpm exec remotion still
```

Full list of options: https://www.remotion.dev/docs/cli/still.md

To render several frames as images in one call, use `render --frames`:

```
pnpm exec remotion render [composition-id] out/frames --frames=0,30,90 --image-format=png
```

See https://www.remotion.dev/docs/cli/render.md#--frames for more options.

## Transparent videos

See [Transparent videos](./transparent-videos.md) for rendering out a video with transparency.
