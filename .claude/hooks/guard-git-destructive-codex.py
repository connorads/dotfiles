"""Codex hook denying force pushes and recursive force deletes (exit-2 contract).

Same policy core as the Claude twin (guard-git-destructive.py): _destructive
reads past git global options and flag order that Codex prefix rules cannot
see. Only the delivery differs - Codex's reliable block contract is stderr +
exit 2, not Claude's permissionDecision JSON.

Per machine, Codex silently skips this hook until it is trusted via /hooks
in the Codex TUI (trust state is machine-local by the codex-config clean
filter's design).

Exit codes:
  0 - command is fine (or input unparseable)
  2 - command force-pushes or recursively force-deletes; reason on stderr

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
        print(f"This command {reason}", file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
