# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""End-to-end tests for the guard-secret-paths-codex hook (exit-2 contract)."""

import json
import subprocess
import sys
from pathlib import Path


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "guard-secret-paths-codex.py")

    def _run(self, command: str) -> subprocess.CompletedProcess[str]:
        payload = json.dumps({"tool_input": {"command": command}})
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )

    def test_secret_read_exits_2_with_reason(self) -> None:
        r = self._run("cat ~/.ssh/id_rsa")
        assert r.returncode == 2
        assert "~/.ssh" in r.stderr
        assert "SECRETS_OK=1" in r.stderr
        assert r.stdout == ""

    def test_bypass_marker_exits_0(self) -> None:
        r = self._run("SECRETS_OK=1 cat ~/.ssh/known_hosts")
        assert r.returncode == 0
        assert r.stderr == ""

    def test_unrelated_command_exits_0(self) -> None:
        r = self._run("ls -la")
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
        )
        assert r.returncode == 0
