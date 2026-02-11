#!/usr/bin/env python3
"""
Claude Code PreToolUse hook for Skill permissions.

Trust boundary:
- Skills in ~/.agents/skills/ are auto-allowed.
- All other skills return permissionDecision: "ask".

This lets trusted global skills run without prompts while keeping project-local
skills gated by normal permission checks (and local approvals if already saved).

Tests: uv run --with pytest pytest ~/.claude/hooks/test_allow_global_skills.py -v
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

DEFAULT_GLOBAL_SKILLS_DIR = Path("~/.agents/skills").expanduser()


def get_global_skills_dir() -> Path:
    override = os.getenv("CLAUDE_GLOBAL_SKILLS_DIR")
    if override:
        return Path(override).expanduser()
    return DEFAULT_GLOBAL_SKILLS_DIR


def normalise_skill_name(value: object) -> str | None:
    if not isinstance(value, str):
        return None

    skill_name = value.strip().lstrip("/")
    if skill_name.endswith(":*"):
        skill_name = skill_name[:-2]

    if not skill_name:
        return None

    if "/" in skill_name or "\\" in skill_name:
        return None

    return skill_name


def is_global_skill(skill_name: str, global_skills_dir: Path) -> bool:
    global_root = global_skills_dir.expanduser().resolve()
    candidate = (global_root / skill_name).resolve()

    if candidate == global_root or global_root not in candidate.parents:
        return False

    return candidate.is_dir()


def build_decision_output(decision: str) -> dict[str, dict[str, str]]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
        }
    }


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    if input_data.get("tool_name") != "Skill":
        return 0

    skill_name = normalise_skill_name(input_data.get("tool_input", {}).get("skill"))
    if skill_name is None:
        return 0

    global_skills_dir = get_global_skills_dir()
    permission_decision = (
        "allow" if is_global_skill(skill_name, global_skills_dir) else "ask"
    )
    json.dump(build_decision_output(permission_decision), sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
