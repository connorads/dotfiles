#!/usr/bin/env python3
"""Clip video by spoken quote or timestamps and emit a bounded JSON report."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

DEFAULT_MODEL = "mlx-community/whisper-small.en-mlx"
MIN_MATCH_SCORE = 0.58
MIN_CONFIRMATION_SCORE = 0.40


@dataclass(frozen=True)
class QuoteMatch:
    start: float
    end: float
    text: str
    score: float


@dataclass(frozen=True)
class ClipBounds:
    start: float
    end: float
    caption_start: float
    caption_end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def run(command: Sequence[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(command),
        check=True,
        text=True,
        capture_output=capture,
    )


def require_binary(name: str) -> None:
    if shutil.which(name) is None:
        raise RuntimeError(f"Required binary not found: {name}")


def is_url(value: str) -> bool:
    return urlparse(value).scheme in {"http", "https"}


def normalise_token(token: str) -> str:
    token = unicodedata.normalize("NFKD", token.casefold())
    token = token.replace("\N{RIGHT SINGLE QUOTATION MARK}", "'")
    token = re.sub(r"[^a-z0-9']+", "", token)
    token = token.replace("'", "")
    if token.startswith("your") and len(token) <= 5:
        return "your"
    for suffix in ("ing", "ed", "es", "s"):
        if token.endswith(suffix) and len(token) > len(suffix) + 2:
            token = token[: -len(suffix)]
            break
    return token


def normalise_text(text: str) -> str:
    return " ".join(filter(None, (normalise_token(part) for part in text.split())))


def _valid_word(word: dict[str, Any]) -> bool:
    try:
        return bool(normalise_token(str(word["word"]))) and float(word["end"]) > float(
            word["start"]
        )
    except (KeyError, TypeError, ValueError):
        return False


def find_quote(
    words: Sequence[dict[str, Any]],
    quote: str,
    *,
    window_duration: float | None = None,
    minimum_score: float = MIN_MATCH_SCORE,
) -> QuoteMatch:
    if not words:
        raise ValueError("No timestamped words were produced")
    collapsed_at_boundary = False
    if window_duration is not None:
        collapsed_at_boundary = any(
            float(word.get("end", 0)) >= window_duration - 0.02
            and float(word.get("end", 0)) <= float(word.get("start", 0))
            for word in words
        )

    usable = [word for word in words if _valid_word(word)]
    if not usable:
        raise ValueError("No positive-duration words were produced")

    wanted = normalise_text(quote)
    wanted_count = max(1, len(wanted.split()))
    candidates: list[QuoteMatch] = []
    minimum_length = max(1, wanted_count - 3)
    maximum_length = min(len(usable), wanted_count + 3)
    for length in range(minimum_length, maximum_length + 1):
        for index in range(len(usable) - length + 1):
            window = usable[index : index + length]
            candidate = " ".join(normalise_token(str(word["word"])) for word in window)
            score = SequenceMatcher(None, wanted, candidate).ratio()
            candidates.append(
                QuoteMatch(
                    start=float(window[0]["start"]),
                    end=float(window[-1]["end"]),
                    text=" ".join(str(word["word"]).strip() for word in window),
                    score=score,
                )
            )

    best = max(candidates, key=lambda candidate: candidate.score)
    if collapsed_at_boundary and window_duration is not None and best.end >= window_duration - 0.05:
        raise ValueError("Transcript collapsed at the search-window boundary; widen the window")
    if best.score < minimum_score:
        alternatives = sorted(candidates, key=lambda candidate: candidate.score, reverse=True)[:3]
        summary = "; ".join(
            f"{item.start:.2f}s {item.text!r} ({item.score:.2f})" for item in alternatives
        )
        raise ValueError(f"No confident quote match; best candidates: {summary}")
    return best


def calculate_bounds(
    *,
    phrase_start: float,
    phrase_end: float,
    media_duration: float,
    before: float,
    after: float,
) -> ClipBounds:
    if phrase_start < 0 or phrase_end <= phrase_start:
        raise ValueError("Phrase timestamps must be increasing and non-negative")
    if before < 0 or after < 0:
        raise ValueError("Context handles must be non-negative")
    start = max(0.0, phrase_start - before)
    end = min(media_duration, phrase_end + after)
    if end <= start:
        raise ValueError("Calculated clip has no duration")
    return ClipBounds(
        start=start,
        end=end,
        caption_start=phrase_start - start,
        caption_end=phrase_end - start,
    )


def write_caption_text(path: Path, text: str) -> None:
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def probe(path: Path) -> dict[str, Any]:
    completed = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type",
            "-of",
            "json",
            str(path),
        ],
        capture=True,
    )
    payload = json.loads(completed.stdout)
    types = {stream.get("codec_type") for stream in payload.get("streams", [])}
    return {
        "duration": float(payload["format"]["duration"]),
        "audio": "audio" in types,
        "video": "video" in types,
    }


def parse_search(value: str | None, media_duration: float) -> tuple[float, float]:
    if value is None:
        return 0.0, media_duration
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?):([0-9]+(?:\.[0-9]+)?)", value)
    if not match:
        raise ValueError("--search must use START:END seconds")
    start, end = map(float, match.groups())
    if start < 0 or end <= start or start >= media_duration:
        raise ValueError("--search must be an increasing range inside the media")
    return start, min(end, media_duration)


def resolve_source(source: str, scratch: Path) -> Path:
    if not is_url(source):
        path = Path(source).expanduser().resolve()
        if not path.is_file():
            raise ValueError(f"Source file does not exist: {path}")
        return path

    require_binary("yt-dlp")
    template = scratch / "source.%(ext)s"
    completed = run(
        [
            "yt-dlp",
            "--no-playlist",
            "--quiet",
            "-f",
            "bv*+ba/b",
            "--merge-output-format",
            "mp4",
            "--print",
            "after_move:filepath",
            "-o",
            str(template),
            source,
        ],
        capture=True,
    )
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("yt-dlp did not report a downloaded file")
    path = Path(lines[-1])
    if not path.is_file():
        raise RuntimeError(f"yt-dlp output is missing: {path}")
    return path


def extract_audio(source: Path, output: Path, *, start: float, end: float) -> None:
    run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{end - start:.3f}",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            str(output),
        ]
    )


def transcript_words(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [word for segment in payload.get("segments", []) for word in segment.get("words", [])]


def transcribe(
    audio: Path,
    output_dir: Path,
    *,
    name: str,
    language: str,
    model: str,
    prompt: str | None = None,
) -> list[dict[str, Any]]:
    command = [
        "uvx",
        "--from",
        "mlx-whisper",
        "mlx_whisper",
        str(audio),
        "--model",
        model,
        "--language",
        language,
        "--word-timestamps",
        "True",
        "--output-name",
        name,
        "--output-format",
        "json",
        "--output-dir",
        str(output_dir),
        "--verbose",
        "False",
    ]
    if prompt:
        command.extend(["--initial-prompt", prompt])
    run(command)
    payload = json.loads((output_dir / f"{name}.json").read_text(encoding="utf-8"))
    return transcript_words(payload)


def offset_match(match: QuoteMatch, offset: float) -> QuoteMatch:
    return QuoteMatch(
        start=match.start + offset,
        end=match.end + offset,
        text=match.text,
        score=match.score,
    )


def locate_quote(
    source: Path,
    quote: str,
    scratch: Path,
    *,
    search_start: float,
    search_end: float,
    language: str,
    model: str,
) -> tuple[QuoteMatch, QuoteMatch]:
    audio = scratch / "search.wav"
    extract_audio(source, audio, start=search_start, end=search_end)
    words = transcribe(
        audio,
        scratch,
        name="prompted",
        language=language,
        model=model,
        prompt=quote,
    )
    prompted = offset_match(
        find_quote(words, quote, window_duration=search_end - search_start),
        search_start,
    )

    focus_start = max(search_start, prompted.start - 2.0)
    focus_end = min(search_end, prompted.end + 2.0)
    focus_audio = scratch / "focus.wav"
    extract_audio(source, focus_audio, start=focus_start, end=focus_end)
    focus_words = transcribe(
        focus_audio,
        scratch,
        name="unprompted",
        language=language,
        model=model,
    )
    confirmed = offset_match(
        find_quote(
            focus_words,
            quote,
            window_duration=focus_end - focus_start,
            minimum_score=MIN_CONFIRMATION_SCORE,
        ),
        focus_start,
    )
    if abs(prompted.start - confirmed.start) > 1.0 or abs(prompted.end - confirmed.end) > 1.0:
        raise ValueError(
            "Prompted and unprompted timestamps disagree by more than one second; "
            "narrow --search or provide explicit timestamps"
        )
    return prompted, confirmed


def select_font(explicit: str | None) -> Path | None:
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if not path.is_file():
            raise ValueError(f"Font file does not exist: {path}")
        return path
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    return next((path for path in candidates if path.is_file()), None)


def render_clip(
    source: Path,
    output: Path,
    bounds: ClipBounds,
    *,
    caption_text: str | None,
    font_file: Path | None,
    scratch: Path,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{bounds.start:.3f}",
        "-t",
        f"{bounds.duration:.3f}",
        "-i",
        str(source),
    ]
    if caption_text is not None:
        caption_path = scratch / "caption.txt"
        write_caption_text(caption_path, caption_text)
        font = f"fontfile='{font_file}':" if font_file else "font='Arial':"
        filter_value = (
            "drawtext="
            f"{font}textfile='{caption_path}':"
            "fontcolor=white:fontsize=h/18:borderw=4:bordercolor=black:"
            "x=(w-text_w)/2:y=h-text_h-h/14:"
            f"enable='between(t,{bounds.caption_start:.3f},{bounds.caption_end:.3f})'"
        )
        command.extend(["-vf", filter_value])
    command.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(output),
        ]
    )
    run(command)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Local media path or yt-dlp-supported URL")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--quote", help="Approximate spoken wording to locate")
    selection.add_argument("--start", type=float, help="Phrase start in source seconds")
    parser.add_argument("--end", type=float, help="Phrase end in source seconds")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--caption-text", help="Verified caption wording override")
    parser.add_argument("--no-captions", action="store_true")
    parser.add_argument("--before", type=float, default=1.0)
    parser.add_argument("--after", type=float, default=1.0)
    parser.add_argument("--search", help="Quote search range as START:END seconds")
    parser.add_argument("--language", default="en")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--font-file")
    parser.add_argument("--force", action="store_true", help="Replace an existing output")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.no_captions and args.caption_text:
        parser.error("--no-captions and --caption-text cannot be combined")
    if args.start is not None and args.end is None:
        parser.error("--end is required with --start")
    if args.quote is not None and args.end is not None:
        parser.error("--end is only valid with --start")

    for binary in ("ffmpeg", "ffprobe"):
        require_binary(binary)
    if args.quote is not None or (
        args.start is not None and not args.caption_text and not args.no_captions
    ):
        require_binary("uvx")

    with tempfile.TemporaryDirectory(prefix="video-clipping-") as directory:
        scratch = Path(directory)
        source = resolve_source(args.source, scratch)
        source_probe = probe(source)
        media_duration = source_probe["duration"]
        if not source_probe["video"]:
            raise ValueError("Source has no video stream")

        prompted: QuoteMatch | None = None
        confirmed: QuoteMatch | None = None
        if args.quote is not None:
            search_start, search_end = parse_search(args.search, media_duration)
            prompted, confirmed = locate_quote(
                source,
                args.quote,
                scratch,
                search_start=search_start,
                search_end=search_end,
                language=args.language,
                model=args.model,
            )
            phrase_start, phrase_end = prompted.start, prompted.end
            automatic_caption = prompted.text
        else:
            phrase_start, phrase_end = args.start, args.end
            if phrase_start < 0 or phrase_end > media_duration:
                raise ValueError("Timestamp selection must be inside the source duration")
            automatic_caption = None
            if not args.no_captions and args.caption_text is None:
                audio = scratch / "selection.wav"
                extract_audio(source, audio, start=phrase_start, end=phrase_end)
                words = transcribe(
                    audio,
                    scratch,
                    name="selection",
                    language=args.language,
                    model=args.model,
                )
                valid = [word for word in words if _valid_word(word)]
                if not valid:
                    raise ValueError("Could not transcribe caption text for timestamp selection")
                automatic_caption = " ".join(str(word["word"]).strip() for word in valid)

        bounds = calculate_bounds(
            phrase_start=phrase_start,
            phrase_end=phrase_end,
            media_duration=media_duration,
            before=args.before,
            after=args.after,
        )
        caption_text = None if args.no_captions else (args.caption_text or automatic_caption)
        output = args.output.expanduser().resolve()
        if output.exists() and not args.force:
            raise ValueError(f"Output already exists; pass --force to replace it: {output}")
        render_clip(
            source,
            output,
            bounds,
            caption_text=caption_text,
            font_file=select_font(args.font_file),
            scratch=scratch,
        )
        output_probe = probe(output)
        if not output_probe["video"] or not output_probe["audio"]:
            raise RuntimeError("Rendered clip must contain video and audio streams")
        if abs(output_probe["duration"] - bounds.duration) > 0.15:
            raise RuntimeError("Rendered duration differs from the calculated clip duration")

        final_verification: QuoteMatch | None = None
        if args.quote is not None:
            final_audio = scratch / "final.wav"
            extract_audio(output, final_audio, start=0.0, end=output_probe["duration"])
            final_words = transcribe(
                final_audio,
                scratch,
                name="final",
                language=args.language,
                model=args.model,
            )
            final_verification = find_quote(
                final_words,
                args.quote,
                minimum_score=MIN_CONFIRMATION_SCORE,
            )

        report = {
            "source": args.source,
            "match": asdict(prompted) if prompted else None,
            "confirmation": asdict(confirmed) if confirmed else None,
            "final_verification": asdict(final_verification) if final_verification else None,
            "clip": {
                "start": bounds.start,
                "end": bounds.end,
                "duration": output_probe["duration"],
            },
            "caption": (
                {
                    "text": caption_text,
                    "start": bounds.caption_start,
                    "end": bounds.caption_end,
                }
                if caption_text is not None
                else None
            ),
            "output": str(output),
            "streams": {"audio": output_probe["audio"], "video": output_probe["video"]},
        }
        print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"video-clipping: {error}", file=sys.stderr)
        raise SystemExit(2) from None
