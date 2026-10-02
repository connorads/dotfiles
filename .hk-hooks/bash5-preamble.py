"""Pre-commit guard: every tmux bash script pins its interpreter to bash >= 5.

`#!/usr/bin/env bash` resolves through the caller's PATH, and in the tmux
server's PATH `/bin` precedes the nix profiles. macOS's /bin/bash is 3.2.57
(2007) - no `mapfile`, no `declare -A` - so tmux hands these scripts a shell
that cannot run them. The fix is a re-exec preamble in every entry point and a
version assert in every sourced lib; this checker is what keeps it applied.

Duplicating the preamble across ~27 files is the deliberate trade: "every bash
entry point carries this exact block" is a grep, whereas "no bash 4+ feature
anywhere" needs a real parser - and that is the rule that rotted last time.

Three rules, keyed on the SHEBANG (not the .sh extension - the sh-shebang files
here are genuinely POSIX-clean) except for libs, which key on the directory
(lib/claude-plan.sh carries no shebang at all):

  1. Executable + `#!/usr/bin/env bash` under the three script dirs
     -> must contain the re-exec preamble block.
  2. Anything under scripts/lib/ -> must contain the bash >= 5 assert.
  3. A `sh`-shebang file -> must NOT contain the preamble (an sh script that
     re-execs itself into bash is a mistake, not a hardening).

Exit codes: 0 = every file conforms, 1 = at least one violation.

Tests:
  bats ~/.config/zsh/tests/bash5-preamble.bats
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIRS: tuple[str, ...] = (
    ".config/tmux/scripts",
    ".config/tmux/strategies",
    ".config/tmux/save_command_strategies",
)
LIB_DIR = ".config/tmux/scripts/lib"

BASH_SHEBANG = "#!/usr/bin/env bash"
SH_SHEBANGS = ("#!/bin/sh", "#!/usr/bin/env sh")

# Markers, not the full block: the checker asserts the preamble is PRESENT and
# structurally intact, and leaves its exact wording to shfmt/shellcheck. Each
# marker is a line that cannot survive a partial deletion of the block.
PREAMBLE_MARKERS: tuple[str, ...] = (
    "# --- bash5 re-exec preamble:",
    'if [ "${BASH_VERSINFO[0]:-0}" -lt 5 ]; then',
    'if [ -n "${TMUX_BASH5_REEXEC:-}" ]; then',
    'exec "$_b5" "$0" ${1+"$@"}',
    # Load-bearing: without the unset, a re-exec'd parent silently suppresses a
    # 3.2 child's own re-exec. See .config/tmux/AGENTS.md.
    "unset TMUX_BASH5_REEXEC _b5",
    "# --- end bash5 preamble ---",
)

ASSERT_MARKERS: tuple[str, ...] = (
    # The BASH_VERSION gate is load-bearing, not defensive: zsh callers
    # (agent-teleport, claude-session-adopt) source these libs too, and zsh sets
    # no BASH_VERSINFO, so an ungated assert would refuse to load for them.
    'if [ -n "${BASH_VERSION:-}" ] && [ "${BASH_VERSINFO[0]:-0}" -lt 5 ]; then',
    "requires bash >= 5",
)

PREAMBLE_HEAD = PREAMBLE_MARKERS[0]


# --- functional core -------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Violation:
    path: str
    problem: str


def classify(rel: str, is_exec: bool, first_line: str) -> str:
    """One of: 'lib', 'entrypoint', 'sh', 'ignore'."""
    if rel.startswith(LIB_DIR + "/"):
        return "lib"
    if first_line in SH_SHEBANGS:
        return "sh"
    if is_exec and first_line == BASH_SHEBANG:
        return "entrypoint"
    return "ignore"


def check(rel: str, kind: str, text: str) -> list[Violation]:
    """Apply the rule for `kind` to a file's text."""
    if kind == "entrypoint":
        missing = [m for m in PREAMBLE_MARKERS if m not in text]
        if missing:
            return [
                Violation(
                    rel,
                    "executable bash entry point is missing the bash5 re-exec "
                    f"preamble ({len(missing)} marker(s) absent, first: {missing[0]!r})",
                )
            ]
        return []
    if kind == "lib":
        if any(m not in text for m in ASSERT_MARKERS):
            return [Violation(rel, "sourced lib is missing the `bash >= 5` assert")]
        # A lib is sourced, so `exec` in it would replace the CALLER's process.
        if PREAMBLE_HEAD in text:
            return [Violation(rel, "sourced lib must assert, not re-exec")]
        return []
    if kind == "sh" and PREAMBLE_HEAD in text:
        return [Violation(rel, "sh-shebang script must not carry the bash5 preamble")]
    return []


def render(v: Violation) -> str:
    return f"{v.path}: {v.problem}"


# --- imperative shell ------------------------------------------------------


def _root() -> Path:
    """Pre-commit runs from $HOME; fall back to $HOME when cwd is elsewhere."""
    cwd = Path.cwd()
    return cwd if (cwd / SCRIPT_DIRS[0]).is_dir() else Path.home()


def main() -> int:
    root = _root()
    violations: list[Violation] = []
    seen = 0
    for d in SCRIPT_DIRS:
        base = root / d
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError as e:
                violations.append(Violation(rel, f"cannot read ({e})"))
                continue
            first_line = text.split("\n", 1)[0].rstrip()
            kind = classify(rel, os.access(path, os.X_OK), first_line)
            if kind == "ignore":
                continue
            seen += 1
            violations.extend(check(rel, kind, text))

    for v in violations:
        print(f"bash5-preamble: {render(v)}", file=sys.stderr)
    if not seen:
        print("bash5-preamble: found no files to check", file=sys.stderr)
        return 1
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
