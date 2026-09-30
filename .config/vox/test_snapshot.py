"""Tests for the vox live-WAV snapshot.

The fixture is shaped like a WAV voxtap is still writing: ExtAudioFile leaves
the RIFF and data sizes as they were at creation (the data size 0) until the
file is disposed, and pads the header with an FLLR chunk so PCM starts at 4096.

Run: cd ~/.config/vox && uv run --with pytest python -m pytest -q
"""

from __future__ import annotations

import struct
import subprocess
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from snapshot import snapshot

SNAPSHOT_PY = Path(__file__).parent / "snapshot.py"
RATE = 16000


def live_wav(path: Path, frames: int, stray_bytes: int = 0) -> Path:
    """A 16 kHz mono int16 WAV mid-recording: sample n holds n % 32768."""
    fmt = struct.pack("<HHIIHH", 1, 1, RATE, RATE * 2, 2, 16)
    header = b"RIFF" + struct.pack("<I", 4088) + b"WAVE"
    header += b"fmt " + struct.pack("<I", len(fmt)) + fmt
    header += b"FLLR" + struct.pack("<I", 4044) + bytes(4044)
    header += b"data" + struct.pack("<I", 0)
    assert len(header) == 4096
    pcm = b"".join(struct.pack("<h", n % 32768) for n in range(frames))
    path.write_bytes(header + pcm + bytes(stray_bytes))
    return path


def ramp(start: int, stop: int) -> list[int]:
    return [n % 32768 for n in range(start, stop)]


def samples(path: Path) -> list[int]:
    with wave.open(str(path), "rb") as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, RATE)
        raw = w.readframes(w.getnframes())
    return [s for (s,) in struct.iter_unpack("<h", raw)]


def test_whole_recording_despite_the_zero_data_size(tmp_path: Path) -> None:
    src = live_wav(tmp_path / "mic.wav", RATE * 3)
    offset = snapshot(src, tmp_path / "out.wav")
    assert offset == 0
    assert samples(tmp_path / "out.wav") == ramp(0, RATE * 3)


def test_a_half_written_sample_is_dropped(tmp_path: Path) -> None:
    src = live_wav(tmp_path / "mic.wav", 100, stray_bytes=1)
    snapshot(src, tmp_path / "out.wav")
    assert len(samples(tmp_path / "out.wav")) == 100


def test_last_keeps_the_tail_and_reports_where_it_starts(tmp_path: Path) -> None:
    src = live_wav(tmp_path / "mic.wav", RATE * 5)
    offset = snapshot(src, tmp_path / "out.wav", last_secs=2)
    assert offset == 3000
    assert samples(tmp_path / "out.wav") == ramp(RATE * 3, RATE * 5)


def test_last_longer_than_the_recording_takes_it_all(tmp_path: Path) -> None:
    src = live_wav(tmp_path / "mic.wav", RATE)
    assert snapshot(src, tmp_path / "out.wav", last_secs=600) == 0
    assert len(samples(tmp_path / "out.wav")) == RATE


def test_a_finalised_wav_is_read_by_its_header(tmp_path: Path) -> None:
    src = tmp_path / "done.wav"
    with wave.open(str(src), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(struct.pack("<3h", 1, 2, 3))
    with src.open("ab") as f:
        f.write(b"LIST" + struct.pack("<I", 4) + b"junk")
    snapshot(src, tmp_path / "out.wav")
    assert samples(tmp_path / "out.wav") == [1, 2, 3]


def test_cli_prints_the_offset_in_milliseconds(tmp_path: Path) -> None:
    src = live_wav(tmp_path / "sys.wav", RATE * 4)
    result = subprocess.run(
        [sys.executable, str(SNAPSHOT_PY), str(src), str(tmp_path / "out.wav"), "--last", "1"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout == "3000\n"


def test_cli_fails_on_a_file_that_is_not_a_wav(tmp_path: Path) -> None:
    src = tmp_path / "mic.wav"
    src.write_bytes(b"not audio")
    result = subprocess.run(
        [sys.executable, str(SNAPSHOT_PY), str(src), str(tmp_path / "out.wav")],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "not a WAV" in result.stderr
