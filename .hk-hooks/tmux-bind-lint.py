#!/usr/bin/env python3
"""Pre-commit guard: no duplicate or alias-colliding tmux binds.

If tmux.conf binds the same key twice in one key-table, tmux silently keeps
only the *last* bind - the earlier one is dead and its help.md row becomes a
lie. tmux-freekeys can't catch this: it queries the running server, which shows
only the surviving bind. This static parse of tmux.conf catches it before the
commit, the commit-time complement to that edit-time advisor.

Two conflicts block the commit:
  - Duplicate: >=2 binds with the same (table, key).
  - Alias collision: a table binds both members of a terminal-alias pair
    (C-i=Tab, C-m=Enter, C-h=BSpace, C-[=Escape - same byte on the wire) via
    different tokens, so the second silently shadows the first.

The same key in *different* tables (C-l in prefix/root/copy-mode-vi) is
legitimate and never flagged - conflicts key on (table, key).

Exit codes: 0 = no conflicts, 1 = a duplicate or alias collision.

Tests:
  bats ~/.config/zsh/tests/tmux-bind-lint.bats            (CLI contract, the gate)
  uv run --with pytest pytest ~/.hk-hooks/test_tmux_bind_lint.py -v   (pure core, manual)
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import assert_never

CONF_REL = ".config/tmux/tmux.conf"

# Terminal-alias pairs: each member sends the same byte on the wire, so binding
# both in one table means the second silently shadows the first. Cross-refs
# tmux-freekeys (~/.config/zsh/functions/tmux/tmux-freekeys), which encodes the
# same four pairs for its edit-time free-key advice - not worth a shared file
# for four static pairs.
ALIAS_PAIRS: tuple[tuple[str, str], ...] = (
    ("C-i", "Tab"),
    ("C-m", "Enter"),
    ("C-h", "BSpace"),
    ("C-[", "Escape"),
)


@dataclass(frozen=True, slots=True)
class Binding:
    """One `bind`/`bind-key` statement, parsed into typed fields."""

    table: str
    key: str
    line: int


@dataclass(frozen=True, slots=True)
class Duplicate:
    table: str
    key: str
    lines: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class AliasCollision:
    table: str
    key_a: str
    key_b: str
    line_a: int
    line_b: int


Finding = Duplicate | AliasCollision


# --- pure core -------------------------------------------------------------


def _join_continuations(text: str) -> list[tuple[int, str]]:
    """Join backslash-continued physical lines, tagged with their start line.

    A physical line whose last non-whitespace char is a single trailing `\\`
    continues onto the next. No real bind line ends in `\\\\`, so a lone
    trailing `\\` is unambiguously a continuation.
    """
    joined: list[tuple[int, str]] = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        start = i + 1  # 1-indexed
        buf = lines[i]
        while buf.rstrip().endswith("\\") and not buf.rstrip().endswith("\\\\"):
            buf = buf.rstrip()[:-1]  # drop the trailing backslash
            i += 1
            if i >= len(lines):
                break
            buf += lines[i]
        joined.append((start, buf))
        i += 1
    return joined


# Flags consumed (in any order) from the front, after the `bind`/`bind-key`:
#   -N "note" / -N 'note'  (quoted, may hold spaces/arrows/·)
#   -T <table>             (named key-table)
#   -n                     (root table; no prefix)
#   -r                     (repeatable; not used today, handled defensively)
_BIND_HEAD = re.compile(r"^\s*bind(?:-key)?\s+")
_FLAG_NOTE = re.compile(r'^-N\s+("[^"]*"|\'[^\']*\')\s+')
_FLAG_TABLE = re.compile(r"^-T\s+(\S+)\s+")
_FLAG_ROOT = re.compile(r"^-n\s+")
_FLAG_REPEAT = re.compile(r"^-r\s+")


def normalise_key(raw: str) -> str:
    """Strip one layer of surrounding matching quotes; preserve case.

    Case matters (`a` != `A`, `M-h` != `M-H`), so it is kept. Single-quoted
    keys (`'~'`, `'*'`, `'/'`) lose their quotes; an escaped backslash (`\\\\`)
    is left as-is (it is the literal key).
    """
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ("'", '"'):
        return raw[1:-1]
    return raw


def parse_conf(text: str) -> list[Binding]:
    """Parse tmux.conf text into typed Bindings (ignores unbind/unbind-key)."""
    bindings: list[Binding] = []
    for line, content in _join_continuations(text):
        head = _BIND_HEAD.match(content)
        if not head:
            continue  # not a bind (unbind/unbind-key excluded by the regex)
        rest = content[head.end() :]

        table = "prefix"
        while True:
            m = _FLAG_NOTE.match(rest)
            if m:
                rest = rest[m.end() :]
                continue
            m = _FLAG_TABLE.match(rest)
            if m:
                table = m.group(1)
                rest = rest[m.end() :]
                continue
            m = _FLAG_ROOT.match(rest)
            if m:
                table = "root"
                rest = rest[m.end() :]
                continue
            m = _FLAG_REPEAT.match(rest)
            if m:
                rest = rest[m.end() :]
                continue
            break

        # Key = first token after the flags. The command follows and is
        # ignored; do NOT split on `\;` (a command separator within one bind).
        token = rest.split(None, 1)[0] if rest.split(None, 1) else ""
        if not token:
            continue
        bindings.append(Binding(table=table, key=normalise_key(token), line=line))
    return bindings


def find_conflicts(bindings: list[Binding]) -> list[Finding]:
    """Report duplicate (table, key) binds and same-table alias collisions."""
    findings: list[Finding] = []

    # Duplicates: >=2 bindings sharing (table, key).
    seen: dict[tuple[str, str], list[int]] = {}
    for b in bindings:
        seen.setdefault((b.table, b.key), []).append(b.line)
    for (table, key), lines in seen.items():
        if len(lines) > 1:
            findings.append(Duplicate(table=table, key=key, lines=tuple(sorted(lines))))

    # Alias collisions: a table binds both members of a pair via different keys.
    by_table: dict[str, dict[str, int]] = {}
    for b in bindings:
        by_table.setdefault(b.table, {}).setdefault(b.key, b.line)
    for table, keys in by_table.items():
        for a, z in ALIAS_PAIRS:
            if a in keys and z in keys:
                findings.append(
                    AliasCollision(
                        table=table,
                        key_a=a,
                        key_b=z,
                        line_a=keys[a],
                        line_b=keys[z],
                    )
                )
    return findings


def render(finding: Finding) -> str:
    """Render one finding to a single-line diagnostic message."""
    match finding:
        case Duplicate(table, key, lines):
            locs = ", ".join(str(n) for n in lines)
            return (
                f"duplicate bind: key {key!r} in table {table!r} bound on lines {locs}"
                f" - tmux keeps only the last"
            )
        case AliasCollision(table, key_a, key_b, line_a, line_b):
            return (
                f"alias collision: {key_a!r} (line {line_a}) and {key_b!r} (line {line_b})"
                f" in table {table!r} send the same byte - the second shadows the first"
            )
        case _:
            assert_never(finding)


# --- imperative shell ------------------------------------------------------


def _resolve(rel: str) -> Path:
    """Prefer the cwd-relative path (pre-commit runs from $HOME), else $HOME."""
    p = Path(rel)
    return p if p.exists() else Path.home() / rel


def main() -> int:
    path = _resolve(CONF_REL)
    try:
        text = path.read_text()
    except OSError as e:
        print(f"tmux-bind-lint: cannot read {CONF_REL} ({e})", file=sys.stderr)
        return 1
    findings = find_conflicts(parse_conf(text))
    for finding in findings:
        print(f"tmux-bind-lint: {render(finding)}", file=sys.stderr)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
