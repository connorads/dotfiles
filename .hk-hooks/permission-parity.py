#!/usr/bin/env python3
"""Pre-commit guard: keep Claude and OpenCode security denies in lock-step.

The two tools keep independent, structurally different *allow* lists (a
convenience, deliberately not generated from one source). Their *deny* rules
are security-relevant and must not silently drift apart. This checker asserts:

  1. Every canonically dangerous command below is denied by BOTH tools, after
     normalising Claude's `Bash(x:*)` syntax against OpenCode's `x*` globs.
  2. No Claude `allow` entry matches an OpenCode `deny` glob (catches the
     realistic "someone slips a dangerous allow into Claude" drift).
  3. The mutating-`gh api` gate is intact: guard-mutating-api.py exists AND is
     wired under hooks.PreToolUse (matcher Bash) in settings.json. OpenCode
     covers the same risk with static `gh api ... -X POST` globs; Claude's hook
     is stricter (it also catches implicit POST via -f/-F/--field/--input), so
     the hook's presence is the parity guarantee here.

Add new dangerous commands to CANONICAL_DANGEROUS; both tools must then cover
them or this check fails.

Exit codes: 0 = parity holds, 1 = a breach (printed to stderr).

Tests: uv run --with pytest pytest ~/.hk-hooks/test_permission_parity.py -v
"""

from __future__ import annotations

import json
import re
import sys
from fnmatch import fnmatch
from pathlib import Path

# Commands dangerous enough that BOTH tools must deny them. The reason is the
# standing justification, kept beside the rule so future edits stay honest.
CANONICAL_DANGEROUS: list[tuple[str, str]] = [
    ("eval", "executes an arbitrary string as code"),
    ("rm -rf", "recursive force delete"),
    ("rm -rf /", "recursive force delete from the filesystem root"),
    ("git add -A", "stages every change, sweeping in unrelated work"),
    ("git add --all", "stages every change, sweeping in unrelated work"),
    ("git add .", "stages every change in the tree"),
    ("git push --force", "overwrites remote history"),
    ("git push --force-with-lease", "rewrites remote history"),
    ("git push -f", "overwrites remote history (force shorthand)"),
]

_CLAUDE_BASH_RE = re.compile(r"^Bash\((.*)\)$", re.DOTALL)


def normalise_claude(entry: str) -> str | None:
    """Reduce a Claude `Bash(cmd:*)` rule to its bare command.

    Returns None for non-Bash entries (e.g. `Read(...)`, `WebFetch`).
    """
    m = _CLAUDE_BASH_RE.match(entry)
    if not m:
        return None
    inner = m.group(1)
    if inner.endswith(":*"):
        inner = inner[:-2]
    return inner


def normalise_opencode(pattern: str) -> str:
    """Reduce an OpenCode `cmd*` glob to its bare command."""
    return pattern[:-1] if pattern.endswith("*") else pattern


def claude_deny_bases(settings: dict) -> set[str]:
    deny = settings.get("permissions", {}).get("deny", [])
    return {b for e in deny if (b := normalise_claude(e)) is not None}


def claude_allow_bases(settings: dict) -> set[str]:
    allow = settings.get("permissions", {}).get("allow", [])
    return {b for e in allow if (b := normalise_claude(e)) is not None}


def _opencode_bash(config: dict) -> dict:
    return config.get("permission", {}).get("bash", {})


def opencode_deny_bases(config: dict) -> set[str]:
    return {normalise_opencode(k) for k, v in _opencode_bash(config).items() if v == "deny"}


def opencode_deny_globs(config: dict) -> list[str]:
    return [k for k, v in _opencode_bash(config).items() if v == "deny"]


def check_canonical_denies(claude_bases: set[str], opencode_bases: set[str]) -> list[str]:
    errors = []
    for cmd, reason in CANONICAL_DANGEROUS:
        if cmd not in claude_bases:
            errors.append(f"Claude does not deny {cmd!r} ({reason})")
        if cmd not in opencode_bases:
            errors.append(f"OpenCode does not deny {cmd!r} ({reason})")
    return errors


def check_allow_not_denied(claude_allow: set[str], opencode_deny_glob_list: list[str]) -> list[str]:
    errors = []
    for base in sorted(claude_allow):
        for glob in opencode_deny_glob_list:
            if fnmatch(base, glob):
                errors.append(f"Claude allows {base!r} which OpenCode denies via {glob!r}")
    return errors


def check_gh_api_gate(settings: dict, hook_exists: bool) -> list[str]:
    errors = []
    if not hook_exists:
        errors.append("guard-mutating-api.py hook file is missing")
    wired = any(
        "guard-mutating-api.py" in hook.get("command", "")
        for entry in settings.get("hooks", {}).get("PreToolUse", [])
        if entry.get("matcher") == "Bash"
        for hook in entry.get("hooks", [])
    )
    if not wired:
        errors.append("guard-mutating-api.py is not wired under hooks.PreToolUse (matcher Bash)")
    return errors


def _resolve(rel: str) -> Path:
    """Prefer the cwd-relative path (pre-commit runs from $HOME), else $HOME."""
    p = Path(rel)
    return p if p.exists() else Path.home() / rel


def main() -> int:
    settings_path = _resolve(".claude/settings.json")
    opencode_path = _resolve(".config/opencode/opencode.json")
    hook_path = _resolve(".claude/hooks/guard-mutating-api.py")

    try:
        settings = json.loads(settings_path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(f"permission-parity: cannot read {settings_path}: {e}", file=sys.stderr)
        return 1
    try:
        opencode = json.loads(opencode_path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(f"permission-parity: cannot read {opencode_path}: {e}", file=sys.stderr)
        return 1

    errors = []
    errors += check_canonical_denies(claude_deny_bases(settings), opencode_deny_bases(opencode))
    errors += check_allow_not_denied(claude_allow_bases(settings), opencode_deny_globs(opencode))
    errors += check_gh_api_gate(settings, hook_path.exists())

    if errors:
        print("permission-parity: security parity breaches:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
