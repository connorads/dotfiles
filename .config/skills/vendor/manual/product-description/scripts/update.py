#!/usr/bin/env python3
"""Preview or apply a refresh of the product-description skill from its gist.

    python3 scripts/update.py            # preview the diff against upstream
    python3 scripts/update.py --apply    # write the reviewed changes

The gist is flat; the skill is SKILL.md beside references/. This script owns
that mapping so a refresh cannot silently drop a file. An upstream file the
mapping does not name is reported as unmapped rather than ignored: it means
the gist gained a file and this script needs a decision.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GIST_URL = "https://gist.github.com/83ae5c53f2784ebf8f5fe0a3fb94480f.git"
SKILL_DIR = Path(__file__).resolve().parent.parent

# upstream flat name -> path within the skill, relative to SKILL_DIR
MAPPING = {
    "SKILL.md": Path("SKILL.md"),
    **{
        name: Path("references") / name
        for name in (
            "product-kinds.md",
            "README-template.md",
            "goal-template.md",
            "glossary-guide.md",
            "document-template.md",
            "verification-template.md",
            "bug-triage-template.md",
            "check-links.py",
        )
    },
}

# upstream files that are deliberately not vendored: the gist's own README and
# the installer that fetches into ~/.claude/skills (autoload, unreviewed).
NOT_VENDORED = {"README.md", "install.sh"}


def clone(dest: Path) -> str:
    subprocess.run(
        ["git", "clone", "--quiet", "--depth", "1", GIST_URL, str(dest)],
        check=True,
    )
    revision = subprocess.run(
        ["git", "-C", str(dest), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    return revision.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="write the changes (default: preview only)"
    )
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        upstream = Path(tmp) / "gist"
        revision = clone(upstream)
        print(f"upstream revision: {revision}")

        unmapped = sorted(
            path.name
            for path in upstream.iterdir()
            if path.is_file() and path.name not in MAPPING and path.name not in NOT_VENDORED
        )
        changed: list[str] = []
        missing: list[str] = []

        for name, relative in sorted(MAPPING.items()):
            source = upstream / name
            target = SKILL_DIR / relative
            if not source.exists():
                missing.append(name)
                continue
            new = source.read_bytes()
            old = target.read_bytes() if target.exists() else None
            if new == old:
                continue
            changed.append(str(relative))
            if args.apply:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(new)
                shutil.copymode(source, target)

        for label, names in (
            ("changed", changed),
            ("gone upstream", missing),
            ("unmapped upstream file", unmapped),
        ):
            for name in names:
                print(f"{label}: {name}")

        if not (changed or missing or unmapped):
            print("already current")
            return 0
        if changed and not args.apply:
            print("preview only; review the diff, then rerun with --apply")
        if missing or unmapped:
            print("upstream layout moved; update MAPPING before trusting a refresh")
        return 0


if __name__ == "__main__":
    sys.exit(main())
