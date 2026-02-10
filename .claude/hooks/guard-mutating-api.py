#!/usr/bin/env python3
"""
Claude Code hook to gate mutating `gh api` calls behind a permission prompt.

Read-only `gh api` calls are auto-allowed via the `Bash(gh api *)` allow rule.
This hook catches both explicit mutating methods (-X/-method POST/PUT/PATCH/DELETE)
and implicit POST triggers (-f, -F, --raw-field, --field, --input) and returns
permissionDecision: "ask" so the user is prompted for confirmation.

gh api switches from GET to POST implicitly when body params or --input are present,
so `gh api repos/o/r/issues/1/comments -f body='hi'` would POST without -X.

Exit codes:
  0 - Always

Output:
  JSON with permissionDecision "ask" for mutating calls, nothing otherwise.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_mutating_api.py -v
"""

from __future__ import annotations

import json
import re
import sys

# HTTP methods considered mutating
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Commands where `gh api` may appear in quoted args (e.g. commit messages) — skip these.
NOT_GH_API_CMD_RE = re.compile(r"\b(?:git|dotfiles)\b.*\bcommit\b")

# Pattern to detect `gh api` (with optional flags before `api`)
GH_API_RE = re.compile(r"\bgh\s+api\b")

# Patterns to extract the HTTP method from -X/--method flags
# Matches: -X POST, -XPOST, --method POST, --method=POST
METHOD_FLAG_RE = re.compile(
    r"(?:-X\s*|--method[\s=])(" + "|".join(MUTATING_METHODS) + r")\b",
    re.IGNORECASE,
)

# Flags that cause gh api to implicitly use POST instead of GET.
# -f/--raw-field and -F/--field add body params; --input pipes a body from file/stdin.
# See: gh api source pkg/cmd/api/api.go — method defaults to POST when params or input present.
IMPLICIT_POST_RE = re.compile(
    r"(?:^|\s)(?:-[fF]\s+|--raw-field[\s=]|--field[\s=]|--input[\s=])"
)


def is_mutating_gh_api(command: str) -> bool:
    """Return True if command is a `gh api` call with a mutating HTTP method.

    Detects both explicit methods (-X POST, --method DELETE) and implicit POST
    via body-param flags (-f, -F, --field, --raw-field, --input).
    """
    if NOT_GH_API_CMD_RE.search(command):
        return False
    if not GH_API_RE.search(command):
        return False
    if METHOD_FLAG_RE.search(command) is not None:
        return True
    return IMPLICIT_POST_RE.search(command) is not None


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    tool_input = input_data.get("tool_input", {})
    command = tool_input.get("command", "")

    if not command:
        return 0

    if is_mutating_gh_api(command):
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
            }
        }
        json.dump(output, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
