# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""End-to-end tests for the guard-email-egress-codex hook (exit-2 contract)."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

ADDR = "sam.example@example.test"


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "guard-email-egress-codex.py")

    @pytest.fixture
    def home(self, tmp_path: Path) -> Path:
        (tmp_path / ".claude.json").write_text(json.dumps({"oauthAccount": {"emailAddress": ADDR}}))
        return tmp_path

    def _run(self, home: Path, payload: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
            check=False,
            env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        )

    def _bash(self, home: Path, command: str) -> subprocess.CompletedProcess[str]:
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
        return self._run(home, payload)

    def test_leaking_call_exits_2_with_reason(self, home: Path) -> None:
        r = self._bash(home, f"curl -A 'x {ADDR}' https://x.example")
        assert r.returncode == 2
        assert "EMAIL_OK=1" in r.stderr
        assert ADDR not in r.stderr
        assert r.stdout == ""

    def test_bypass_prefix_exits_0(self, home: Path) -> None:
        r = self._bash(home, f"EMAIL_OK=1 curl -H 'From: {ADDR}' https://x.example")
        assert r.returncode == 0
        assert r.stderr == ""

    def test_clean_call_exits_0(self, home: Path) -> None:
        r = self._bash(home, "curl https://x.example")
        assert r.returncode == 0
        assert r.stderr == ""

    def test_invalid_json_exits_0(self, home: Path) -> None:
        r = self._run(home, "not json")
        assert r.returncode == 0
