"""Claude Code hook: a git miss under $HOME does not mean the path is untracked.

The dotfiles repo uses git dir ~/git/dotfiles with work-tree ~, so plain git
under ~ reports "not a git repository" for paths dotfiles tracks. This adds a
note beside the Bash result telling Claude how to check tracking properly.

Events: PostToolUse and PostToolUseFailure (git exits 128), matcher Bash.

Exit codes:
  0 - Always

Tests: uv run --with pytest pytest ~/.claude/hooks/test_dotfiles_tracked_hint.py -v
"""

from __future__ import annotations

import json
import os
import sys

MISS = "not a git repository"
HINT = (
    "Under ~, `not a git repository` does not mean untracked: dotfiles tracks "
    "this work-tree from ~/git/dotfiles. Check with `dotfiles ls-files "
    "--error-unmatch <absolute path>` and commit with `dotfiles`."
)


def under_home(cwd: str, command: str, home: str) -> bool:
    return cwd == home or cwd.startswith(home + "/") or "~/" in command or home + "/" in command


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0
    home = os.environ.get("HOME", "")
    result = json.dumps([payload.get("tool_response"), payload.get("error")])
    if (
        not home
        or MISS not in result
        or not under_home(
            str(payload.get("cwd", "")), str(payload.get("tool_input", {}).get("command", "")), home
        )
    ):
        return 0
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": payload.get("hook_event_name", "PostToolUse"),
                "additionalContext": HINT,
            }
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
