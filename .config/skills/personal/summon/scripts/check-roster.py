#!/usr/bin/env python3
"""Check SKILL.md's persona table against the dossiers on disk.

The table is the routing surface: it is what an agent reads to decide who to
summon, and it is maintained by hand, so it drifts. A row with no file routes to
a dead path; a file with no row is invisible to routing and effectively unusable.

Also checks the alias namespace, since name resolution matches on it and nothing
else guarantees two dossiers do not claim the same handle.

Usage:
    check-roster.py [--root DIR]
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROW = re.compile(
    r"^\|\s*(?P<persona>[^|]+?)\s*\|\s*(?P<domain>[^|]+?)\s*\|\s*`(?P<file>[^`]+)`\s*\|\s*$"
)


def sort_key(persona: str) -> str:
    """Fold accents so a name sorts where a reader scanning the table would look.

    'é' is U+00E9, above 'z' in code-point order, so a raw sort puts Léonie after
    Luke - which reads as a mistake to every human and to the next author.
    """
    folded = unicodedata.normalize("NFKD", persona.lower())
    return "".join(c for c in folded if not unicodedata.combining(c))


def dossiers(references: Path) -> list[Path]:
    return sorted(
        p
        for p in references.glob("*.md")
        if not p.name.startswith("_") and "\n## Aliases" in p.read_text(encoding="utf-8")
    )


def aliases_of(path: Path) -> list[str]:
    names: list[str] = []
    in_section = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            in_section = line.strip().lower() == "## aliases"
            continue
        if in_section and line.strip().startswith("- "):
            names.append(line.strip()[2:].strip().lower())
    return names


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args(argv)

    skill_md = args.root / "SKILL.md"
    references = args.root / "references"
    if not skill_md.exists() or not references.is_dir():
        print(f"check-roster: no skill at {args.root}", file=sys.stderr)
        return 2

    rows = [
        m.groupdict()
        for line in skill_md.read_text(encoding="utf-8").splitlines()
        if (m := ROW.match(line))
    ]
    rows = [r for r in rows if r["file"] != "File"]

    problems: list[str] = []
    files = dossiers(references)
    names_on_disk = {p.name for p in files}
    names_in_table = {Path(r["file"]).name for r in rows}

    for missing in sorted(names_on_disk - names_in_table):
        problems.append(
            f"{missing}: dossier on disk has no row in SKILL.md, so nothing can route to it"
        )
    for orphan in sorted(names_in_table - names_on_disk):
        problems.append(f"{orphan}: SKILL.md routes to this file, which does not exist")

    for row in rows:
        referenced = args.root / row["file"]
        if referenced.exists() and not row["file"].startswith("references/"):
            problems.append(
                f"{row['persona']}: path should be references/<file>, not {row['file']}"
            )
        if not row["domain"]:
            problems.append(
                f"{row['persona']}: empty Domain cell, which is the only routing hint the table gives"
            )

    ordered = [sort_key(r["persona"]) for r in rows]
    if ordered != sorted(ordered):
        first = next((a for a, b in zip(ordered, sorted(ordered), strict=True) if a != b), None)
        problems.append(f"table is not alphabetical by persona (first out of order: {first})")

    owners: dict[str, list[str]] = defaultdict(list)
    for path in files:
        found = aliases_of(path)
        if not found:
            problems.append(
                f"{path.name}: ## Aliases section is empty, so the persona cannot be resolved by name"
            )
        for alias in found:
            owners[alias].append(path.name)
    for alias, claimants in sorted(owners.items()):
        if len(claimants) > 1:
            problems.append(
                f"alias '{alias}' is claimed by {', '.join(claimants)} - name resolution is ambiguous"
            )

    for problem in problems:
        print(f"check-roster: {problem}")
    if problems:
        return 1
    print(
        f"check-roster: {len(files)} dossiers, {len(rows)} rows, {len(owners)} aliases, all consistent"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
