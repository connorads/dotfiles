import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPT = SKILL_DIR / "scripts" / "clip-video.py"


def load_module():
    spec = importlib.util.spec_from_file_location("clip_video", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


clip_video = load_module()


class TestQuoteMatching:
    def test_approximate_wording_finds_spoken_phrase(self):
        words = [
            {"word": "She", "start": 4.86, "end": 4.98},
            {"word": "packed", "start": 4.98, "end": 5.16},
            {"word": "my", "start": 5.16, "end": 5.32},
            {"word": "bag", "start": 5.32, "end": 5.56},
            {"word": "and", "start": 5.64, "end": 5.72},
            {"word": "you're", "start": 5.72, "end": 5.82},
            {"word": "lifting", "start": 5.82, "end": 6.08},
            {"word": "it", "start": 6.08, "end": 6.20},
            {"word": "now", "start": 6.20, "end": 6.46},
        ]

        match = clip_video.find_quote(words, "packs my bag now your lifting it")

        assert match.score >= 0.58
        assert match.start == pytest.approx(4.98)
        assert match.end == pytest.approx(6.20)
        assert match.text == "packed my bag and you're lifting it"

    def test_collapsed_boundary_timestamp_is_rejected(self):
        words = [
            {"word": "requested", "start": 9.98, "end": 10.0},
            {"word": "line", "start": 10.0, "end": 10.0},
        ]

        with pytest.raises(ValueError, match="boundary"):
            clip_video.find_quote(words, "requested line", window_duration=10.0)

    def test_relative_caption_bounds_follow_clip_handles(self):
        clip = clip_video.calculate_bounds(
            phrase_start=74.86,
            phrase_end=76.34,
            media_duration=233.0,
            before=1.0,
            after=1.0,
        )

        assert clip.start == pytest.approx(73.86)
        assert clip.end == pytest.approx(77.34)
        assert clip.caption_start == pytest.approx(1.0)
        assert clip.caption_end == pytest.approx(2.48)

    def test_subtitle_file_preserves_apostrophe(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "caption.txt"
            clip_video.write_caption_text(path, "you're lifting it")

            assert path.read_text() == "you're lifting it\n"
            assert "u2019" not in path.read_text()


class TestTimestampClip:
    def test_cli_renders_timed_caption_and_reports_streams(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp4"
            output = root / "clip.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:s=640x360:d=4",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=4",
                    "-shortest",
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    str(source),
                ],
                check=True,
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    str(source),
                    "--start",
                    "1",
                    "--end",
                    "2",
                    "--before",
                    "0.5",
                    "--after",
                    "0.5",
                    "--caption-text",
                    "it's synced",
                    "--output",
                    str(output),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            report = json.loads(completed.stdout)

            assert output.exists()
            assert report["streams"] == {"audio": True, "video": True}
            assert report["clip"]["duration"] == pytest.approx(2.0, abs=0.1)
            assert report["caption"]["text"] == "it's synced"
            assert report["caption"]["start"] == pytest.approx(0.5)
            assert report["caption"]["end"] == pytest.approx(1.5)

    def test_cli_refuses_to_replace_output_without_force(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp4"
            output = root / "clip.mp4"
            output.write_text("keep me")
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:s=320x180:d=2",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=2",
                    "-shortest",
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    str(source),
                ],
                check=True,
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    str(source),
                    "--start",
                    "0.5",
                    "--end",
                    "1.0",
                    "--no-captions",
                    "--output",
                    str(output),
                ],
                check=False,
                capture_output=True,
                text=True,
            )

            assert completed.returncode == 2
            assert "--force" in completed.stderr
            assert output.read_text() == "keep me"
