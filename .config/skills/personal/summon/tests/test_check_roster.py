"""Behavioural tests for scripts/check-roster.py.

Tests the public CLI contract: exit status and emitted problems.
Run: uv run --with pytest -- pytest tests/ -q  (from the skill root)
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check-roster.py"

HEADER = "| Persona | Domain | File |\n|---------|--------|------|\n"


def write_skill(
    root: Path, rows: list[tuple[str, str, str]], dossiers: dict[str, list[str]]
) -> None:
    (root / "references").mkdir(parents=True, exist_ok=True)
    table = HEADER + "".join(f"| {p} | {d} | `{f}` |\n" for p, d, f in rows)
    (root / "SKILL.md").write_text(
        f"# Summon\n\n## Available Personas\n\n{table}", encoding="utf-8"
    )
    for name, aliases in dossiers.items():
        body = "\n".join(f"- {a}" for a in aliases)
        (root / "references" / name).write_text(f"# X\n\n## Aliases\n\n{body}\n", encoding="utf-8")


def run(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root)],
        capture_output=True,
        text=True,
        check=False,
    )


def test_consistent_roster_passes(tmp_path: Path) -> None:
    write_skill(
        tmp_path,
        [("Ada Lovelace", "Computing", "references/ada-lovelace.md")],
        {"ada-lovelace.md": ["ada"]},
    )
    result = run(tmp_path)
    assert result.returncode == 0, result.stdout
    assert "all consistent" in result.stdout


def test_dossier_with_no_table_row_fails(tmp_path: Path) -> None:
    write_skill(tmp_path, [], {"ada-lovelace.md": ["ada"]})
    result = run(tmp_path)
    assert result.returncode == 1
    assert "no row in SKILL.md" in result.stdout


def test_table_row_with_no_dossier_fails(tmp_path: Path) -> None:
    write_skill(tmp_path, [("Ghost", "Nothing", "references/ghost.md")], {})
    result = run(tmp_path)
    assert result.returncode == 1
    assert "does not exist" in result.stdout


def test_duplicate_alias_fails(tmp_path: Path) -> None:
    write_skill(
        tmp_path,
        [
            ("Matt Perry", "Motion", "references/matt-perry.md"),
            ("Matt Pocock", "TS", "references/matt-pocock.md"),
        ],
        {"matt-perry.md": ["matt"], "matt-pocock.md": ["matt"]},
    )
    result = run(tmp_path)
    assert result.returncode == 1
    assert "ambiguous" in result.stdout


def test_empty_alias_section_fails(tmp_path: Path) -> None:
    write_skill(
        tmp_path,
        [("Ada Lovelace", "Computing", "references/ada-lovelace.md")],
        {"ada-lovelace.md": []},
    )
    result = run(tmp_path)
    assert result.returncode == 1
    assert "cannot be resolved by name" in result.stdout


def test_unsorted_table_fails(tmp_path: Path) -> None:
    write_skill(
        tmp_path,
        [
            ("Zoe Zed", "Z", "references/zoe-zed.md"),
            ("Ada Lovelace", "A", "references/ada-lovelace.md"),
        ],
        {"zoe-zed.md": ["zoe"], "ada-lovelace.md": ["ada"]},
    )
    result = run(tmp_path)
    assert result.returncode == 1
    assert "not alphabetical" in result.stdout


def test_accented_name_sorts_where_a_reader_expects_it(tmp_path: Path) -> None:
    # 'é' is U+00E9, which is above 'z' in code-point order, so a naive sort
    # demands Léonie sit after Luke - where nobody scanning the table would look.
    write_skill(
        tmp_path,
        [
            ("Kent Beck", "K", "references/kent-beck.md"),
            ("Léonie Watson", "L", "references/leonie-watson.md"),
            ("Luke Wroblewski", "L", "references/luke-wroblewski.md"),
        ],
        {
            "kent-beck.md": ["kent"],
            "leonie-watson.md": ["léonie"],
            "luke-wroblewski.md": ["luke"],
        },
    )
    result = run(tmp_path)
    assert result.returncode == 0, result.stdout


def test_missing_skill_returns_two(tmp_path: Path) -> None:
    assert run(tmp_path).returncode == 2


def test_real_skill_roster_is_consistent() -> None:
    """The shipped skill must satisfy its own roster lint."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT)], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stdout
