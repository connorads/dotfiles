#!/usr/bin/env python3
"""Claude Code hook to nudge npm/npx towards pnpm.

AGENTS.md: "Never use npm or npx; use pnpm or pnpm dlx." This turns that
convention into a soft prompt: dependency-mutating npm verbs and bare npx
(fetch-and-run) return permissionDecision "ask" with the pnpm equivalent, so an
npm-locked project still works behind one confirmation.

Deliberately narrow:
  - nudges: npm install/i/add/ci/update/up/exec/dedupe, and any npx invocation
  - leaves alone: npm run/test/start/ls/view/audit/config/... (local scripts and
    read-only ops), since those carry no fetch/supply-chain cost

Note: an "ask" here overrides a matching permissions.allow rule (same mechanism
guard-mutating-api.py uses). So allow-listed tools like `npx convex` will prompt.
If that friction outweighs the nudge, set NUDGE_NPX = False below.

Exit codes:
  0 - Always

Output:
  JSON with permissionDecision "ask" (+ reason) for npm/npx, else nothing.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_prefer_pnpm.py -v
"""

from __future__ import annotations

import json
import re
import shlex
import sys

# Set False to stop nudging npx (keeps the npm dependency-verb nudge).
NUDGE_NPX = True

# Commands where npm/npx may appear in quoted args (e.g. commit messages) - skip.
NOT_PKG_CMD_RE = re.compile(r"\b(?:git|dotfiles)\b.*\bcommit\b")

COMMAND_SEPARATORS = {";", "&&", "||", "|"}

# npm subcommands that fetch or mutate dependencies -> nudge to pnpm.
# Read-only/script-running verbs (run, test, start, ls, view, ...) are omitted.
NUDGE_NPM_SUBCMDS = frozenset({"install", "i", "add", "ci", "update", "up", "exec", "dedupe"})

# pnpm equivalent shown in the prompt.
PNPM_EQUIV = {
    "install": "pnpm install",
    "i": "pnpm add",
    "add": "pnpm add",
    "ci": "pnpm install --frozen-lockfile",
    "update": "pnpm update",
    "up": "pnpm update",
    "exec": "pnpm exec / pnpm dlx",
    "dedupe": "pnpm dedupe",
}


def _segments(tokens: list[str]) -> list[list[str]]:
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


def _strip_env_prefix(segment: list[str]) -> list[str]:
    i = 0
    while i < len(segment) and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", segment[i]):
        i += 1
    return segment[i:]


def _first_subcommand(command: list[str]) -> str | None:
    """First non-flag argument after the command name."""
    for tok in command[1:]:
        if not tok.startswith("-"):
            return tok
    return None


def nudge_reason(command: str) -> str | None:
    """Return a pnpm suggestion if the command uses npm/npx in a nudged way."""
    if NOT_PKG_CMD_RE.search(command):
        return None
    if not re.search(r"(?:^|[|;&])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:npm|npx)\b", command):
        return None

    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        return None

    for segment in _segments(tokens):
        command_tokens = _strip_env_prefix(segment)
        if not command_tokens:
            continue
        head = command_tokens[0]

        if head == "npx" and NUDGE_NPX:
            return "Prefer `pnpm dlx` over npx (AGENTS.md)"

        if head == "npm":
            sub = _first_subcommand(command_tokens)
            if sub in NUDGE_NPM_SUBCMDS:
                return f"Prefer pnpm over npm (AGENTS.md): use `{PNPM_EQUIV[sub]}`"

    return None


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    command = input_data.get("tool_input", {}).get("command", "")
    if not command:
        return 0

    reason = nudge_reason(command)
    if reason:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": (
                    f"{reason}. If this project is npm-locked, confirm to proceed."
                ),
            }
        }
        json.dump(output, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
