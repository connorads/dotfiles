# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""End-to-end tests for the guard-mutating-api hook (JSON-decision contract).

Policy cases live in test_ghapi.py; this file only covers delivery.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "guard-mutating-api.py")

    def _run(self, tool_input_command: str) -> subprocess.CompletedProcess[str]:
        payload = json.dumps({"tool_input": {"command": tool_input_command}})
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_mutating_returns_ask(self) -> None:
        r = self._run("gh api repos/foo/bar -X POST")
        assert r.returncode == 0
        output = json.loads(r.stdout)["hookSpecificOutput"]
        assert output["permissionDecision"] == "ask"
        assert "POST" in output["permissionDecisionReason"]
        assert "write is intended" in output["permissionDecisionReason"]

    @pytest.mark.parametrize(
        "command",
        [
            "gh api repos/makeusabrew/audiotee/git/trees/main --field recursive=1 --jq '.tree[].path'",
            "gh api search/code -f q='repo:cschneegans/unattend-generator arm64' --jq '.total_count'",
            "gh api repos/microsoft/winget-cli/releases -f per_page=10 --jq '.[].tag_name'",
        ],
    )
    def test_implicit_read_queries_are_denied_with_retry_guidance(self, command: str) -> None:
        r = self._run(command)
        assert r.returncode == 0
        output = json.loads(r.stdout)["hookSpecificOutput"]
        assert output["permissionDecision"] == "deny"
        reason = output["permissionDecisionReason"]
        assert "--method GET" in reason
        assert "--method POST" in reason

    @pytest.mark.parametrize(
        "command",
        [
            "gh api repos/makeusabrew/audiotee/git/trees/main --method GET --field recursive=1 --jq '.tree[].path'",
            "gh api --method GET search/code -f q='repo:cschneegans/unattend-generator arm64' --jq '.total_count'",
            "gh api --method GET repos/microsoft/winget-cli/releases -f per_page=10 --jq '.[].tag_name'",
        ],
    )
    def test_explicit_get_corrections_return_no_output(self, command: str) -> None:
        r = self._run(command)
        assert r.returncode == 0
        assert r.stdout == ""

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
            check=False,
        )
        assert r.returncode == 0

    def test_implicit_post_via_field_flags_returns_deny(self) -> None:
        for cmd in [
            "gh api repos/foo/bar/issues/1/comments -f body='hi'",
            "gh api gists -F 'files[f][content]=@f'",
            "gh api repos/foo/bar/issues --field title=bug",
            "gh api repos/foo/bar/issues --raw-field body=hi",
            "gh api repos/foo/bar/rulesets --input payload.json",
        ]:
            r = self._run(cmd)
            assert r.returncode == 0
            output = json.loads(r.stdout)["hookSpecificOutput"]
            assert output["permissionDecision"] == "deny", cmd
            assert "--method GET" in output["permissionDecisionReason"], cmd

    def test_graphql_read_returns_no_output(self) -> None:
        r = self._run("gh api graphql -f query='{ viewer { login } }'")
        assert r.returncode == 0
        assert r.stdout == ""

    @pytest.mark.parametrize(
        "command",
        [
            "gh api graphql -f query='mutation { addStar(input:{}){ id } }'",
            "gh api graphql -f query=@query.graphql",
        ],
    )
    def test_implicit_graphql_writes_return_deny(self, command: str) -> None:
        r = self._run(command)
        assert r.returncode == 0
        output = json.loads(r.stdout)["hookSpecificOutput"]
        assert output["permissionDecision"] == "deny"
        assert "--method POST" in output["permissionDecisionReason"]

    def test_explicit_graphql_post_returns_ask(self) -> None:
        r = self._run("gh api graphql --method POST -f query='mutation { x }'")
        assert r.returncode == 0
        output = json.loads(r.stdout)["hookSpecificOutput"]
        assert output["permissionDecision"] == "ask"
        assert "POST" in output["permissionDecisionReason"]

    def test_implicit_deny_takes_precedence_over_explicit_ask(self) -> None:
        r = self._run("gh api repos/foo/bar --method DELETE; gh api search/code -f q=foo")
        assert r.returncode == 0
        output = json.loads(r.stdout)["hookSpecificOutput"]
        assert output["permissionDecision"] == "deny"
        assert "--method GET" in output["permissionDecisionReason"]

    @pytest.mark.parametrize(
        ("command", "expected"),
        [
            ("gh api repos/foo/bar -X POST 'unterminated", "ask"),
            ("gh api search/code -f q=foo 'unterminated", "deny"),
        ],
    )
    def test_tokenisation_fallback_preserves_decision(self, command: str, expected: str) -> None:
        r = self._run(command)
        assert r.returncode == 0
        output = json.loads(r.stdout)["hookSpecificOutput"]
        assert output["permissionDecision"] == expected
        assert output["permissionDecisionReason"]

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
