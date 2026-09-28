# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for the guard-git-destructive hooks (Claude deny JSON, Codex exit 2)."""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from _destructive import destructive_reason

_HOOKS = Path(__file__).parent


class TestBlocks:
    @pytest.mark.parametrize(
        "command",
        [
            "git push --force",
            "git push -f origin main",
            "git -C . push --force",
            "git -c a=b push -f",
            "git --git-dir=/x/.git push --force origin main",
            "git --git-dir /x/.git --work-tree ~ push -f",
            "dotfiles push --force",
            "git push -uf origin main",
            "git push origin +main",
            "cd repo && git -C sub push --force",
            "rm -rf x",
            "rm -fr x",
            "rm -r -f x",
            "rm -R -f x",
            "rm --recursive --force x",
            "FOO=1 rm -f -r x",
        ],
    )
    def test_blocked(self, command: str) -> None:
        assert destructive_reason(command) is not None


class TestAllows:
    @pytest.mark.parametrize(
        "command",
        [
            "git push",
            "git push origin main",
            "git push --force-with-lease",
            "git -C . push --force-with-lease origin main",
            "git push --force-if-includes --force-with-lease",
            "git fetch -f",
            "git -c push.default=current commit -m 'git push --force'",
            "git log --grep=push -f",
            "rm -r x",
            "rm -f x",
            "rm -- -rf",
            "echo rm -rf x",
        ],
    )
    def test_allowed(self, command: str) -> None:
        assert destructive_reason(command) is None


def _run(hook: str, command: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(_HOOKS / hook)],
        input=json.dumps({"tool_input": {"command": command}}),
        capture_output=True,
        text=True,
        check=False,
    )


class TestClaudeDelivery:
    def test_blocked_emits_deny(self) -> None:
        r = _run("guard-git-destructive.py", "git -C . push --force")
        assert r.returncode == 0
        out = json.loads(r.stdout)["hookSpecificOutput"]
        assert out["permissionDecision"] == "deny"
        assert "force" in out["permissionDecisionReason"]

    def test_allowed_is_silent(self) -> None:
        r = _run("guard-git-destructive.py", "git push --force-with-lease")
        assert r.returncode == 0
        assert r.stdout == ""


class TestCodexDelivery:
    def test_blocked_exits_2(self) -> None:
        r = _run("guard-git-destructive-codex.py", "rm -r -f x")
        assert r.returncode == 2
        assert "trash" in r.stderr
        assert r.stdout == ""

    def test_allowed_exits_0(self) -> None:
        r = _run("guard-git-destructive-codex.py", "git push")
        assert r.returncode == 0
        assert r.stderr == ""
