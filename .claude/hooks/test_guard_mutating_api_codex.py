# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""End-to-end tests for the guard-mutating-api-codex hook (exit-2 contract)."""

import json
import subprocess
import sys
from pathlib import Path

import pytest


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "guard-mutating-api-codex.py")

    def _run(self, command: str) -> subprocess.CompletedProcess[str]:
        payload = json.dumps({"tool_input": {"command": command}})
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_protection_write_exits_2_with_reason(self) -> None:
        r = self._run("gh api -X PUT repos/o/r/rulesets/1 --input a.json")
        assert r.returncode == 2
        assert "no `MUTATE_OK` bypass" in r.stderr
        assert r.stdout == ""

    def test_merge_api_call_exits_2(self) -> None:
        r = self._run("gh api -X PUT repos/o/r/pulls/1002/merge")
        assert r.returncode == 2
        assert "Blocked PR merge" in r.stderr

    @pytest.mark.parametrize(
        "command",
        [
            "gh pr merge 1002 --squash",
            "gh pr merge --squash --delete-branch 1002",
            "MUTATE_OK=1 gh pr merge 1002",
        ],
    )
    def test_gh_pr_merge_exits_2(self, command: str) -> None:
        # Codex has no permissions.ask, so the porcelain has to be covered here.
        r = self._run(command)
        assert r.returncode == 2
        assert "Blocked PR merge" in r.stderr

    def test_ordinary_write_exits_2_naming_the_hatch(self) -> None:
        r = self._run("gh api -X POST repos/o/r/issues/1/comments -f body=hi")
        assert r.returncode == 2
        assert "MUTATE_OK=1" in r.stderr

    def test_hatched_write_exits_0(self) -> None:
        r = self._run("MUTATE_OK=1 gh api -X POST repos/o/r/issues/1/comments -f body=hi")
        assert r.returncode == 0
        assert r.stderr == ""

    @pytest.mark.parametrize(
        "command",
        [
            "gh api repos/o/r/rulesets/1 --jq .name",
            "gh api repos/o/r/releases --method GET",
            "gh pr view 1002 --json mergeable",
            "ls -la",
        ],
    )
    def test_reads_exit_0(self, command: str) -> None:
        r = self._run(command)
        assert r.returncode == 0
        assert r.stderr == ""

    def test_empty_command_exits_0(self) -> None:
        r = self._run("")
        assert r.returncode == 0

    def test_invalid_json_exits_0(self) -> None:
        r = subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input="not json",
            capture_output=True,
            text=True,
            check=False,
        )
        assert r.returncode == 0

    def test_empty_stdin_exits_0(self) -> None:
        # The codex-agent-hooks bats fire() helper runs hooks with /dev/null
        # stdin - a guard must never block on or fail an empty event.
        r = subprocess.run(
            [sys.executable, self.HOOK_PATH],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=False,
        )
        assert r.returncode == 0
