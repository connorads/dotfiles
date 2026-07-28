"""Tests for the vox merge filter.

Assertions target the public contract - the markdown on stdout and the pure
functions that build it - never internal structure.

Run: cd ~/.config/vox && uv run --with pytest python -m pytest -q
"""

from __future__ import annotations

import json
import random
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from merge import (
    Segment,
    apply_vocabulary,
    build,
    format_timestamp,
    interleave,
    load_segments,
    merge_gaps,
    parse_vocabulary,
    render,
)

MERGE_PY = Path(__file__).parent / "merge.py"


def seg(start: int, end: int, speaker: str, text: str) -> Segment:
    return Segment(start, end, speaker, text)


def write_track(path: Path, segments: list[dict[str, object]]) -> Path:
    path.write_text(json.dumps({"segments": segments}), encoding="utf-8")
    return path


# --- timestamps -------------------------------------------------------------


@pytest.mark.parametrize(
    ("ms", "expected"),
    [
        (0, "00:00:00"),
        (4_000, "00:00:04"),
        (65_000, "00:01:05"),
        (3_723_000, "01:02:03"),
        (-500, "00:00:00"),
    ],
)
def test_format_timestamp(ms: int, expected: str) -> None:
    assert format_timestamp(ms) == expected


# --- schema: what mw actually emits ----------------------------------------


def test_load_segments_reads_ms_start_end_and_text() -> None:
    payload = {"segments": [{"id": 0, "start": 1200, "end": 3400, "text": " hello "}]}
    assert load_segments(payload, "Me") == [seg(1200, 3400, "Me", "hello")]


def test_speaker_is_optional_and_falls_back_to_the_track_name() -> None:
    payload = {"segments": [{"start": 0, "end": 1000, "text": "hi"}]}
    assert load_segments(payload, "Them")[0].speaker == "Them"


def test_speaker_is_used_when_diarisation_supplied_one() -> None:
    payload = {"segments": [{"start": 0, "end": 1000, "text": "hi", "speaker": "Speaker 1"}]}
    assert load_segments(payload, "Them")[0].speaker == "Speaker 1"


def test_blank_and_malformed_segments_are_dropped() -> None:
    payload = {"segments": [{"start": 0, "end": 1, "text": "   "}, "nonsense", {"text": "ok"}]}
    assert [s.text for s in load_segments(payload, "Me")] == ["ok"]


def test_missing_segments_key_yields_nothing() -> None:
    assert load_segments({}, "Me") == []
    assert load_segments([], "Me") == []


# --- interleaving -----------------------------------------------------------


def test_interleave_orders_both_tracks_by_start() -> None:
    me = [seg(0, 1000, "Me", "one"), seg(4000, 5000, "Me", "three")]
    them = [seg(2000, 3000, "Them", "two")]
    assert [s.text for s in interleave([me, them])] == ["one", "two", "three"]


def test_interleave_is_order_invariant_under_shuffle() -> None:
    """Interleaving is a sort/merge, so shuffling the input must not change it.

    A fixed-seed shuffle rather than a property-test library: merge.py stays
    stdlib-only to remain eligible for the pyrefly gate, and the two invariants
    below - output non-decreasing in start, every input text present exactly
    once - are most of what a generator would check.
    """
    segments = [seg(i * 1000, i * 1000 + 500, "Me", f"line {i}") for i in range(25)]
    shuffled = list(segments)
    random.Random(20260728).shuffle(shuffled)

    result = interleave([shuffled])

    starts = [s.start for s in result]
    assert starts == sorted(starts)
    assert sorted(s.text for s in result) == sorted(s.text for s in segments)


# --- gap merging ------------------------------------------------------------


def test_same_speaker_segments_within_the_gap_become_one_line() -> None:
    segments = [seg(0, 1000, "Me", "right"), seg(2000, 3000, "Me", "shall we start")]
    assert merge_gaps(segments) == [seg(0, 3000, "Me", "right shall we start")]


def test_same_speaker_segments_beyond_the_gap_stay_separate() -> None:
    segments = [seg(0, 1000, "Me", "right"), seg(9000, 9500, "Me", "anyway")]
    assert len(merge_gaps(segments)) == 2


def test_different_speakers_never_merge() -> None:
    segments = [seg(0, 1000, "Me", "right"), seg(1100, 2000, "Them", "yes")]
    assert len(merge_gaps(segments)) == 2


def test_an_interjection_stops_a_merge_across_it() -> None:
    segments = [
        seg(0, 1000, "Me", "so the plan"),
        seg(1100, 1400, "Them", "mm"),
        seg(1500, 2000, "Me", "is this"),
    ]
    assert [s.speaker for s in merge_gaps(segments)] == ["Me", "Them", "Me"]


# --- vocabulary -------------------------------------------------------------


def test_parse_vocabulary_ignores_blanks_and_comments() -> None:
    text = "# a note\n\nadmit\tAdmyt\n  Decera\tDiscera  \nnotabpair\n"
    assert parse_vocabulary(text) == [("admit", "Admyt"), ("Decera", "Discera")]


def test_vocabulary_substitution_is_case_insensitive() -> None:
    assert apply_vocabulary("Admit and admit", [("admit", "Admyt")]) == "Admyt and Admyt"


def test_vocabulary_substitution_is_whole_word_only() -> None:
    assert apply_vocabulary("admittedly", [("admit", "Admyt")]) == "admittedly"


def test_vocabulary_handles_regex_metacharacters_literally() -> None:
    assert apply_vocabulary("a.b works", [("a.b", "AB")]) == "AB works"
    assert apply_vocabulary("axb works", [("a.b", "AB")]) == "axb works"


# --- rendering --------------------------------------------------------------


def test_render_emits_one_timestamped_line_per_segment() -> None:
    out = render([seg(4000, 5000, "Me", "hello"), seg(7000, 8000, "Speaker 1", "hi")])
    assert out == "[00:00:04] Me: hello\n[00:00:07] Speaker 1: hi\n"


# --- the whole filter -------------------------------------------------------


def test_build_merges_two_tracks_and_applies_the_vocabulary(tmp_path: Path) -> None:
    me = write_track(tmp_path / "mic.json", [{"start": 0, "end": 1000, "text": "hello admit"}])
    them = write_track(
        tmp_path / "sys.json",
        [{"start": 2000, "end": 3000, "text": "hi there", "speaker": "Speaker 1"}],
    )
    vocab = tmp_path / "v.tsv"
    vocab.write_text("admit\tAdmyt\n", encoding="utf-8")

    assert build(me, them, vocab, "Me", "Them") == (
        "[00:00:00] Me: hello Admyt\n[00:00:02] Speaker 1: hi there\n"
    )


def test_a_silent_system_track_yields_a_monologue_transcript(tmp_path: Path) -> None:
    me = write_track(tmp_path / "mic.json", [{"start": 0, "end": 1000, "text": "just me"}])
    them = write_track(tmp_path / "sys.json", [])

    assert build(me, them, None, "Me", "Them") == "[00:00:00] Me: just me\n"


def test_a_missing_track_file_contributes_nothing(tmp_path: Path) -> None:
    me = write_track(tmp_path / "mic.json", [{"start": 0, "end": 1000, "text": "just me"}])

    assert build(me, tmp_path / "absent.json", None, "Me", "Them") == "[00:00:00] Me: just me\n"


# --- the CLI ----------------------------------------------------------------


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(MERGE_PY), *args], capture_output=True, text=True, check=False
    )


def test_cli_writes_markdown_to_stdout(tmp_path: Path) -> None:
    me = write_track(tmp_path / "mic.json", [{"start": 0, "end": 1000, "text": "hello"}])

    result = run_cli("--me", str(me))

    assert result.returncode == 0
    assert result.stdout == "[00:00:00] Me: hello\n"


def test_cli_requires_at_least_one_track() -> None:
    result = run_cli()

    assert result.returncode != 0
    assert "--me" in result.stderr
