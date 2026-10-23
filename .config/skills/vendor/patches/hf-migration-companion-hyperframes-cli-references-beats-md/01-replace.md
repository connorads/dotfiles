
```bash
hyperframes beats
hyperframes beats ./my-video
hyperframes beats ./my-video --json
```

The project must contain a local music `<audio>` source. Mark it with `data-timeline-role="music"`; an id containing `music`, `bgm`, or `soundtrack` is also recognized. The command decodes that file with ffmpeg, tracks its beats, and writes `beats/<audio-relative-path>.json`.

If the track has no steady beat, the command fails and writes nothing. If ffmpeg is missing, run `hyperframes doctor`.

For a whole video cut to a music track, see `/hyperframes` → `references/film.md`.
