#!/usr/bin/env python3
"""Pre-commit guard: one quarantine policy, nine spellings, zero drift.

The 4-day supply-chain cooldown is hand-encoded in nine config files across
four time units (days, minutes, seconds, ISO-8601 duration) because every
package manager invents its own key. Nothing else asserts they agree, so a
single-file edit silently forks the policy. This checker parses each spelling,
normalises to days, and fails the commit unless all nine equal EXPECTED_DAYS.

To change the policy: set EXPECTED_DAYS, update all nine configs, done - the
checker tells you which files still disagree. To add a newly gated manager:
append a row to CHECKS (path, key, one-capture regex, unit).

A second, warn-only section greps the docs that cite literal values (AGENTS.md,
the dotfiles-docs supply-chain page) and warns when they no longer contain the
current spellings - documentation staleness never blocks a commit.

Exit codes: 0 = all nine agree, 1 = drift or an unparseable/missing config.

Tests: bats ~/.config/zsh/tests/quarantine-drift.bats
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

EXPECTED_DAYS = 4

UNIT_PER_DAY = {"days": 1, "minutes": 1440, "seconds": 86400}

# (path, key shown in errors, regex with one numeric capture group, unit)
CHECKS: list[tuple[str, str, str, str]] = [
    (".npmrc", "min-release-age", r"^min-release-age=(\d+)", "days"),
    (".config/pnpm/config.yaml", "minimumReleaseAge", r"minimumReleaseAge:\s*(\d+)", "minutes"),
    (".config/pnpm/rc", "minimum-release-age", r"^minimum-release-age=(\d+)", "minutes"),
    (".bunfig.toml", "minimumReleaseAge", r"minimumReleaseAge\s*=\s*(\d+)", "seconds"),
    (".config/uv/uv.toml", "exclude-newer", r'exclude-newer\s*=\s*"(\d+)\s*days?"', "days"),
    (".config/pip/pip.conf", "uploaded-prior-to", r"uploaded-prior-to\s*=\s*P(\d+)D", "days"),
    (".yarnrc.yml", "npmMinimalAgeGate", r"npmMinimalAgeGate:\s*(\d+)d", "days"),
    (".config/mise/config.toml", "minimum_release_age", r'minimum_release_age\s*=\s*"(\d+)d"', "days"),
    (".config/aube/config.toml", "minimumReleaseAge", r"minimumReleaseAge\s*=\s*(\d+)", "minutes"),
]

# Docs that cite literal quarantine values; derived spellings must appear or a
# warning (never a failure) is printed.
DOC_CITES = [
    "AGENTS.md",
    "src/dotfiles-docs/src/content/docs/trust/supply-chain.md",
]


def _resolve(rel: str) -> Path:
    """Prefer the cwd-relative path (pre-commit runs from $HOME), else $HOME."""
    p = Path(rel)
    return p if p.exists() else Path.home() / rel


def check_configs() -> list[str]:
    errors = []
    for rel, key, pattern, unit in CHECKS:
        path = _resolve(rel)
        try:
            text = path.read_text()
        except OSError as e:
            errors.append(f"{rel}: cannot read ({e})")
            continue
        m = re.search(pattern, text, re.MULTILINE)
        if not m:
            errors.append(f"{rel}: {key} not found (regex {pattern!r} matched nothing)")
            continue
        value = int(m.group(1))
        expected = EXPECTED_DAYS * UNIT_PER_DAY[unit]
        if value != expected:
            errors.append(
                f"{rel}: {key} = {value} {unit}"
                f" != expected {expected} {unit} ({EXPECTED_DAYS} days)"
            )
    return errors


def warn_doc_cites() -> None:
    spellings = [
        str(EXPECTED_DAYS * UNIT_PER_DAY["minutes"]),
        str(EXPECTED_DAYS * UNIT_PER_DAY["seconds"]),
        f"P{EXPECTED_DAYS}D",
    ]
    for rel in DOC_CITES:
        path = _resolve(rel)
        try:
            text = path.read_text()
        except OSError:
            print(f"quarantine-drift: warning: doc {rel} unreadable", file=sys.stderr)
            continue
        missing = [s for s in spellings if s not in text]
        if missing:
            print(
                f"quarantine-drift: warning: {rel} no longer cites {', '.join(missing)}"
                " - doc likely stale (warn-only)",
                file=sys.stderr,
            )


def main() -> int:
    errors = check_configs()
    warn_doc_cites()
    if errors:
        print(
            f"quarantine-drift: quarantine values disagree (expected {EXPECTED_DAYS} days):",
            file=sys.stderr,
        )
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
