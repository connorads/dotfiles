"""Claude Code hook denying force pushes and recursive force deletes.

The static deny rules match a command prefix, so a git global option
(`git -C . push --force`) or reordered rm flags (`rm -r -f x`) get past them.
_destructive reads the tokens instead. The Codex twin is
guard-git-destructive-codex.py.

Exit codes:
  0 - Always

Output:
  JSON with permissionDecision "deny" (+ reason) for a blocked command, else nothing.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_git_destructive.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _destructive


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    command = input_data.get("tool_input", {}).get("command", "")
    if not command:
        return 0

    reason = _destructive.destructive_reason(command)
    if reason:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": f"This command {reason}",
            }
        }
        json.dump(output, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
