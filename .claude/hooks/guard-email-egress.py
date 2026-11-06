"""Claude Code hook denying calls that would send the user's account email out.

Policy lives in _emailegress. Decision is "deny", not "ask": in auto mode an
"ask" goes to the automatic reviewer, which can approve it with nobody
looking. The reason never names the address.

Exit codes:
  0 - Always

Output:
  JSON with permissionDecision "deny" (+ reason) for a leaking call,
  else nothing.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_email_egress.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _emailegress


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    tool_input = input_data.get("tool_input")
    if not isinstance(tool_input, dict):
        return 0

    reason = _emailegress.egress_reason(
        str(input_data.get("tool_name", "")),
        tool_input,
        _emailegress.account_emails(Path.home()),
    )
    if reason:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }
        json.dump(output, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
