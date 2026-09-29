#!/usr/bin/env python3
"""Turn FluidAudio word timings (plus optional diarisation) into vox segments.

A real Unix filter: it reads the per-track files `fluidaudiocli` writes and
prints the segment JSON vox stores as `mic.json`/`sys.json`, the schema
merge.py and vox-lib.sh read.

    segments.py --asr sys.asr.json [--diar sys.diar.json] > sys.json

Input schemas:

    transcribe --word-timestamps --output-json:
        {"text", "wordTimings": [{"startTime", "endTime", "word", "confidence"}]}
    process --mode offline --output:
        {"segments": [{"startTimeSeconds", "endTimeSeconds", "speakerId", ...}]}

Times there are float **seconds**. Output:

    {"text", "segments": [{"start", "end", "text", "speaker"?, "words": [...]}]}

with `start`/`end` integer **milliseconds**. `speaker` is present only when a
diarisation file was given, so the mic track (definitionally you) carries none.

Stdlib only. That keeps this directory eligible for the pyrefly gate, and the
filter runnable from any Python on the machine with nothing installed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import NamedTuple

# A pause at least this long starts a new segment. Matches merge.py's
# DEFAULT_GAP_MS, the gap it rejoins same-speaker segments across.
DEFAULT_GAP_MS = 1500

# A word ending a sentence ends its segment too. Sentence-sized segments are
# what let merge.py interleave the other track between them: split on pauses
# alone, one unbroken run of speech is minutes long and sorts the far side's
# replies after all of it. merge.py rejoins what nothing interrupted.
SENTENCE_END = re.compile(r"[.?!]$")

# Parakeet emits sentence punctuation as its own token now and then.
PUNCTUATION = re.compile(r"^[^\w\s]+$")


class Word(NamedTuple):
    start: int
    end: int
    text: str


class Turn(NamedTuple):
    start: int
    end: int
    speaker: str


def _ms(seconds: object) -> int:
    return round(float(seconds) * 1000) if isinstance(seconds, (int, float)) else 0


def load_words(payload: object) -> list[Word]:
    raw = payload.get("wordTimings") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []
    words: list[Word] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("word", "")).strip()
        if text:
            start = _ms(item.get("startTime"))
            words.append(Word(start, max(start, _ms(item.get("endTime"))), text))
    return words


def label(speaker_id: str) -> str:
    """`S1` -> `Speaker 1`, the label MacWhisper transcripts carried."""
    match = re.fullmatch(r"S(\d+)", speaker_id)
    return f"Speaker {match.group(1)}" if match else speaker_id


def load_turns(payload: object) -> list[Turn]:
    raw = payload.get("segments") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []
    turns: list[Turn] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        speaker = str(item.get("speakerId") or "").strip()
        if speaker:
            start = _ms(item.get("startTimeSeconds"))
            turns.append(Turn(start, max(start, _ms(item.get("endTimeSeconds"))), label(speaker)))
    return turns


def speaker_at(ms: float, turns: list[Turn]) -> str | None:
    """The speaker whose turn covers `ms`, else the nearest turn's speaker."""
    if not turns:
        return None
    for t in turns:
        if t.start <= ms <= t.end:
            return t.speaker
    return min(turns, key=lambda t: min(abs(ms - t.start), abs(ms - t.end))).speaker


def segments(asr: object, diar: object | None, gap_ms: int = DEFAULT_GAP_MS) -> dict[str, object]:
    """The whole filter as one pure function: parsed JSON in, vox segments out."""
    turns = load_turns(diar) if diar is not None else []
    groups: list[tuple[str | None, list[Word]]] = []
    for w in load_words(asr):
        if PUNCTUATION.match(w.text):
            # Glue to the previous word; a leading one has nothing to glue to.
            if groups:
                words = groups[-1][1]
                last = words[-1]
                words[-1] = last._replace(end=max(last.end, w.end), text=last.text + w.text)
            continue
        speaker = speaker_at((w.start + w.end) / 2, turns)
        if (
            groups
            and groups[-1][0] == speaker
            and w.start - groups[-1][1][-1].end < gap_ms
            and not SENTENCE_END.search(groups[-1][1][-1].text)
        ):
            groups[-1][1].append(w)
        else:
            groups.append((speaker, [w]))

    out: list[dict[str, object]] = []
    for speaker, words in groups:
        segment: dict[str, object] = {
            "start": words[0].start,
            "end": words[-1].end,
            "text": " ".join(w.text for w in words),
            "words": [{"start": w.start, "end": w.end, "text": w.text} for w in words],
        }
        if diar is not None and speaker is not None:
            segment["speaker"] = speaker
        out.append(segment)
    return {"segments": out, "text": " ".join(str(s["text"]) for s in out)}


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--asr", type=Path, required=True, help="fluidaudiocli transcribe JSON")
    parser.add_argument("--diar", type=Path, help="fluidaudiocli process JSON")
    parser.add_argument(
        "--gap-ms",
        type=int,
        default=DEFAULT_GAP_MS,
        help=f"start a new segment after a pause this long (default {DEFAULT_GAP_MS})",
    )
    args = parser.parse_args(argv)
    diar = read_json(args.diar) if args.diar else None
    json.dump(segments(read_json(args.asr), diar, args.gap_ms), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
