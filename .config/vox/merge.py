#!/usr/bin/env python3
"""Merge two MacWhisper JSON transcripts into one interleaved markdown script.

A real Unix filter: it reads the two per-track JSON files vox keeps beside the
audio, writes markdown to stdout, and has no other side effects. That makes it
usable on its own (`mw … --format json | …`) and testable without any audio.

    merge.py --me mic.json --them sys.json [--vocab vocabulary.tsv] > transcript.md

Input schema (`mw transcribe --format json`):

    {"segments": [{"id", "start", "end", "text", "words": [...]}]}

`start`/`end` are integer **milliseconds**. `speaker` is present only when the
transcription ran with `--speakers`, so it is treated as optional throughout —
vox transcribes the mic track with `--no-speakers` (it is definitionally you).

Output is one line per utterance, sorted by start time:

    [00:00:04] Me: right, shall we start
    [00:00:07] Speaker 1: yes, go ahead

Stdlib only. That keeps this directory eligible for the pyrefly gate, and the
filter runnable from any Python on the machine with nothing installed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, NamedTuple

# Consecutive same-speaker segments closer together than this are one utterance.
# Whisper-family models split on breath pauses, so without this a single
# sentence arrives as three timestamped lines.
DEFAULT_GAP_MS = 1500


class Segment(NamedTuple):
    """One utterance: milliseconds since the start of the recording."""

    start: int
    end: int
    speaker: str
    text: str


def format_timestamp(ms: int) -> str:
    """Render milliseconds as [hh:mm:ss]-style hh:mm:ss (hours never truncated)."""
    total = max(0, ms) // 1000
    return f"{total // 3600:02d}:{(total % 3600) // 60:02d}:{total % 60:02d}"


def load_segments(payload: Any, default_speaker: str) -> list[Segment]:
    """Extract segments from an `mw --format json` payload.

    `speaker` is optional (absent under `--no-speakers`) and may be blank, so
    the caller's track name is the fallback. Segments with no text are dropped:
    they carry no information and would render as an empty line.
    """
    raw = payload.get("segments") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []

    segments: list[Segment] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        start = int(item.get("start", 0) or 0)
        end = int(item.get("end", start) or start)
        speaker = str(item.get("speaker") or "").strip() or default_speaker
        segments.append(Segment(start, max(start, end), speaker, text))
    return segments


def parse_vocabulary(text: str) -> list[tuple[str, str]]:
    """Parse a `wrong<TAB>right` vocabulary file. Blank and `#` lines ignored.

    MacWhisper has no `--vocabulary`/`--prompt` flag and no replacement
    dictionary in its preferences, so correcting names it reliably mangles has
    to happen after transcription.
    """
    pairs: list[tuple[str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        wrong, _, right = line.partition("\t")
        wrong, right = wrong.strip(), right.strip()
        if wrong and right:
            pairs.append((wrong, right))
    return pairs


def apply_vocabulary(text: str, pairs: list[tuple[str, str]]) -> str:
    """Replace each whole-word `wrong` with `right`, ignoring case.

    Whole-word so "admit" does not rewrite the inside of another word, and
    case-insensitive because the model capitalises inconsistently mid-sentence.
    """
    for wrong, right in pairs:
        text = re.sub(rf"\b{re.escape(wrong)}\b", right, text, flags=re.IGNORECASE)
    return text


def interleave(tracks: list[list[Segment]]) -> list[Segment]:
    """Merge the tracks into one timeline, ordered by start then end.

    Python's sort is stable, so segments sharing a start keep their track order
    rather than shuffling between runs.
    """
    combined = [segment for track in tracks for segment in track]
    return sorted(combined, key=lambda s: (s.start, s.end))


def merge_gaps(segments: list[Segment], gap_ms: int = DEFAULT_GAP_MS) -> list[Segment]:
    """Join runs of same-speaker segments separated by less than `gap_ms`.

    Applied *after* interleaving, so an interjection from the other side sits
    between two of your segments and correctly stops them merging across it.
    """
    merged: list[Segment] = []
    for segment in segments:
        if merged:
            previous = merged[-1]
            if previous.speaker == segment.speaker and segment.start - previous.end < gap_ms:
                merged[-1] = previous._replace(
                    end=max(previous.end, segment.end),
                    text=f"{previous.text} {segment.text}",
                )
                continue
        merged.append(segment)
    return merged


def render(segments: list[Segment]) -> str:
    """Render the timeline as `[hh:mm:ss] Speaker: text` lines."""
    return "".join(f"[{format_timestamp(s.start)}] {s.speaker}: {s.text}\n" for s in segments)


def read_track(path: Path | None, speaker: str) -> list[Segment]:
    """Load one track's segments; a missing or empty path contributes nothing."""
    if path is None or not path.is_file() or path.stat().st_size == 0:
        return []
    return load_segments(json.loads(path.read_text(encoding="utf-8")), speaker)


def build(
    me: Path | None,
    them: Path | None,
    vocab: Path | None,
    me_name: str,
    them_name: str,
    gap_ms: int = DEFAULT_GAP_MS,
) -> str:
    """The whole filter as one pure-ish function: paths in, markdown out."""
    timeline = merge_gaps(
        interleave([read_track(me, me_name), read_track(them, them_name)]), gap_ms
    )
    pairs = parse_vocabulary(vocab.read_text(encoding="utf-8")) if vocab and vocab.is_file() else []
    if pairs:
        timeline = [s._replace(text=apply_vocabulary(s.text, pairs)) for s in timeline]
    return render(timeline)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--me", type=Path, help="JSON transcript of the mic track")
    parser.add_argument("--them", type=Path, help="JSON transcript of the system track")
    parser.add_argument("--vocab", type=Path, help="wrong<TAB>right substitutions")
    parser.add_argument("--me-name", default="Me", help="label for the mic track")
    parser.add_argument("--them-name", default="Them", help="label for the system track")
    parser.add_argument(
        "--gap-ms",
        type=int,
        default=DEFAULT_GAP_MS,
        help=f"join same-speaker segments closer than this (default {DEFAULT_GAP_MS})",
    )
    args = parser.parse_args(argv)

    if args.me is None and args.them is None:
        parser.error("at least one of --me/--them is required")

    sys.stdout.write(
        build(args.me, args.them, args.vocab, args.me_name, args.them_name, args.gap_ms)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
