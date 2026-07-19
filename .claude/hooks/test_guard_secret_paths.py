# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""End-to-end tests for the guard-secret-paths Claude hook."""

import json
import subprocess
import sys
from pathlib import Path


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "guard-secret-paths.py")

    def _run(self, command: str) -> subprocess.CompletedProcess[str]:
        payload = json.dumps({"tool_input": {"command": command}})
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )

    def test_secret_read_returns_deny(self) -> None:
        r = self._run("cat ~/.ssh/id_rsa")
        assert r.returncode == 0
        out = json.loads(r.stdout)
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        reason = out["hookSpecificOutput"]["permissionDecisionReason"]
        # reason must tell the model how to opt out without a human
        assert "SECRETS_OK=1" in reason
        assert "~/.ssh" in reason

    def test_unrecognised_bash_reader_denied(self) -> None:
        # xxd is not in Claude's recognised file-command set, so the static
        # deny rules miss it - this hook is the layer that catches it.
        r = self._run("xxd ~/.aws/credentials")
        assert r.returncode == 0
        assert json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"

    def test_bypass_marker_returns_no_output(self) -> None:
        r = self._run("SECRETS_OK=1 cat ~/.ssh/known_hosts")
        assert r.returncode == 0
        assert r.stdout == ""

    def test_unrelated_command_returns_no_output(self) -> None:
        r = self._run("ls -la")
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
        assert r.stdout == ""
