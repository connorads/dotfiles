# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for the guard-email-egress Claude hook and its _emailegress core."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import _emailegress

ADDR = "sam.example@example.test"
OTHER = "kit@demo.invalid"
EMAILS = frozenset({ADDR, OTHER})


def reason(tool: str, tool_input: dict[str, object]) -> str | None:
    return _emailegress.egress_reason(tool, tool_input, EMAILS)


class TestShellCalls:
    @pytest.mark.parametrize(
        "command",
        [
            f'curl -A "bot ({ADDR})" https://wiki.example/api',
            f"curl -H 'User-Agent: x/1.0 {ADDR}' https://site.example",
            f"wget -U 'x {ADDR}' https://site.example",
            f"curl 'https://api.example/q?contact={ADDR.replace('@', '%40')}'",
            f'curl -d \'{{"email": "{ADDR.upper()}"}}\' https://api.example',
            f"python3 -c \"import requests; requests.get('https://x.example', headers={{'From': '{ADDR}'}})\"",
            f'gh pr create --body "contact {OTHER}"',
            f'curl -A "x {ADDR[:3]}""{ADDR[3:]}" https://site.example',
        ],
    )
    def test_address_with_network_client_denied(self, command: str) -> None:
        assert reason("Bash", {"command": command}) is not None

    @pytest.mark.parametrize(
        "command",
        [
            f"git log --author={ADDR}",
            f"grep -r {ADDR} ./logs",
            "curl -A 'probe/1.0' https://site.example",
            "curl -A 'probe/1.0 someone-else@elsewhere.test' https://site.example",
            "ls -la",
        ],
    )
    def test_local_or_addressless_call_allowed(self, command: str) -> None:
        assert reason("Bash", {"command": command}) is None

    def test_bypass_prefix_allows(self) -> None:
        command = f"EMAIL_OK=1 curl -H 'From: {ADDR}' https://site.example"
        assert reason("Bash", {"command": command}) is None

    def test_reason_does_not_name_the_address(self) -> None:
        r = reason("Bash", {"command": f"curl -A '{ADDR}' https://x.example"})
        assert r is not None
        assert ADDR not in r.lower()
        assert "EMAIL_OK=1" in r


class TestWebTools:
    def test_web_fetch_url_with_address_denied(self) -> None:
        tool_input = {"url": f"https://x.example/?e={ADDR}", "prompt": "summarise"}
        assert reason("WebFetch", tool_input) is not None

    def test_web_search_query_with_address_denied(self) -> None:
        assert reason("WebSearch", {"query": f"who is {OTHER}"}) is not None

    def test_web_fetch_without_address_allowed(self) -> None:
        tool_input = {"url": "https://x.example/", "prompt": "summarise"}
        assert reason("WebFetch", tool_input) is None


class TestAccountEmails:
    @staticmethod
    def _write(path: Path, email: str | None) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data: dict[str, object] = {"numStartups": 1}
        if email is not None:
            data["oauthAccount"] = {"emailAddress": email}
        path.write_text(json.dumps(data))

    def test_reads_default_and_profile_accounts(self, tmp_path: Path) -> None:
        profiles = tmp_path / ".claude-profiles"
        self._write(tmp_path / ".claude.json", "Home@Example.test")
        self._write(profiles / "code" / "a" / ".claude.json", ADDR)
        self._write(profiles / "desktop" / "b" / ".claude.json", None)
        (profiles / "code" / "c").mkdir(parents=True)
        (profiles / "code" / "c" / ".claude.json").write_text("{bad")
        assert _emailegress.account_emails(tmp_path) == {"home@example.test", ADDR}

    def test_no_config_means_no_addresses(self, tmp_path: Path) -> None:
        assert _emailegress.account_emails(tmp_path) == frozenset()


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "guard-email-egress.py")

    def _run(self, home: Path, payload: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
            check=False,
            env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        )

    @pytest.fixture
    def home(self, tmp_path: Path) -> Path:
        (tmp_path / ".claude.json").write_text(json.dumps({"oauthAccount": {"emailAddress": ADDR}}))
        return tmp_path

    def test_leaking_call_returns_deny(self, home: Path) -> None:
        payload = json.dumps(
            {
                "tool_name": "Bash",
                "tool_input": {"command": f"curl -A 'x {ADDR}' https://x.example"},
            }
        )
        r = self._run(home, payload)
        assert r.returncode == 0
        out = json.loads(r.stdout)["hookSpecificOutput"]
        assert out["permissionDecision"] == "deny"
        assert ADDR not in out["permissionDecisionReason"]

    def test_clean_call_returns_no_output(self, home: Path) -> None:
        payload = json.dumps(
            {"tool_name": "Bash", "tool_input": {"command": "curl https://x.example"}}
        )
        r = self._run(home, payload)
        assert r.returncode == 0
        assert r.stdout == ""

    def test_invalid_json(self, home: Path) -> None:
        r = self._run(home, "not json")
        assert r.returncode == 0
        assert r.stdout == ""
