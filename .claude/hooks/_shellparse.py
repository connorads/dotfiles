"""Shared shell-command tokenisation for the Claude Code Bash hooks.

Single home for the lexing helpers the PreToolUse guards previously duplicated
(guard-protection-bypass, prefer-pnpm, guard-mutating-api). Keeping one copy is
itself a security property: a drift in any private copy would silently open a
bypass gap in that one hook.

Not a full shell parser - `shlex` with punctuation_chars keeps quoted
separators inside values, and `command_segments` splits only on the simple
separators. Callers keep their own conservative regex fallback for commands
`tokenise` cannot handle (returns None).

Tests: uv run --with pytest pytest ~/.claude/hooks/test_shellparse.py -v
"""

from __future__ import annotations

import re
import shlex

# Shell command separators that split compound commands. `shlex` keeps quoted
# separators inside values, which is what we need.
COMMAND_SEPARATORS = {";", "&&", "||", "|"}

# Commands where guarded text may appear in quoted args (commit messages) -
# hooks skip these so a message *mentioning* a flag or path never trips a guard.
NOT_COMMIT_RE = re.compile(r"\b(?:git|dotfiles)\b.*\bcommit\b")

_ENV_ASSIGNMENT_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


def tokenise(command: str) -> list[str] | None:
    """Shell-tokenise a command string, or None when it cannot be lexed.

    posix mode with punctuation_chars so `&&`/`||`/`;`/`|` come out as their
    own tokens while quoted values stay whole. `commenters=""` because `#` is
    a legitimate character in arguments (URLs, colours).
    """
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        lexer.commenters = ""
        return list(lexer)
    except ValueError:
        return None


def command_segments(tokens: list[str]) -> list[list[str]]:
    """Split tokens into shell command segments at simple separators."""
    segments: list[list[str]] = []
    current: list[str] = []
    for tok in tokens:
        if tok in COMMAND_SEPARATORS:
            if current:
                segments.append(current)
                current = []
            continue
        current.append(tok)
    if current:
        segments.append(current)
    return segments


def strip_env_prefix(segment: list[str]) -> list[str]:
    """Drop leading VAR=value assignments to reach the real command."""
    i = 0
    while i < len(segment) and _ENV_ASSIGNMENT_RE.match(segment[i]):
        i += 1
    return segment[i:]


def env_assignments(segment: list[str]) -> dict[str, str]:
    """Leading `VAR=value` env prefix of a segment as a dict."""
    envs: dict[str, str] = {}
    for tok in segment:
        m = _ENV_ASSIGNMENT_RE.match(tok)
        if not m:
            break
        envs[m.group(1)] = m.group(2)
    return envs
