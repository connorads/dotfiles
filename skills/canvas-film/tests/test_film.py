import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "film.py"
spec = importlib.util.spec_from_file_location("film", SCRIPT)
film = importlib.util.module_from_spec(spec)
spec.loader.exec_module(film)

CLIPS = [
    {
        "id": "n01",
        "start": 1.0,
        "dur": 2.0,
        "words": [
            {"w": "Deep", "s": 1.1, "e": 1.3},
            {"w": "noble.", "s": 2.4, "e": 2.8},
        ],
    },
    {
        "id": "c02",
        "start": 4.0,
        "dur": 3.0,
        "words": [
            {"w": "50/50", "s": 4.5, "e": 5.0},
            {"w": "bail", "s": 6.2, "e": 6.6},
        ],
    },
]


def cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


@pytest.mark.parametrize(
    ("ref", "want"),
    [
        (3.5, 3.5),
        ("c02", 4.0),
        ("c02$", 7.0),
        ("c02:bail", 6.2),
        ("c02:bail+0.02", 6.22),
        ("n01:NOBLE-0.1", 2.3),
        ("c02:50/50", 4.5),
    ],
)
def test_time_refs_resolve_to_line_and_word_times(ref, want):
    assert film.resolve(ref, CLIPS) == pytest.approx(want)


def test_unknown_word_ref_fails_loudly(capsys):
    with pytest.raises(SystemExit, match="1"):
        film.resolve("c02:curry", CLIPS)
    assert "word not found" in capsys.readouterr().err


def test_init_scaffolds_a_buildable_project_and_will_not_overwrite(tmp_path: Path):
    d = tmp_path / "p"
    res = cli("init", str(d))
    assert res.returncode == 0, res.stderr
    for f in ("film.json", "src/engine.html", "src/style.js", "src/scenes.js"):
        assert (d / f).is_file(), f
    again = cli("init", str(d))
    assert again.returncode != 0
    assert "exists" in again.stderr


def test_build_inlines_everything_into_one_html(tmp_path: Path):
    d = tmp_path / "p"
    assert cli("init", str(d)).returncode == 0
    (d / "assets/img/bg_paper.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    (d / "assets/fonts/Caveat.woff2").write_bytes(b"wOF2fake")
    (d / "build/timeline.json").write_text(
        json.dumps({"duration": 3, "envFps": 60, "clips": CLIPS, "env": {}})
    )
    res = cli("build", str(d))
    assert res.returncode == 0, res.stderr
    html = (d / "dist/my-film.html").read_text()
    assert html.startswith("<!doctype html>")
    for marker in ("/*INLINE:", "/*ASSETS*/", "/*TIMELINE*/"):
        assert marker not in html
    for needle in ("img_bg_paper", "font_Caveat", "const SCENES", "function ransom"):
        assert needle in html
