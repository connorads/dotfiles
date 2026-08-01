"""Codex hook denying mutating `gh api` calls and PR merges (exit-2 contract).

Same policy core as the Claude twin (guard-mutating-api.py): _ghapi flags Bash
commands that write through `gh api`, with the MUTATE_OK=1 env prefix as the
deliberate opt-out for ordinary writes, and no opt-out for PR merges or
branch-protection writes. Only the delivery differs - Codex's reliable block
contract is stderr + exit 2, not Claude's permissionDecision JSON. Living in
~/.claude/hooks/ is cosmetic: this is where the shared core and its test wiring
already are.

`cover_pr_merge=True` is the one policy difference from the Claude twin. Codex
has no `permissions.ask`, so the `Bash(gh pr merge:*)` ask rule that authorises
merges under Claude does not reach here; without the porcelain in the merge
class, Codex would keep the weaker posture. Consequence worth knowing:
`gh pr merge --help` is refused here too.

Per machine, Codex silently skips this hook until it is trusted via /hooks
in the Codex TUI (trust state is machine-local by the codex-config clean
filter's design).

Exit codes:
  0 - command is fine (or input unparseable)
  2 - command writes through `gh api`, or merges a PR; reason on stderr

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_mutating_api_codex.py -v
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

    decision = _ghapi.gh_api_decision(command, cover_pr_merge=True)
    if decision is not None:
        print(decision.reason, file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
