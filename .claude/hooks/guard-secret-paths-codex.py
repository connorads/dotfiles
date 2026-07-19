#!/usr/bin/env python3
"""Codex hook denying Bash access to secret paths (exit-2 contract).

Same policy core as the Claude twin (guard-secret-paths.py): _secretpaths
flags any Bash command whose tokens touch a secret path (the srt denyRead
twin), with the SECRETS_OK=1 env prefix as the deliberate opt-out. Only the
delivery differs - Codex's reliable block contract is stderr + exit 2,
not Claude's permissionDecision JSON. Living in ~/.claude/hooks/ is
cosmetic: this is where the shared core and its test wiring already are.

Per machine, Codex silently skips this hook until it is trusted via /hooks
in the Codex TUI (trust state is machine-local by the codex-config clean
filter's design).

Exit codes:
  0 - command is fine (or input unparseable)
  2 - command touches a secret path; reason on stderr

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_secret_paths_codex.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _secretpaths


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    command = input_data.get("tool_input", {}).get("command", "")
    if not command:
        return 0

    reason = _secretpaths.secret_access_reason(command)
    if reason:
        print(
            f"This command {reason} (srt denyRead twin; see "
            "~/.config/srt/AGENTS.md two-layer model). If access is "
            f"genuinely intended, re-run with a `{_secretpaths.BYPASS_VAR}=1` "
            "prefix to bypass.",
            file=sys.stderr,
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
