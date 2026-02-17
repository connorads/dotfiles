# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for allow-local-curl hook."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

# Import the module under test (filename has hyphens)
_spec = importlib.util.spec_from_file_location(
    "allow_local_curl", Path(__file__).parent / "allow-local-curl.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
is_local_curl = _mod.is_local_curl


# --- is_local_curl ---


class TestIsLocalCurl:
    @pytest.mark.parametrize(
        "command",
        [
            # Basic local targets
            "curl http://localhost:3000",
            "curl http://127.0.0.1:8080/api",
            "curl http://[::1]:3000",
            "curl https://localhost/health",
            # POST with data
            "curl -s -X POST http://localhost:3000/api -d '{\"key\":\"val\"}'",
            # Headers before URL
            'curl -H "Content-Type: application/json" http://localhost:3000',
            # Output flag
            "curl -o /tmp/out.json http://localhost:3000/api",
            # Status code check
            "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000",
            # Piped
            "curl http://localhost:3000 | jq .",
            # Chained
            "curl http://localhost:3000 && echo done",
            # Bind-all address
            "curl http://0.0.0.0:8000/",
        ],
    )
    def test_allows_local_targets(self, command: str) -> None:
        assert is_local_curl(command) is True

    @pytest.mark.parametrize(
        "command",
        [
            # Basic remote
            "curl https://evil.com",
            # Mixed local + remote
            "curl http://localhost:3000 https://evil.com",
            # Fragment injection
            "curl https://evil.com#http://localhost:3000",
            # Query param injection
            "curl https://evil.com?redirect=http://localhost:3000",
            # Subdomain containing localhost
            "curl https://localhost.evil.com:3000",
            # localhost as subdomain prefix
            "curl http://localhost.evil.com",
            # IP as subdomain prefix
            "curl http://127.0.0.1.evil.com",
            # DNS override to localhost (URL still says evil.com)
            "curl --resolve evil.com:80:127.0.0.1 http://evil.com",
            # curl --next multi-request with remote
            "curl http://localhost:3000 --next https://evil.com",
            # Hex-encoded 127.0.0.1
            "curl http://0x7f000001:3000",
            # Decimal-encoded 127.0.0.1
            "curl http://2130706433:3000",
            # Octal-encoded 127.0.0.1
            "curl http://0177.0.0.1:3000",
            # Null byte injection
            "curl http://localhost%00.evil.com:3000",
            # Abbreviated loopback
            "curl http://127.1:3000",
            # Backtick command substitution
            "curl `echo https://evil.com`",
            # $() substitution
            "curl $(echo https://evil.com)",
        ],
    )
    def test_rejects_adversarial_and_remote(self, command: str) -> None:
        assert is_local_curl(command) is False

    @pytest.mark.parametrize(
        "command",
        [
            # curl in commit message
            'git commit -m "use curl http://localhost:3000"',
            # curl in dotfiles commit
            'dotfiles commit -m "added curl localhost hook"',
            # Not actually curl
            'echo "curl http://localhost:3000"',
            # No URL
            "curl --version",
            "curl --help",
            # No scheme (can't safely parse)
            "curl localhost:3000",
            # Not curl
            "wget http://localhost:3000",
        ],
    )
    def test_rejects_non_curl_and_no_urls(self, command: str) -> None:
        assert is_local_curl(command) is False

    def test_userinfo_at_trick(self) -> None:
        """curl https://evil.com@localhost:3000 — urlparse says hostname=localhost.

        curl DOES connect to localhost here (evil.com is treated as userinfo).
        So allowing this is technically correct. We document the behaviour.
        """
        assert is_local_curl("curl https://evil.com@localhost:3000") is True


# --- Integration test via subprocess ---


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "allow-local-curl.py")

    def _run(self, tool_input_command: str) -> subprocess.CompletedProcess[str]:
        payload = json.dumps({"tool_input": {"command": tool_input_command}})
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )

    def test_local_returns_allow(self) -> None:
        r = self._run("curl http://localhost:3000")
        assert r.returncode == 0
        output = json.loads(r.stdout)
        assert output["hookSpecificOutput"]["permissionDecision"] == "allow"

    def test_remote_returns_no_output(self) -> None:
        r = self._run("curl https://evil.com")
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
