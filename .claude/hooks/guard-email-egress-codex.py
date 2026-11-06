"""Codex hook denying calls that would send the user's account email out.

Same policy core as the Claude twin (guard-email-egress.py): _emailegress
flags a call holding one of the user's Claude account addresses plus a
network word. Only the delivery differs - Codex's reliable block contract is
stderr + exit 2, not Claude's permissionDecision JSON. Codex is not handed
the address, but it can still read one from a file or log.

Per machine, Codex silently skips this hook until it is trusted via /hooks
in the Codex TUI.

Exit codes:
  0 - call is fine (or input unparseable)
  2 - call may send an account address; reason on stderr

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_email_egress_codex.py -v
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
        print(reason, file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
