"""Tests for the vox segments filter.

Assertions target the public contract - the JSON on stdout and the pure
function that builds it - never internal structure.

Run: cd ~/.config/vox && uv run --with pytest python -m pytest -q
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from segments import segments

SEGMENTS_PY = Path(__file__).parent / "segments.py"


def word(start: float, end: float, text: str) -> dict[str, object]:
    return {"startTime": start, "endTime": end, "word": text, "confidence": 0.9}


def asr(*words: dict[str, object]) -> dict[str, object]:
    return {"text": " ".join(str(w["word"]) for w in words), "wordTimings": list(words)}


def turn(start: float, end: float, speaker: str) -> dict[str, object]:
    return {
        "startTimeSeconds": start,
        "endTimeSeconds": end,
        "speakerId": speaker,
        "qualityScore": 0.9,
        "embedding": [0.1, 0.2],
    }


def diar(*turns: dict[str, object]) -> dict[str, object]:
    return {"segments": list(turns)}


def texts(payload: dict[str, object]) -> list[tuple[str, str]]:
    out = payload["segments"]
    assert isinstance(out, list)
    return [(str(s.get("speaker", "")), str(s["text"])) for s in out]


def test_words_become_one_segment_in_integer_milliseconds() -> None:
    out = segments(asr(word(1.0, 1.25, "Right"), word(1.3, 1.6, "then.")), None)
    assert out["segments"] == [
        {
            "start": 1000,
            "end": 1600,
            "text": "Right then.",
            "words": [
                {"start": 1000, "end": 1250, "text": "Right"},
                {"start": 1300, "end": 1600, "text": "then."},
            ],
        }
    ]


def test_no_diarisation_means_no_speaker_key() -> None:
    out = segments(asr(word(0, 0.5, "hi")), None)
    assert "speaker" not in out["segments"][0]


def test_a_long_pause_splits_segments() -> None:
    out = segments(asr(word(0, 0.5, "one"), word(2.5, 3, "two")), None)
    assert texts(out) == [("", "one"), ("", "two")]


def test_a_short_pause_does_not_split() -> None:
    out = segments(asr(word(0, 0.5, "one"), word(1.5, 2, "two")), None)
    assert texts(out) == [("", "one two")]


def test_a_sentence_end_splits_segments() -> None:
    # Sentence-sized segments are what let merge.py interleave the other track
    # between them; one segment per unbroken run would swallow minutes of the
    # conversation and sort the far side's replies after it.
    out = segments(
        asr(
            word(0, 0.3, "Done."),
            word(0.4, 0.7, "Next?"),
            word(0.8, 1, "Yes!"),
            word(1.1, 1.3, "ok"),
        ),
        None,
    )
    assert texts(out) == [("", "Done."), ("", "Next?"), ("", "Yes!"), ("", "ok")]


def test_a_glued_full_stop_ends_the_sentence() -> None:
    out = segments(asr(word(0, 0.3, "done"), word(0.3, 0.4, "."), word(0.5, 0.8, "next")), None)
    assert texts(out) == [("", "done."), ("", "next")]


def test_speaker_change_splits_and_relabels() -> None:
    out = segments(
        asr(word(0, 0.4, "hello"), word(0.5, 0.9, "there"), word(1.0, 1.4, "hi")),
        diar(turn(0, 0.95, "S1"), turn(0.95, 2, "S2")),
    )
    assert texts(out) == [("Speaker 1", "hello there"), ("Speaker 2", "hi")]


def test_word_takes_the_speaker_covering_its_midpoint() -> None:
    # Starts inside S1's turn, but most of it (and its midpoint) is S2's.
    out = segments(asr(word(0.8, 1.6, "straddle")), diar(turn(0, 1, "S1"), turn(1, 2, "S2")))
    assert texts(out) == [("Speaker 2", "straddle")]


def test_word_outside_every_turn_takes_the_nearest() -> None:
    out = segments(
        asr(word(5.0, 5.2, "late")),
        diar(turn(0, 1, "S1"), turn(4, 4.9, "S2")),
    )
    assert texts(out) == [("Speaker 2", "late")]


def test_unrecognised_speaker_ids_pass_through() -> None:
    out = segments(asr(word(0, 0.5, "hi")), diar(turn(0, 1, "guest")))
    assert texts(out) == [("guest", "hi")]


def test_punctuation_token_joins_the_previous_word() -> None:
    out = segments(asr(word(0, 0.5, "done"), word(0.5, 0.6, ".")), None)
    assert texts(out) == [("", "done.")]


def test_leading_punctuation_token_is_dropped() -> None:
    # Parakeet emits a stray "." as the first token after a long silence.
    out = segments(asr(word(0, 0.3, "."), word(0.3, 0.6, "Yeah,")), None)
    assert texts(out) == [("", "Yeah,")]


def test_nothing_transcribed_yields_no_segments() -> None:
    out = segments({"text": "", "wordTimings": []}, None)
    assert out == {"segments": [], "text": ""}


def test_top_level_text_joins_the_segments() -> None:
    out = segments(asr(word(0, 0.5, "one"), word(2.5, 3, "two")), None)
    assert out["text"] == "one two"


def test_cli_reads_both_files_and_writes_json(tmp_path: Path) -> None:
    asr_path = tmp_path / "sys.asr.json"
    diar_path = tmp_path / "sys.diar.json"
    asr_path.write_text(json.dumps(asr(word(0, 0.5, "hi"))), encoding="utf-8")
    diar_path.write_text(json.dumps(diar(turn(0, 1, "S3"))), encoding="utf-8")
    result = subprocess.run(
        [
            sys.executable,
            str(SEGMENTS_PY),
            "--asr",
            str(asr_path),
            "--diar",
            str(diar_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert texts(json.loads(result.stdout)) == [("Speaker 3", "hi")]


def test_cli_without_diar(tmp_path: Path) -> None:
    asr_path = tmp_path / "mic.asr.json"
    asr_path.write_text(json.dumps(asr(word(0, 0.5, "hi"))), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(SEGMENTS_PY), "--asr", str(asr_path)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert texts(json.loads(result.stdout)) == [("", "hi")]
