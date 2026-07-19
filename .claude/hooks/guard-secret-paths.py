#!/usr/bin/env python3
"""Claude Code hook denying Bash access to secret paths.

The static Read()/Edit() deny rules in settings.json cover the built-in file
tools and the small set of Bash file commands Claude recognises (cat, head,
tail, sed) - but not arbitrary subprocesses (xxd, base64, python -c, ...),
and the ~850-entry allowlist globally allows several of those. This hook
closes that gap for Bash: any command whose tokens touch a secret path
(_secretpaths.SECRET_PATHS, the srt denyRead twin) is denied.

Decision is "deny", not "ask": deny is the only decision that holds under
bypassPermissions, and the reason is shown to the model so it can either take
a different route or use the documented escape hatch - re-run with a
`SECRETS_OK=1` env prefix for a deliberate one-off.

Exit codes:
  0 - Always

Output:
  JSON with permissionDecision "deny" (+ reason) for secret-path access,
  else nothing.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_secret_paths.py -v
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
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"This command {reason} (srt denyRead twin; see "
                    "~/.config/srt/AGENTS.md two-layer model). If access is "
                    f"genuinely intended, re-run with a `{_secretpaths.BYPASS_VAR}=1` "
                    "prefix to bypass."
                ),
            }
        }
        json.dump(output, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
