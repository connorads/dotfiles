#!/usr/bin/env python3
"""Copy a WAV that voxtap is still writing into a complete one.

    snapshot.py mic.wav out.wav [--last SECONDS]   # prints the start offset, ms

`vox grab` transcribes a call that is still being recorded. voxtap writes
through ExtAudioFile, which leaves the header's data size at 0 until the file
is disposed on stop, so every reader sees an empty file even though the PCM is
on disk and growing. The file's length is the truth while it records: the
audio is everything after the data chunk header, rounded down to whole frames
so a sample caught mid-write is dropped rather than misaligning the rest.

The data chunk is found by walking the chunks rather than assumed at byte
4096, which is only where ExtAudioFile's FLLR padding happens to put it.

`--last` keeps only the tail; the offset printed is where that tail starts in
the recording, which segments.py's --offset-ms puts back onto the call's clock.

Stdlib only. That keeps this directory eligible for the pyrefly gate, and the
filter runnable from any Python on the machine with nothing installed.
"""

from __future__ import annotations

import argparse
import os
import struct
import sys
import wave
from pathlib import Path
from typing import BinaryIO, NamedTuple


class NotWav(Exception):
    pass


class Layout(NamedTuple):
    channels: int
    sample_width: int
    rate: int
    data_offset: int
    data_size: int


def read_layout(f: BinaryIO) -> Layout:
    """The format and where the PCM starts, from the chunk headers alone."""
    riff = f.read(12)
    if len(riff) < 12 or riff[:4] != b"RIFF" or riff[8:] != b"WAVE":
        raise NotWav("not a WAV (no RIFF/WAVE header)")
    fmt: tuple[int, int, int] | None = None
    while header := f.read(8):
        if len(header) < 8:
            break
        chunk_id, size = header[:4], struct.unpack("<I", header[4:])[0]
        if chunk_id == b"fmt ":
            body = f.read(size + (size & 1))
            if len(body) < 16:
                break
            tag, channels, rate, _, _, bits = struct.unpack("<HHIIHH", body[:16])
            if tag != 1:
                raise NotWav(f"not a WAV vox can snapshot (format tag {tag}, not PCM)")
            fmt = (channels, bits // 8, rate)
        elif chunk_id == b"data":
            if fmt is None:
                break
            return Layout(*fmt, data_offset=f.tell(), data_size=size)
        else:
            f.seek(size + (size & 1), os.SEEK_CUR)
    raise NotWav("not a WAV (no fmt and data chunks)")


def snapshot(src: Path, dst: Path, last_secs: float | None = None) -> int:
    """Write the audio so far (or its last `last_secs`) to `dst` as a complete
    WAV, and return the milliseconds into the recording where it starts."""
    with src.open("rb") as f:
        layout = read_layout(f)
        frame = layout.channels * layout.sample_width
        available = (src.stat().st_size - layout.data_offset) // frame
        # A finalised file's header is right, and may be followed by other
        # chunks; a live one says 0, and only its length can be believed.
        frames = min(layout.data_size // frame, available) if layout.data_size else available
        first = 0
        if last_secs is not None:
            first = max(0, frames - round(last_secs * layout.rate))
        f.seek(layout.data_offset + first * frame)
        pcm = f.read((frames - first) * frame)
    with wave.open(str(dst), "wb") as w:
        w.setnchannels(layout.channels)
        w.setsampwidth(layout.sample_width)
        w.setframerate(layout.rate)
        w.writeframes(pcm)
    return first * 1000 // layout.rate


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("src", type=Path, help="the WAV being recorded")
    parser.add_argument("dst", type=Path, help="where to write the complete copy")
    parser.add_argument("--last", type=float, metavar="SECONDS", help="keep only the tail")
    args = parser.parse_args(argv)
    try:
        offset = snapshot(args.src, args.dst, args.last)
    except (OSError, NotWav) as e:
        print(f"snapshot.py: {args.src}: {e}", file=sys.stderr)
        return 1
    print(offset)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
