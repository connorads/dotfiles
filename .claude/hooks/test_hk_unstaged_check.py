# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for the hk-unstaged-check Stop hook."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HOOK_PATH = str(Path(__file__).parent / "hk-unstaged-check.py")

# `hk check --help` output, with and without the flag the hook depends on.
HELP_WITH_FLAG = (
    'echo "Usage: hk check [OPTIONS]"; echo "      --unstaged  Check unstaged files"; exit 0'
)
HELP_WITHOUT_FLAG = 'echo "Usage: hk check [OPTIONS]"; echo "      --all  Check all files"; exit 0'


def _fake_hk(bin_dir: Path, help_body: str, check_body: str) -> None:
    """Write a fake `hk` that answers --help one way and a real run another."""
    script = bin_dir / "hk"
    script.write_text(
        f'#!/bin/sh\ncase " $* " in\n  *" --help "*) {help_body} ;;\nesac\n{check_body}\n'
    )
    script.chmod(0o755)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A git repo with an hk config and an empty PATH dir holding only git."""
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "hk.pkl").write_text("")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    git = shutil.which("git")
    assert git
    (bin_dir / "git").symlink_to(git)
    return tmp_path


def _run(repo: Path) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "PATH": str(repo / "bin")}
    return subprocess.run(
        [sys.executable, HOOK_PATH],
        input="{}",
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_old_hk_without_flag_is_silent(repo: Path) -> None:
    _fake_hk(
        repo / "bin",
        HELP_WITHOUT_FLAG,
        "echo \"error: unexpected argument '--unstaged' found\" >&2; exit 2",
    )
    r = _run(repo)
    assert r.returncode == 0
    assert r.stdout == ""


def test_findings_are_reported(repo: Path) -> None:
    _fake_hk(repo / "bin", HELP_WITH_FLAG, 'echo "trailing-whitespace: notes/a.md"; exit 1')
    r = _run(repo)
    assert r.returncode == 0
    out = json.loads(r.stdout)
    assert "trailing-whitespace: notes/a.md" in out["systemMessage"]


def test_clean_check_is_silent(repo: Path) -> None:
    _fake_hk(repo / "bin", HELP_WITH_FLAG, "exit 0")
    r = _run(repo)
    assert r.returncode == 0
    assert r.stdout == ""


def test_missing_hk_is_silent(repo: Path) -> None:
    r = _run(repo)
    assert r.returncode == 0
    assert r.stdout == ""


def test_repo_without_config_is_silent(repo: Path) -> None:
    (repo / "hk.pkl").unlink()
    _fake_hk(repo / "bin", HELP_WITH_FLAG, 'echo "should not run"; exit 1')
    r = _run(repo)
    assert r.returncode == 0
    assert r.stdout == ""
