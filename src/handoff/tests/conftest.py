"""Shared pytest fixtures for the handoff test suite.

Ported from the Rust integration test `tests/roundtrip.rs`. The Rust `fixture(name)`
helper becomes the `fixture` fixture; the Rust tests that spawn
`CARGO_BIN_EXE_handoff` become the `run_cli` fixture, which invokes the Python CLI
via `python -m handoff` with `src/` on `PYTHONPATH`.
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SRC_DIR = Path(__file__).resolve().parent.parent / "src"


@pytest.fixture
def fixture() -> Callable[[str], Path]:
    """Return a resolver for a named file under `tests/fixtures/` (Rust `fixture`)."""

    def _fixture(name: str) -> Path:
        return FIXTURES_DIR / name

    return _fixture


@pytest.fixture
def run_cli() -> Callable[..., subprocess.CompletedProcess[str]]:
    """Run the handoff CLI as a subprocess (Rust `Command::new(CARGO_BIN_EXE_...)`).

    `env` overlays environment variables (mirrors `.env(k, v)`); `remove_env` unsets
    them first (mirrors `.env_remove(k)`). The parent environment is inherited, as the
    Rust `Command` does, with `src/` prepended to `PYTHONPATH` so the child imports the
    in-tree package.
    """

    def _run(
        *args: object,
        env: Mapping[str, object] | None = None,
        remove_env: Iterable[str] = (),
    ) -> subprocess.CompletedProcess[str]:
        child_env = dict(os.environ)
        existing = child_env.get("PYTHONPATH", "")
        child_env["PYTHONPATH"] = (
            f"{SRC_DIR}{os.pathsep}{existing}" if existing else str(SRC_DIR)
        )
        for key in remove_env:
            child_env.pop(key, None)
        if env:
            for key, value in env.items():
                child_env[key] = str(value)
        return subprocess.run(
            [sys.executable, "-m", "handoff", *[str(arg) for arg in args]],
            env=child_env,
            capture_output=True,
            text=True,
            check=False,
        )

    return _run
