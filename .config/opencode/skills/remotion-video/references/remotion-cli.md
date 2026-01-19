# Remotion CLI quick reference

This file is a small CLI-focused add-on for the `remotion-video` skill.

## Studio (preview/edit)

Start Remotion Studio:

```bash
npx remotion studio
```

Notes:
- `npx remotion preview` is an alias.
- Many templates expose this via `npm start` or `npm run remotion`.

## Render (encode a video/audio)

Canonical command:

```bash
npx remotion render <entry-point|serve-url>? <composition-id> <output-location>
```

Useful behaviors:
- If `composition-id` is omitted, Remotion asks you to select one.
- If `output-location` is omitted, Remotion renders into the `out/` folder.

### Props

You can pass input props:

```bash
npx remotion render MyComp out/video.mp4 --props='{"title":"Hello"}'
```

Or pass a JSON file:

```bash
npx remotion render MyComp out/video.mp4 --props=./props.json
```

Note:
- Docs caution that `--props` is not recommended for Studio usage; prefer `defaultProps` + the props editor for previewing.
