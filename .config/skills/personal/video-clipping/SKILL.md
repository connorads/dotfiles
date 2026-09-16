---
name: video-clipping
description: >-
  Clips local videos or yt-dlp-supported URLs by spoken quote or timestamps,
  with word-timed burned captions. Use when the user asks to clip, cut, or
  extract the part where someone says specific words, make a short excerpt,
  or subtitle that excerpt. Not for recording a browser flow, making a video
  thumbnail, or general resizing and montage work.
compatibility: Requires Python 3, ffmpeg, ffprobe and uvx; URL inputs also require yt-dlp. Local transcription through mlx-whisper requires Apple silicon.
---

# Video Clipping

Find the words in the exact source audio. Keep detection, cutting and caption
timing in that source's timeline.

## Run the bundled clipper

Execute `scripts/clip-video.py`; do not reimplement its timing steps in shell.
It returns a bounded JSON report and exits non-zero rather than guessing when
the quote match is weak or its two transcription passes disagree.

By approximate spoken words:

```sh
python3 scripts/clip-video.py input.mp4 \
  --quote "pack my bag now you're lifting it" \
  --output clip.mp4
```

By source timestamps:

```sh
python3 scripts/clip-video.py input.mp4 \
  --start 74.86 --end 76.34 \
  --caption-text "Pack my bag, and you're lifting it now" \
  --output clip.mp4
```

The defaults add one second before and after the phrase and show one full-line
caption only from the first matched word through the last. Use `--before` and
`--after` to change context, `--search START:END` to bound a long source,
`--caption-text` for verified wording, or `--no-captions` when requested.
Existing outputs are preserved unless `--force` is explicit.

For URLs, pass the URL as `SOURCE`; the script downloads the selected video and
audio with yt-dlp into a temporary directory. The first transcription may
download its local model.

## Interpret failures

- A weak match means the script did not prove where the quote occurs. Narrow
  `--search`, correct the locator wording, or use verified source timestamps.
- A boundary-collapse error means the transcription window ended while words
  were still being forced into it. Widen `--search`.
- A disagreement between prompted and unprompted passes means the prompt may
  have induced the text. Inspect the candidates; do not render from that match.
- Locator wording may be approximate. Use `--caption-text` only after checking
  the source wording; do not silently turn a user's paraphrase into a quote.

## Avoid the related-source trap

Do not time a source video from a lyric video, transcript card, alternate
upload, or audio-only release. Intros and edits differ. If the exact source
cannot be transcribed and an alternate source is unavoidable, correlate the
two audio tracks, map the offset, and then verify the mapped words against the
exact source before cutting.

| You will think... | But actually... |
|---|---|
| "The lyric card shows the line here, so the timestamp is close enough." | A related upload can use a different lead-in. Transcribe the exact source. |
| "The caption looks right in this frame." | One frame proves appearance, not synchronisation. Check before, during and after. |
| "The short window is faster; I can use the last words." | Words collapsed at the window end are failed alignment. Widen the window. |

## Verify before delivery

Read `match`, `confirmation`, `final_verification`, `clip`, `caption` and
`streams` in the JSON report. Delivery requires:

- Prompted and unprompted source matches agree within one second.
- Final-clip transcription still contains the requested quote.
- Both video and audio streams exist and reported duration matches the bounds.
- Frames immediately before, during and after the reported caption interval
  show the caption absent, present and absent. Extract those frames with
  ffmpeg and inspect them as a contact sheet.

`evals/evals.json` contains trigger and regression prompts for fresh-session
comparison. `tests/test_clip_video.py` exercises the script's public behaviour.
