#!/usr/bin/env python3
"""Pre-commit guard: no terminal-alias key collisions inside one fzf call.

At the terminal several keys share one byte on the wire - C-i=Tab, C-m=Enter,
C-h=BSpace, C-[=Escape - so an fzf invocation that names both members (one via
`--expect`, the other via `--bind`) is ambiguous: `--expect` wins the keypress
and *accepts* (exits) before the `--bind` action can fire. That is exactly the
skl picker bug where Tab installed the current row instead of marking it,
because the install key was `ctrl-i` and `--expect ctrl-i` beat
`--bind tab:toggle`.

tmux-bind-lint guards the same alias class for tmux key-tables; this is its
sibling for fzf argument strings (a different parsing surface - flag values, not
key-tables - so a separate checker, not an extension). The reusable nugget is
only the four alias pairs, which the codebase re-encodes per checker by design.

Scans a fixed set of roots under $HOME for text files mentioning `fzf`, groups
each backslash-continued invocation into one logical command, and flags a pair
whose two members both appear in that invocation's key set. `enter` alone (no
`ctrl-m`) is legitimate and never flags - the check requires *both* members.

Exit codes: 0 = clean, 1 = at least one alias collision.

Tests:
  bats ~/.config/zsh/tests/fzf-bind-lint.bats            (CLI contract, the gate)
  uv run --with pytest pytest ~/.hk-hooks/test_fzf_bind_lint.py -v   (pure core, manual)
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

# Roots scanned for fzf invocations (cwd-relative first, then $HOME - hk checks
# run from $HOME). Every fzf call in the repo lives under one of these.
ROOTS: tuple[str, ...] = (
    ".config/skl/bin",
    ".config/zsh/functions",
    ".config/tmux/scripts",
)

# Terminal-alias pairs: the canonical control-key and the token(s) that send the
# same byte on the wire. Flag only when the control-key AND one of its aliases
# both appear in a single fzf invocation. Match exact lowercased tokens so
# `btab`/`shift-tab` never counts as `tab`. Mirrors tmux-bind-lint's four pairs;
# not worth a shared file for four static pairs.
ALIAS_PAIRS: tuple[tuple[str, frozenset[str]], ...] = (
    ("ctrl-i", frozenset({"tab"})),
    ("ctrl-m", frozenset({"enter", "return"})),
    ("ctrl-h", frozenset({"bspace", "backspace"})),
    ("ctrl-[", frozenset({"esc", "escape"})),
)


@dataclass(frozen=True, slots=True)
class Invocation:
    """One logical fzf command, with the union of its --expect/--bind keys."""

    line: int
    keys: frozenset[str]


@dataclass(frozen=True, slots=True)
class Collision:
    """Both members of one alias pair named in a single fzf invocation."""

    line: int
    key: str
    alias: str


# --- pure core -------------------------------------------------------------


def _join_continuations(text: str) -> list[tuple[int, str]]:
    """Join backslash-continued physical lines, tagged with their start line.

    An fzf invocation typically spans several lines, each ending in a single
    trailing `\\`. A lone trailing `\\` is unambiguously a continuation.
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


# `--expect VALUE` / `--expect=VALUE` / `--bind ...` - value is bare, single- or
# double-quoted. A bare value runs to the next whitespace.
_FLAG = re.compile(r"--(expect|bind)(?:=|\s+)('[^']*'|\"[^\"]*\"|[^\s]+)")


def _strip_quotes(raw: str) -> str:
    """Strip one layer of surrounding matching quotes."""
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ("'", '"'):
        return raw[1:-1]
    return raw


def _split_top_level(value: str) -> list[str]:
    """Split on commas outside any (), [] or {} - fzf bind actions nest them.

    `enter:execute(echo a,b)` is one entry (the comma is inside parens), not
    two, so its key resolves to `enter`, never `a`/`b`.
    """
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    for ch in value:
        if ch in "([{":
            depth += 1
            buf.append(ch)
        elif ch in ")]}":
            depth = max(0, depth - 1)
            buf.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    return parts


def _expect_keys(value: str) -> set[str]:
    """--expect is a plain comma-separated key list."""
    return {k.strip().lower() for k in value.split(",") if k.strip()}


def _bind_keys(value: str) -> set[str]:
    """--bind key = the token before the first `:` of each top-level entry."""
    keys: set[str] = set()
    for entry in _split_top_level(value):
        head = entry.split(":", 1)[0].strip().lower()
        if head:
            keys.add(head)
    return keys


def parse_invocations(text: str) -> list[Invocation]:
    """Parse each fzf logical command into its --expect/--bind key set."""
    result: list[Invocation] = []
    for line, content in _join_continuations(text):
        if "fzf" not in content:
            continue
        keys: set[str] = set()
        found = False
        for m in _FLAG.finditer(content):
            found = True
            flag, raw = m.group(1), m.group(2)
            value = _strip_quotes(raw)
            keys |= _expect_keys(value) if flag == "expect" else _bind_keys(value)
        if found:
            result.append(Invocation(line=line, keys=frozenset(keys)))
    return result


def find_conflicts(invocations: list[Invocation]) -> list[Collision]:
    """Flag invocations naming both members of a terminal-alias pair."""
    findings: list[Collision] = []
    for inv in invocations:
        for ctrl, aliases in ALIAS_PAIRS:
            if ctrl not in inv.keys:
                continue
            for alias in sorted(aliases):
                if alias in inv.keys:
                    findings.append(Collision(line=inv.line, key=ctrl, alias=alias))
    return findings


def render(file: str, collision: Collision) -> str:
    """Render one collision to a single-line diagnostic message."""
    return (
        f"fzf-bind-lint: {file}:{collision.line} {collision.key} and "
        f"{collision.alias} are the same physical key in one fzf invocation - "
        f"--expect accepts on that key before --bind can fire; use a "
        f"non-aliased key (e.g. alt-)"
    )


# --- imperative shell ------------------------------------------------------


def _resolve(rel: str) -> Path:
    """Prefer the cwd-relative path (hk runs from $HOME), else $HOME."""
    p = Path(rel)
    return p if p.exists() else Path.home() / rel


def _display(path: Path) -> str:
    """Show the path relative to $HOME when possible, else as given."""
    try:
        return str(path.resolve().relative_to(Path.home()))
    except ValueError:
        return str(path)


def main() -> int:
    findings: list[tuple[Path, Collision]] = []
    for rel in ROOTS:
        root = _resolve(rel)
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            try:
                text = path.read_text()
            except (OSError, UnicodeDecodeError):
                continue
            if "fzf" not in text:
                continue
            for collision in find_conflicts(parse_invocations(text)):
                findings.append((path, collision))
    for path, collision in findings:
        print(render(_display(path), collision), file=sys.stderr)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
