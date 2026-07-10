#!/usr/bin/env python3
"""Claude Code hook to steer npm/npx towards pnpm.

AGENTS.md: "Never use npm or npx; use pnpm or pnpm dlx." This turns that
convention into model guidance rather than a human gate: dependency-mutating npm
verbs and bare npx (fetch-and-run) return permissionDecision "deny" with the
pnpm equivalent. The reason is shown to Claude (unlike "ask", whose reason goes
only to the human), so the model reads it and retries with pnpm - no
confirmation prompt, so unattended/background/long-running runs are never
blocked waiting on input.

Escape hatch (model-usable, no human needed): when npm is genuinely required -
e.g. a project with only package-lock.json and no pnpm-lock.yaml, where
`pnpm install --frozen-lockfile` cannot stand in for `npm ci` - re-run the
command with an `NPM_OK=1` env prefix. The hook treats that marker as a
deliberate opt-out and stays silent.

Deliberately narrow:
  - nudges: npm install/i/add/ci/update/up/exec/dedupe, and any npx invocation
  - leaves alone: npm run/test/start/ls/view/audit/config/... (local scripts and
    read-only ops), since those carry no fetch/supply-chain cost

Note: a "deny" here overrides a matching permissions.allow rule and holds even
under bypassPermissions (PreToolUse fires before the permission-mode check). So
allow-listed tools like `npx convex` are blocked in favour of `pnpm dlx convex`.
If that friction outweighs the nudge, set NUDGE_NPX = False below, or use the
NPM_OK=1 escape for a one-off.

Exit codes:
  0 - Always

Output:
  JSON with permissionDecision "deny" (+ reason) for npm/npx, else nothing.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_prefer_pnpm.py -v
"""

from __future__ import annotations

import json
import re
import shlex
import sys

# Set False to stop nudging npx (keeps the npm dependency-verb nudge).
NUDGE_NPX = True

# Env marker the model can prepend to deliberately opt out when npm is genuinely
# required (no human confirmation needed). Any non-falsey value bypasses.
BYPASS_VAR = "NPM_OK"
_BYPASS_FALSEY = frozenset({"", "0", "false", "False", "no"})

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


def _env_assignments(segment: list[str]) -> dict[str, str]:
    """Leading `VAR=value` env prefix of a segment as a dict."""
    envs: dict[str, str] = {}
    for tok in segment:
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", tok)
        if not m:
            break
        envs[m.group(1)] = m.group(2)
    return envs


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
        bypass = _env_assignments(segment).get(BYPASS_VAR)
        if bypass is not None and bypass not in _BYPASS_FALSEY:
            continue
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
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"{reason}. If this project is genuinely npm-locked (no pnpm "
                    f"lockfile), re-run the command with an `{BYPASS_VAR}=1` prefix "
                    f"to bypass."
                ),
            }
        }
        json.dump(output, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
