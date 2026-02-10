# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for guard-mutating-api hook."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

# Import the module under test (filename has hyphens)
_spec = importlib.util.spec_from_file_location(
    "guard_mutating_api", Path(__file__).parent / "guard-mutating-api.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
is_mutating_gh_api = _mod.is_mutating_gh_api


# --- is_mutating_gh_api ---


class TestIsMutatingGhApi:
    @pytest.mark.parametrize(
        "command",
        [
            # Explicit -X / --method with mutating verbs
            "gh api repos/foo/bar -X POST",
            "gh api repos/foo/bar -XPOST",
            "gh api repos/foo/bar -X PUT",
            "gh api repos/foo/bar -X PATCH",
            "gh api repos/foo/bar -X DELETE",
            "gh api repos/foo/bar --method POST",
            "gh api repos/foo/bar --method=POST",
            "gh api repos/foo/bar --method PUT",
            "gh api repos/foo/bar --method=DELETE",
            "gh api repos/foo/bar -X post",
            "gh api repos/foo/bar --method=patch",
            'gh api repos/foo/bar -X POST -f body="hello"',
            'gh api -X POST repos/foo/bar -f body="hello"',
            # Implicit POST via -f / -F / --raw-field / --field / --input
            "gh api repos/foo/bar/issues/1/comments -f body='hello'",
            "gh api repos/foo/bar/issues -f title='bug' -f body='desc'",
            "gh api gists -F 'files[f.txt][content]=@f.txt'",
            "gh api repos/foo/bar/issues --field title=bug",
            "gh api repos/foo/bar/issues --field=title=bug",
            "gh api repos/foo/bar/issues --raw-field body=hello",
            "gh api repos/foo/bar/issues --raw-field=body=hello",
            "gh api repos/foo/bar/rulesets --input payload.json",
            "gh api repos/foo/bar/rulesets --input=payload.json",
            "gh api repos/foo/bar/issues/1/comments --input -",
        ],
    )
    def test_detects_mutating_calls(self, command: str) -> None:
        assert is_mutating_gh_api(command) is True

    @pytest.mark.parametrize(
        "command",
        [
            "gh api repos/foo/bar/releases --jq '.[0].tag_name'",
            "gh api repos/foo/bar",
            "gh api /user",
            "gh api repos/foo/bar -X GET",
            "gh api repos/foo/bar --method GET",
            "gh api --help",
            "gh api repos/foo/bar --paginate",
            "gh api repos/foo/bar -H 'Accept: application/json'",
        ],
    )
    def test_allows_read_only_calls(self, command: str) -> None:
        assert is_mutating_gh_api(command) is False

    @pytest.mark.parametrize(
        "command",
        [
            "git commit -m 'fix'",
            "ls -la",
            "echo hello",
            "gh pr view 123",
            "gh issue list",
        ],
    )
    def test_ignores_non_gh_api_commands(self, command: str) -> None:
        assert is_mutating_gh_api(command) is False


# --- Integration test via subprocess ---


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "guard-mutating-api.py")

    def _run(self, tool_input_command: str) -> subprocess.CompletedProcess[str]:
        payload = json.dumps({"tool_input": {"command": tool_input_command}})
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )

    def test_mutating_returns_ask(self) -> None:
        r = self._run("gh api repos/foo/bar -X POST")
        assert r.returncode == 0
        output = json.loads(r.stdout)
        assert output["hookSpecificOutput"]["permissionDecision"] == "ask"

    def test_read_only_returns_no_output(self) -> None:
        r = self._run("gh api repos/foo/bar/releases --jq '.[0].tag_name'")
        assert r.returncode == 0
        assert r.stdout == ""

    def test_non_gh_api_returns_no_output(self) -> None:
        r = self._run("gh pr view 123")
        assert r.returncode == 0
        assert r.stdout == ""

    def test_empty_command(self) -> None:
        r = self._run("")
        assert r.returncode == 0
        assert r.stdout == ""

    def test_invalid_json(self) -> None:
        r = subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input="not json",
            capture_output=True,
            text=True,
        )
        assert r.returncode == 0

    def test_method_flag_variants(self) -> None:
        for cmd in [
            "gh api repos/foo/bar -XDELETE",
            "gh api repos/foo/bar --method=PATCH",
            "gh api repos/foo/bar --method PUT",
        ]:
            r = self._run(cmd)
            assert r.returncode == 0
            output = json.loads(r.stdout)
            assert output["hookSpecificOutput"]["permissionDecision"] == "ask", cmd

    def test_implicit_post_via_field_flags(self) -> None:
        for cmd in [
            "gh api repos/foo/bar/issues/1/comments -f body='hi'",
            "gh api gists -F 'files[f][content]=@f'",
            "gh api repos/foo/bar/issues --field title=bug",
            "gh api repos/foo/bar/issues --raw-field body=hi",
            "gh api repos/foo/bar/rulesets --input payload.json",
        ]:
            r = self._run(cmd)
            assert r.returncode == 0
            output = json.loads(r.stdout)
            assert output["hookSpecificOutput"]["permissionDecision"] == "ask", cmd
