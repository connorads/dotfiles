#!/usr/bin/env python3
"""Pre-commit guard: keep every secret-path surface in lock-step with srt.

The srt sandbox policy (~/.config/srt/base.json `denyRead`/`denyWrite`) is the
canonical secret-path list. Three model-layer guards embed it as constants
(static deny rules can't read files, and embedded constants keep the guards
pure and fail-closed), so drift is possible and this checker exists to block
it. It asserts:

  1. Every srt denyRead path has Read() + Edit() deny rules in
     .claude/settings.json, and every denyWrite path has Edit() rules.
     Directories need both the bare form (Read(~/.ssh)) and the contents glob
     (Read(~/.ssh/**)); files (FILE_PATHS) only the bare form.
  2. _secretpaths.py SECRET_PATHS (shared Claude/Codex hook core) covers srt
     denyRead.
  3. The pi guard's SECRET_PATHS (guard.ts, TypeScript twin - extracted from
     the static array literal) covers srt denyRead.
  4. The wiring is intact: guard-secret-paths.py under hooks.PreToolUse
     (matcher Bash) in settings.json, guard-secret-paths-codex.py in
     .codex/hooks.json PreToolUse, and the pi agent-guard extension files
     present.

Exit codes: 0 = parity holds, 1 = a breach (printed to stderr).

Tests: uv run --with pytest pytest ~/.hk-hooks/test_secret_path_parity.py -v
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

# srt paths that are single files: the contents glob (path/**) is meaningless
# for them, so only the bare deny rule is required. Everything else is treated
# as a directory and needs both forms.
FILE_PATHS = frozenset({"~/.netrc", "~/.zshrc.local", "~/.docker/config.json", "~/.zshenv"})

_TS_SECRET_ARRAY_RE = re.compile(
    r"export const SECRET_PATHS = \[(.*?)\] as const;", re.DOTALL
)
_TS_STRING_RE = re.compile(r'"([^"]+)"')


def required_rules(srt_path: str, kind: str) -> list[str]:
    """Deny rules settings.json must carry for one srt path (kind Read/Edit)."""
    rules = [f"{kind}({srt_path})"]
    if srt_path not in FILE_PATHS:
        rules.append(f"{kind}({srt_path}/**)")
    return rules


def check_claude_deny(settings: dict, deny_read: list[str], deny_write: list[str]) -> list[str]:
    deny = set(settings.get("permissions", {}).get("deny", []))
    errors = []
    for path in deny_read:
        for rule in required_rules(path, "Read"):
            if rule not in deny:
                errors.append(f"Claude settings.json deny is missing {rule!r}")
    for path in deny_write:
        for rule in required_rules(path, "Edit"):
            if rule not in deny:
                errors.append(f"Claude settings.json deny is missing {rule!r}")
    return errors


def python_secret_paths(module_path: Path) -> set[str]:
    spec = importlib.util.spec_from_file_location("_secretpaths_under_check", module_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return set(mod.SECRET_PATHS)


def ts_secret_paths(guard_source: str) -> set[str]:
    m = _TS_SECRET_ARRAY_RE.search(guard_source)
    if not m:
        return set()
    return set(_TS_STRING_RE.findall(m.group(1)))


def check_covers(surface: str, covered: set[str], srt_relative: set[str]) -> list[str]:
    missing = srt_relative - covered
    return [f"{surface} is missing srt denyRead path {p!r}" for p in sorted(missing)]


def check_wiring(settings: dict, codex_hooks: dict, paths: dict[str, Path]) -> list[str]:
    errors = []
    claude_wired = any(
        "guard-secret-paths.py" in hook.get("command", "")
        for entry in settings.get("hooks", {}).get("PreToolUse", [])
        if entry.get("matcher") == "Bash"
        for hook in entry.get("hooks", [])
    )
    if not claude_wired:
        errors.append("guard-secret-paths.py is not wired under hooks.PreToolUse (matcher Bash)")

    codex_wired = any(
        "guard-secret-paths-codex.py" in hook.get("command", "")
        for entry in codex_hooks.get("hooks", {}).get("PreToolUse", [])
        for hook in entry.get("hooks", [])
    )
    if not codex_wired:
        errors.append("guard-secret-paths-codex.py is not wired in .codex/hooks.json PreToolUse")

    for name, p in paths.items():
        if not p.exists():
            errors.append(f"{name} is missing ({p})")
    return errors


def _resolve(rel: str) -> Path:
    """Prefer the cwd-relative path (pre-commit runs from $HOME), else $HOME."""
    p = Path(rel)
    return p if p.exists() else Path.home() / rel


def main() -> int:
    srt_path = _resolve(".config/srt/base.json")
    settings_path = _resolve(".claude/settings.json")
    codex_hooks_path = _resolve(".codex/hooks.json")
    secretpaths_path = _resolve(".claude/hooks/_secretpaths.py")
    pi_guard_path = _resolve(".pi/agent/extensions/agent-guard/guard.ts")

    try:
        srt = json.loads(srt_path.read_text())
        settings = json.loads(settings_path.read_text())
        codex_hooks = json.loads(codex_hooks_path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(f"secret-path-parity: cannot read config: {e}", file=sys.stderr)
        return 1

    deny_read = srt["filesystem"]["denyRead"]
    deny_write = srt["filesystem"]["denyWrite"]
    srt_relative = {p.removeprefix("~/") for p in deny_read}

    errors = []
    errors += check_claude_deny(settings, deny_read, deny_write)

    if secretpaths_path.exists():
        errors += check_covers(
            "_secretpaths.py SECRET_PATHS", python_secret_paths(secretpaths_path), srt_relative
        )
    else:
        errors.append(f"_secretpaths.py is missing ({secretpaths_path})")

    if pi_guard_path.exists():
        errors += check_covers(
            "pi guard.ts SECRET_PATHS", ts_secret_paths(pi_guard_path.read_text()), srt_relative
        )
    else:
        errors.append(f"pi guard.ts is missing ({pi_guard_path})")

    errors += check_wiring(
        settings,
        codex_hooks,
        {
            "Claude hook guard-secret-paths.py": _resolve(".claude/hooks/guard-secret-paths.py"),
            "Codex hook guard-secret-paths-codex.py": _resolve(
                ".claude/hooks/guard-secret-paths-codex.py"
            ),
            "pi agent-guard extension index.ts": _resolve(
                ".pi/agent/extensions/agent-guard/index.ts"
            ),
        },
    )

    if errors:
        print("secret-path-parity: drift from srt denyRead/denyWrite:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
