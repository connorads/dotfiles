"""Claude Code hook requiring explicit intent for mutating `gh api` calls.

Delivery shell only: the policy lives in _ghapi (shared with the Codex twin,
mirroring the _secretpaths split), and this module turns its decision into
Claude's permissionDecision JSON.

Exit codes:
  0 - Always

Output:
  JSON with a permissionDecision (+ reason) for flagged calls, else nothing.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_mutating_api.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _ghapi


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    command = input_data.get("tool_input", {}).get("command", "")
    if not command:
        return 0

    decision = _ghapi.gh_api_decision(command)
    if decision is not None:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": decision.permission,
                "permissionDecisionReason": decision.reason,
            }
        }
        json.dump(output, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
