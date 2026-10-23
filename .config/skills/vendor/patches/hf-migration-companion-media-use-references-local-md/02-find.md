## Sound

- Match loudness: `npx hyperframes normalize-audio --reference <id> --target <id> --write`, or `--lufs=-16` (the default target; write a negative value with `=`) without a reference. `--write` edits the volume in the HTML.
- Beat grid: `npx hyperframes beats --json` reads the local music `<audio>` (marked `data-timeline-role="music"`, or an id containing music, bgm or soundtrack) and writes `beats/<path>.json`, which Studio shows as its beat grid. A beat time minus a scene's `data-start` is its time inside that scene.
- Local transcription, or importing `.srt`, `.vtt` or Whisper JSON: `npx hyperframes transcribe <file> --json`. The default model translates non-English speech: see `../../hyperframes/references/captions.md`.
