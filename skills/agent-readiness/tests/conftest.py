"""Shared helpers: load ``scripts/probe.py`` as a module and build snapshots.

Snapshots are plain values, so check and scoring tests need no filesystem and
no doubles. Only ``test_cli.py`` touches disk, through real git repos.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "probe.py"
TODAY = date(2026, 9, 24)


def _load():
    spec = importlib.util.spec_from_file_location("probe", SCRIPT)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolves string annotations through sys.modules.
    sys.modules["probe"] = module
    spec.loader.exec_module(module)
    return module


probe = _load()


def snap(files=(), *, doc_dates=None, commits=(), today=TODAY):
    """A snapshot where every path is tracked; a dict also gives contents."""
    texts = dict(files) if isinstance(files, dict) else {}
    return probe.Snapshot(
        paths=frozenset(files),
        texts=texts,
        doc_dates=doc_dates or {},
        commit_lines=tuple(commits),
        today=today,
    )


def verdict(criterion_id, snapshot):
    return probe.CRITERIA[criterion_id].check(snapshot)
