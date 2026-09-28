"""Policy core for the destructive-command guards (Claude and Codex twins).

The static deny rules match a command prefix, so `git -C . push --force`,
`git -c a=b push -f` and `rm -r -f x` slip past `Bash(git push --force:*)` and
`Bash(rm -rf:*)`. This core tokenises each segment, skips git's global options
to reach the subcommand, and reads flags in any order or grouping.

Flags:
  - git/dotfiles push with --force, -f (alone or grouped, e.g. -uf) or a
    `+refspec`. --force-with-lease and --force-if-includes pass.
  - rm with both recursive (-r, -R, --recursive) and force (-f, --force).

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_git_destructive.py -v
"""

from __future__ import annotations

import _shellparse

GIT_COMMANDS = frozenset({"git", "dotfiles"})

# git global options that take the next token as their value.
_GIT_VALUE_OPTS = frozenset(
    {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--exec-path"}
)

FORCE_PUSH_REASON = (
    "force-pushes, which rewrites remote history. Use --force-with-lease only "
    "when the user asks, or ask the user to run the push."
)
RM_REASON = (
    "is a recursive force delete. Outside temporary directories, move the target "
    "with `trash`; inside them, leave it for system cleanup."
)


def _git_subcommand(args: list[str]) -> tuple[str, list[str]] | None:
    """Skip git's global options; return (subcommand, its args)."""
    i = 0
    while i < len(args) and args[i].startswith("-"):
        i += 2 if args[i] in _GIT_VALUE_OPTS else 1
    if i >= len(args):
        return None
    return args[i], args[i + 1 :]


def _is_force_push(args: list[str]) -> bool:
    for arg in args:
        if arg == "--":
            break
        if arg == "--force":
            return True
        if arg.startswith("-") and not arg.startswith("--") and "f" in arg[1:]:
            return True
    return any(arg.startswith("+") for arg in args if arg != "--")


def _is_recursive_force_rm(args: list[str]) -> bool:
    recursive = force = False
    for arg in args:
        if arg == "--":
            break
        if arg == "--recursive":
            recursive = True
        elif arg == "--force":
            force = True
        elif arg.startswith("-") and not arg.startswith("--"):
            recursive = recursive or "r" in arg or "R" in arg
            force = force or "f" in arg
    return recursive and force


def destructive_reason(command: str) -> str | None:
    """Why a command is blocked, or None when it is fine or unparseable."""
    tokens = _shellparse.tokenise(command)
    if tokens is None:
        return None
    for segment in _shellparse.command_segments(tokens):
        argv = _shellparse.strip_env_prefix(segment)
        if not argv:
            continue
        if argv[0] in GIT_COMMANDS:
            sub = _git_subcommand(argv[1:])
            if sub and sub[0] == "push" and _is_force_push(sub[1]):
                return FORCE_PUSH_REASON
        elif argv[0] == "rm" and _is_recursive_force_rm(argv[1:]):
            return RM_REASON
    return None
