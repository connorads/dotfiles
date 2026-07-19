#!/usr/bin/env python3
"""Claude Code hook to gate commands that disable supply-chain protections.

The dotfiles harden every package manager at the config level: 4-day age-gates
(~/.npmrc min-release-age, pnpm minimumReleaseAge, .bunfig.toml, pip, uv), plus
ignore-scripts/lifecycle-script blocking. AGENTS.md: "Do not disable package
install-script protections globally."

A static permissions.deny glob can't express the arg-level intent that weakens
those controls, so this hook does. It returns permissionDecision "ask" (not
"deny") for commands that re-enable install scripts or zero the age-gate, so
deliberate one-offs (the documented `bun install --minimum-release-age=0`,
`mise upgrade --before 0d`) still work behind a conscious confirmation.

Only segments whose command is a known package manager/tool are inspected, so
`echo "--ignore-scripts=false"` and the same text in a commit message are ignored.

What it flags (per segment, command in TOOLS):
  - re-enabling install scripts: --ignore-scripts=false, --ignore-scripts false,
    --no-ignore-scripts, and the npm_config_ignore_scripts=false env form
  - zeroing the age-gate: --min-release-age / --minimum-release-age /
    --minimum-dependency-age / --before with a 0-ish value (0, 0d, 0s, 0m)
  - enabling npm lifecycle scripts in Deno: --allow-scripts
  - trusting a package to run lifecycle scripts: bun pm trust

Not covered (documented limitation): config-file edits, uv --exclude-newer with a
recent date (ambiguous), yarn age-gate flags, and bypasses hidden behind an
unparseable command (shlex failure) beyond the conservative =glued regex fallback.

Exit codes:
  0 - Always

Output:
  JSON with permissionDecision "ask" (+ reason) for bypass commands, else nothing.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_protection_bypass.py -v
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _shellparse

# Package managers / tools whose flags this hook reasons about. A segment is only
# inspected when its command (after env assignments) is one of these.
TOOLS = frozenset(
    {"npm", "pnpm", "bun", "bunx", "yarn", "npx", "deno", "mise", "uv", "pip", "pip3", "corepack"}
)

# Age-gate flags whose value being ~zero defeats the quarantine.
AGE_FLAGS = frozenset(
    {
        "--min-release-age",
        "--minimum-release-age",
        "--minimumreleaseage",
        "--minimum-dependency-age",
        "--before",
    }
)
# 0, 0d, 0s, 0m, 0days ... - a zero duration in any unit.
ZERO_RE = re.compile(r"^0[a-z]*$", re.IGNORECASE)

# Env-assignment forms that weaken protections, e.g. NPM_CONFIG_IGNORE_SCRIPTS=false.
ENV_IGNORE_SCRIPTS_RE = re.compile(r"^[A-Za-z0-9_]*ignore_scripts=false$", re.IGNORECASE)
ENV_AGE_RE = re.compile(
    r"^[A-Za-z0-9_]*(?:min_release_age|minimum_release_age|minimum_dependency_age)=0[a-z]*$",
    re.IGNORECASE,
)

# Conservative fallback when the command can't be tokenised: only the unambiguous
# =glued forms, so a parse failure never silently misses the obvious bypasses.
FALLBACK_RES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"--ignore-scripts=false\b", re.IGNORECASE), "re-enables install scripts (--ignore-scripts=false)"),
    (re.compile(r"--no-ignore-scripts\b", re.IGNORECASE), "re-enables install scripts (--no-ignore-scripts)"),
    (
        re.compile(r"--(?:min(?:imum)?-release-age|minimum-dependency-age)=0[a-z]*\b", re.IGNORECASE),
        "zeroes the package age-gate",
    ),
)


def _value_of(tokens: list[str], i: int) -> str | None:
    """Glued (--flag=val) or following-token value for the flag at index i."""
    _, sep, glued = tokens[i].partition("=")
    if sep:
        return glued
    return tokens[i + 1] if i + 1 < len(tokens) else None


def _segment_reason(segment: list[str]) -> str | None:
    """Reason string if this command segment disables a protection, else None."""
    for tok in segment:
        if ENV_IGNORE_SCRIPTS_RE.match(tok):
            return "re-enables install scripts via env (ignore_scripts=false)"
        if ENV_AGE_RE.match(tok):
            return "zeroes the package age-gate via env"

    command = _shellparse.strip_env_prefix(segment)
    if not command or command[0] not in TOOLS:
        return None

    if command[0] == "bun" and command[1:3] == ["pm", "trust"]:
        return "trusts a package to run lifecycle scripts (bun pm trust)"

    for i, tok in enumerate(command):
        name = tok.split("=", 1)[0].lower()

        if name == "--ignore-scripts" and (_value_of(command, i) or "").lower() == "false":
            return "re-enables install scripts (--ignore-scripts=false)"
        if name == "--no-ignore-scripts":
            return "re-enables install scripts (--no-ignore-scripts)"

        if name in AGE_FLAGS:
            value = _value_of(command, i)
            if value is not None and ZERO_RE.match(value):
                return "zeroes the package age-gate (e.g. --min-release-age=0 / --before 0d)"

        if command[0] == "deno" and name == "--allow-scripts":
            return "enables npm lifecycle scripts in Deno (--allow-scripts)"

    return None


def bypass_reason(command: str) -> str | None:
    """Return why a command disables a supply-chain protection, or None.

    Inspects only segments whose command is a known package manager, so quoted
    text and commit messages don't trip it.
    """
    if _shellparse.NOT_COMMIT_RE.search(command):
        return None

    tokens = _shellparse.tokenise(command)
    if tokens is None:
        for pattern, reason in FALLBACK_RES:
            if pattern.search(command):
                return reason
        return None

    for segment in _shellparse.command_segments(tokens):
        reason = _segment_reason(segment)
        if reason:
            return reason
    return None


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    command = input_data.get("tool_input", {}).get("command", "")
    if not command:
        return 0

    reason = bypass_reason(command)
    if reason:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": (
                    f"This command {reason}. Supply-chain protections are deliberate "
                    "(AGENTS.md). Confirm only if this bypass is intended."
                ),
            }
        }
        json.dump(output, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
