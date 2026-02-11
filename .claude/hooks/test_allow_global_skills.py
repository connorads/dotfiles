# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for allow-global-skills hook."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "allow_global_skills", Path(__file__).parent / "allow-global-skills.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
build_decision_output = _mod.build_decision_output
is_global_skill = _mod.is_global_skill
normalise_skill_name = _mod.normalise_skill_name


class TestNormaliseSkillName:
    @pytest.mark.parametrize(
        "value,expected",
        [
            ("tmux", "tmux"),
            ("/tmux", "tmux"),
            (" tmux ", "tmux"),
            ("next-best-practices:*", "next-best-practices"),
            ("", None),
            ("/", None),
            ("../evil", None),
            ("nested/skill", None),
            (None, None),
            (123, None),
        ],
    )
    def test_normalises_expected_values(
        self, value: object, expected: str | None
    ) -> None:
        assert normalise_skill_name(value) == expected


class TestIsGlobalSkill:
    def test_returns_true_for_existing_skill_directory(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        (skills_dir / "tmux").mkdir(parents=True)

        assert is_global_skill("tmux", skills_dir) is True

    def test_returns_false_for_missing_skill_directory(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()

        assert is_global_skill("missing", skills_dir) is False

    def test_rejects_path_traversal(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        (tmp_path / "outside").mkdir()

        assert is_global_skill("../outside", skills_dir) is False


class TestBuildDecisionOutput:
    def test_builds_valid_pretooluse_response(self) -> None:
        assert build_decision_output("allow") == {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
            }
        }


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "allow-global-skills.py")

    def _run(
        self, payload: dict[str, object] | str, global_skills_dir: Path
    ) -> subprocess.CompletedProcess[str]:
        if isinstance(payload, str):
            stdin_payload = payload
        else:
            stdin_payload = json.dumps(payload)

        env = {
            **os.environ,
            "CLAUDE_GLOBAL_SKILLS_DIR": str(global_skills_dir),
        }

        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=stdin_payload,
            capture_output=True,
            text=True,
            env=env,
        )

    def test_global_skill_returns_allow(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        (skills_dir / "tmux").mkdir(parents=True)

        r = self._run(
            {"tool_name": "Skill", "tool_input": {"skill": "tmux"}},
            skills_dir,
        )

        assert r.returncode == 0
        output = json.loads(r.stdout)
        assert output["hookSpecificOutput"]["permissionDecision"] == "allow"

    def test_project_skill_returns_ask(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()

        r = self._run(
            {
                "tool_name": "Skill",
                "tool_input": {"skill": "project-only-skill"},
            },
            skills_dir,
        )

        assert r.returncode == 0
        output = json.loads(r.stdout)
        assert output["hookSpecificOutput"]["permissionDecision"] == "ask"

    def test_skill_name_pattern_suffix_is_normalised(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        (skills_dir / "tmux").mkdir(parents=True)

        r = self._run(
            {"tool_name": "Skill", "tool_input": {"skill": "tmux:*"}},
            skills_dir,
        )

        assert r.returncode == 0
        output = json.loads(r.stdout)
        assert output["hookSpecificOutput"]["permissionDecision"] == "allow"

    def test_non_skill_tool_returns_no_output(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()

        r = self._run(
            {"tool_name": "Bash", "tool_input": {"command": "echo hi"}},
            skills_dir,
        )

        assert r.returncode == 0
        assert r.stdout == ""

    def test_invalid_json_does_not_fail(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()

        r = self._run("not json", skills_dir)
        assert r.returncode == 0
        assert r.stdout == ""
