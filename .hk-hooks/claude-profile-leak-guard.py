#!/usr/bin/env python3
"""Block staged Claude profile/auth leaks that can bypass .gitignore via add -f."""
from __future__ import annotations

import re
import subprocess
import sys

PATH_DENY = [
    re.compile(r"(^|/)\.zshrc\.local$"),
    re.compile(r"(^|/)\.secrets(/|$)"),
    re.compile(r"(^|/)\.claude-profiles(/|$)"),
    re.compile(r"(^|/)\.config/claude-profiles(/|$)"),
]

# Vendored third-party skills legitimately document generic auth env names and
# token placeholders (e.g. the claude-api skill's upstream Anthropic docs). Skip
# the generic-pattern checks there, but keep the concrete profile path/alias
# checks: a vendored skill naming a real local profile is an exfiltration signal,
# not documentation. gitleaks still scans these paths for real secrets.
VENDORED_SKILL_PREFIXES = (
    ".config/skills/vendor/",
    ".agents/skills/",
)

# These tracked files intentionally mention the generic launcher/auth patterns.
ALLOW_PATTERN_PATHS = {
    ".config/zsh/functions/claude-code-profile",
    ".config/zsh/functions/claude-desktop-profile",
    ".config/zsh/tests/claude-profile-launchers.bats",
    ".config/zsh/tests/claude-profile-leak-guard.bats",
    ".config/zsh/functions/claude-settings-clean",
    ".hk-hooks/claude-profile-leak-guard.py",
    ".zshrc.local.example",
}

TOKEN_RE = re.compile(r"sk-ant-[A-Za-z0-9_-]+")
AUTH_ENV_RE = re.compile(
    r"\b(?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|"
    r"CLAUDE_CODE_USE_(?:BEDROCK|VERTEX|FOUNDRY))\b"
)
AUTH_ASSIGN_RE = re.compile(
    r"\b(?:export\s+)?(?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|"
    r"CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_(?:BEDROCK|VERTEX|FOUNDRY))\s*="
)
CONCRETE_PROFILE_PATH_RE = re.compile(
    r"\.claude-profiles/(?:desktop|code)/(?![$<{])([A-Za-z0-9][A-Za-z0-9._-]*)"
)
PROFILE_ALIAS_RE = re.compile(
    r"\bclaude-(?:desktop|code)-profile\s+(?![$<{])([A-Za-z0-9][A-Za-z0-9._-]*)"
)


def git_bytes(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


def staged_paths() -> list[str]:
    raw = git_bytes("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR")
    return [p.decode("utf-8", "surrogateescape") for p in raw.split(b"\0") if p]


def added_lines(path: str) -> list[tuple[int, str]]:
    try:
        raw = git_bytes("diff", "--cached", "--unified=0", "--no-ext-diff", "--no-color", "--", path)
    except subprocess.CalledProcessError:
        return []

    lines: list[tuple[int, str]] = []
    for idx, raw_line in enumerate(raw.decode("utf-8", "replace").splitlines(), start=1):
        if raw_line.startswith("+") and not raw_line.startswith("+++"):  # added content, not diff header
            lines.append((idx, raw_line[1:]))
    return lines


def main() -> int:
    failures: list[str] = []

    try:
        paths = staged_paths()
    except (subprocess.CalledProcessError, FileNotFoundError):
        # If git is unavailable, let hk/gitleaks report the environment problem.
        return 0

    for path in paths:
        for pattern in PATH_DENY:
            if pattern.search(path):
                failures.append(f"staged local-only path: {path}")
                break

    for path in paths:
        allow_generic_patterns = path in ALLOW_PATTERN_PATHS or path.startswith(
            VENDORED_SKILL_PREFIXES
        )
        allow_profile_patterns = path in ALLOW_PATTERN_PATHS
        for diff_line, line in added_lines(path):
            where = f"{path}:diff-line-{diff_line}"
            if TOKEN_RE.search(line) and not allow_generic_patterns:
                failures.append(f"{where}: staged Anthropic token pattern (sk-ant-...)")
            if AUTH_ASSIGN_RE.search(line) and not allow_generic_patterns:
                failures.append(f"{where}: staged Claude auth env assignment")
            elif AUTH_ENV_RE.search(line) and not allow_generic_patterns:
                failures.append(f"{where}: staged Claude auth env name")
            if CONCRETE_PROFILE_PATH_RE.search(line) and not allow_profile_patterns:
                failures.append(f"{where}: staged concrete .claude-profiles path")
            if PROFILE_ALIAS_RE.search(line) and not allow_profile_patterns:
                failures.append(f"{where}: staged concrete Claude profile alias/call")

    if failures:
        print("Claude profile leak guard blocked staged content:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        print(
            "Keep real Claude profile names/aliases in ~/.zshrc.local or other ignored local state.",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
