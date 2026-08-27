#!/usr/bin/env python3
"""Stop hook: advisory `hk check --unstaged` over what the agent just changed.

Commit-time gating already exists; this closes the window before it. An agent
that leaves trailing whitespace, a curly quote or a shellcheck warning in an
unstaged file has produced work the user is about to read and stage, and today
nothing says so until `dotfiles commit` refuses.

Advisory, never blocking. It prints a systemMessage and exits 0. Exiting 2 would
feed the findings back and make the model keep working, which loops forever on a
finding it cannot fix - a vendored mirror, a half-finished edit, a step whose
tool is missing.

Two environment problems are silence, not findings: a cwd with no discoverable
git repository and a repo with no hk config both make `hk check` exit non-zero
on its own error. This hook fires in every session on this machine, most of them
in repos that have never heard of hk.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

# Steps that run a test suite or evaluate every host configuration. They are
# commit gates - `nix-eval` alone is ~46s and the bats suite is ~2min, against
# ~1s for everything else - and a stop must not stall on them. The rule for a
# new step: if it runs somebody else's test runner, add it here.
SKIP_STEPS = [
    "nix-eval",
    "bats-scoped",
    "ts-tests-scoped",
    "skill-tests",
    "hk-test",
]

# hk's own config search path (src/config.rs `project_config_search_paths()`),
# the same pair Builtins.hk_test globs.
CONFIG_NAMES = ["hk.pkl", ".config/hk.pkl"]

MAX_MESSAGE_CHARS = 2000


def repo_env() -> tuple[Path, dict[str, str]] | None:
    """The work-tree root and any git environment `hk` needs to see it."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(out.stdout.strip()), {}
    except (OSError, subprocess.CalledProcessError):
        pass

    # $HOME is a work-tree with no .git in it - the dotfiles git-dir split. The
    # session cwd is $HOME often enough to be worth naming, and it is the tree
    # this hook most wants to check. Same values the `dhk` wrapper exports.
    home = Path.home()
    git_dir = home / "git" / "dotfiles"
    if git_dir.is_dir() and Path.cwd() == home:
        return home, {"GIT_DIR": str(git_dir), "GIT_WORK_TREE": str(home)}
    return None


def main() -> int:
    # The payload is not used, but leaving it unread can hand the caller EPIPE.
    sys.stdin.read()

    found = repo_env()
    if found is None:
        return 0
    root, git_env = found

    if not any((root / name).exists() for name in CONFIG_NAMES):
        return 0

    env = {**os.environ, **git_env}
    existing = env.get("HK_SKIP_STEPS", "")
    env["HK_SKIP_STEPS"] = ",".join([s for s in [existing, *SKIP_STEPS] if s])

    try:
        result = subprocess.run(
            ["hk", "check", "--unstaged", "--quiet"],
            capture_output=True,
            text=True,
            env=env,
        )
    except OSError:
        return 0  # hk absent: never brick a stop over a checker we cannot run

    if result.returncode == 0:
        return 0

    detail = (result.stdout + result.stderr).strip()
    if len(detail) > MAX_MESSAGE_CHARS:
        detail = detail[:MAX_MESSAGE_CHARS] + "\n[truncated]"

    print(
        json.dumps(
            {
                "systemMessage": f"hk check --unstaged found problems:\n\n{detail}",
                "suppressOutput": True,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
