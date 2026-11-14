#!/usr/bin/env python3
"""skill-gaps.py: keep each vendored set's skip decisions recorded once.

  check [VENDOR_ROOT]
      Offline. Every set's skills-exclude.json is a JSON object of
      skill name -> non-empty reason, and no name is both vendored (in
      skills-lock.json) and excluded. Exit 1 on any problem.

  scan SET_DIR --checkout SOURCE=PATH [--checkout SOURCE=PATH ...]
      Compare a set with full upstream checkouts. Prints one TSV line per
      finding and always exits 0:
        candidate             source  name  skillPath
        stale-exclusion       name
        referenced-exclusion  name    vendored skills naming it

A candidate is an upstream SKILL.md beside an already vendored skill (same
source, same parent folder) that is neither vendored nor excluded. Folders
the set has never vendored from are out of scope, so per-tool mirrors,
tests and internal skills stay quiet. The unsorted bucket is never scanned:
it is cherry-picked by definition.

A stale exclusion names a skill no longer found in that scope; delete it.
A referenced exclusion is named by a vendored skill in the set, so skipping
it leaves a dead end; decide it again.

Reads local files only. No network, no installation.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath

LOCK = "skills-lock.json"
EXCLUDE = "skills-exclude.json"
DEFAULT_VENDOR = Path.home() / ".config/skills/vendor"


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def lock_entries(set_dir: Path) -> dict[str, dict]:
    data = load_json(set_dir / LOCK)
    assert isinstance(data, dict)
    return data.get("skills", {})


def load_exclusions(set_dir: Path) -> dict[str, str]:
    path = set_dir / EXCLUDE
    if not path.exists():
        return {}
    data = load_json(path)
    return data if isinstance(data, dict) else {}


def check_set(set_dir: Path) -> list[str]:
    path = set_dir / EXCLUDE
    if not path.exists():
        return []
    try:
        data = load_json(path)
    except json.JSONDecodeError as err:
        return [f"{path}: invalid JSON: {err}"]
    if not isinstance(data, dict):
        return [f"{path}: must be an object of skill name -> reason"]
    problems = []
    for name, reason in data.items():
        if not isinstance(reason, str) or not reason.strip():
            problems.append(f"{path}: {name}: reason must be a non-empty string")
    vendored = set(lock_entries(set_dir)) if (set_dir / LOCK).exists() else set()
    for name in sorted(vendored & set(data)):
        problems.append(f"{path}: {name}: both vendored and excluded")
    return problems


def check(vendor_root: Path) -> int:
    problems: list[str] = []
    for set_dir in sorted(p.parent for p in vendor_root.glob(f"*/{EXCLUDE}")):
        problems += check_set(set_dir)
    for line in problems:
        print(line, file=sys.stderr)
    return 1 if problems else 0


def parent_of(skill_path: str) -> PurePosixPath:
    return PurePosixPath(skill_path).parent.parent


def upstream_skills(checkout: Path) -> list[PurePosixPath]:
    return sorted(
        PurePosixPath(p.relative_to(checkout).as_posix())
        for p in checkout.rglob("SKILL.md")
        if ".git" not in p.relative_to(checkout).parts
    )


def references(text: str, name: str) -> bool:
    n = re.escape(name)
    # URLs are links to upstream files, not instructions to load a skill.
    text = re.sub(r"https?://\S+", "", text)
    # A hyphenated name is distinctive, so any mention counts. A one-word
    # name such as `pr` also appears as plain code, and a false hit would
    # re-ask the same exclusion on every pass, so it needs an explicit form.
    if "-" in name:
        return re.search(rf"(?<![\w-]){n}(?![\w-])", text) is not None
    pattern = rf"([\s(`]/{n}\b|\b{n}`? (sub-?)?skills?\b|skills?/{n}\b)"
    return re.search(pattern, text) is not None


def frontmatter_name(path: Path) -> str | None:
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return None
    if not lines or lines[0].strip() != "---":
        return None
    for line in lines[1:]:
        if line.strip() == "---":
            return None
        match = re.match(r"name:\s*['\"]?([^'\"\s]+)", line)
        if match:
            return match.group(1)
    return None


def scan(set_dir: Path, checkouts: dict[str, Path]) -> list[tuple[str, ...]]:
    # Lock names come from SKILL.md frontmatter and may differ from the
    # folder (vercel-composition-patterns lives in composition-patterns), so
    # vendored skills match by path. Source casing varies between entries.
    entries = lock_entries(set_dir)
    excluded = load_exclusions(set_dir)
    checkouts = {s.lower(): p for s, p in checkouts.items()}
    scope: dict[str, set[PurePosixPath]] = {}
    vendored: dict[str, set[str]] = {}
    for entry in entries.values():
        source = entry["source"].lower()
        scope.setdefault(source, set()).add(parent_of(entry["skillPath"]))
        vendored.setdefault(source, set()).add(entry["skillPath"])

    missing = sorted(set(scope) - set(checkouts))
    if missing:
        raise SystemExit(f"no --checkout for source(s): {', '.join(missing)}")

    findings: list[tuple[str, ...]] = []
    seen: set[str] = set()
    for source in sorted(scope):
        for rel in upstream_skills(checkouts[source]):
            if rel.parent.parent not in scope[source]:
                continue
            names = {rel.parent.name}
            fm = frontmatter_name(checkouts[source] / rel)
            if fm:
                names.add(fm)
            seen |= names
            if str(rel) in vendored[source] or names & set(excluded):
                continue
            findings.append(("candidate", source, fm or rel.parent.name, str(rel)))

    for name in sorted(excluded):
        if name not in seen:
            findings.append(("stale-exclusion", name))

    skills_root = set_dir / ".agents/skills"
    for name in sorted(set(excluded) & seen):
        naming = sorted(
            d.name
            for d in skills_root.iterdir()
            if d.is_dir()
            and any(
                references(f.read_text(encoding="utf-8", errors="ignore"), name)
                for f in d.rglob("*.md")
            )
        )
        if naming:
            findings.append(("referenced-exclusion", name, " ".join(naming)))
    return findings


def parse_checkout(value: str) -> tuple[str, Path]:
    source, sep, path = value.partition("=")
    if not sep or not source or not path:
        raise argparse.ArgumentTypeError("expected SOURCE=PATH")
    return source, Path(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_check = sub.add_parser("check")
    p_check.add_argument("vendor_root", nargs="?", type=Path, default=DEFAULT_VENDOR)
    p_scan = sub.add_parser("scan")
    p_scan.add_argument("set_dir", type=Path)
    p_scan.add_argument("--checkout", action="append", type=parse_checkout, default=[])
    args = parser.parse_args(argv)

    if args.cmd == "check":
        return check(args.vendor_root)
    for row in scan(args.set_dir, dict(args.checkout)):
        print("\t".join(row))
    return 0


if __name__ == "__main__":
    sys.exit(main())
