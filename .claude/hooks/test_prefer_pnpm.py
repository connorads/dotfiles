# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for prefer-pnpm hook."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

# Import the module under test (filename has hyphens)
_spec = importlib.util.spec_from_file_location(
    "prefer_pnpm", Path(__file__).parent / "prefer-pnpm.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
nudge_reason = _mod.nudge_reason


class TestNudges:
    @pytest.mark.parametrize(
        "command",
        [
            "npm install",
            "npm i lodash",
            "npm add -D typescript",
            "npm ci",
            "npm update",
            "npm exec cowsay hi",
            "npx create-vite my-app",
            "npx convex dev",
            "FOO=bar npm install",
            "cd app && npm i",
            "npm install | tee log.txt",
        ],
    )
    def test_nudges(self, command: str) -> None:
        assert nudge_reason(command) is not None


class TestLeavesAlone:
    @pytest.mark.parametrize(
        "command",
        [
            # script-running / read-only npm verbs
            "npm run build",
            "npm test",
            "npm start",
            "npm ls",
            "npm view react version",
            "npm audit",
            "npm config get registry",
            "npm --version",
            # pnpm / bun already preferred
            "pnpm install",
            "pnpm add lodash",
            "pnpm dlx create-vite app",
            "bun install",
            # quoted / commit / echo
            'git commit -m "switch from npm install to pnpm"',
            'dotfiles commit -m "npx note"',
            'echo "run npm install first"',
            # unrelated
            "ls -la",
            "node script.js",
        ],
    )
    def test_no_nudge(self, command: str) -> None:
        assert nudge_reason(command) is None


class TestNpxToggle:
    def test_npx_toggle_off(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(_mod, "NUDGE_NPX", False)
        assert nudge_reason("npx create-vite app") is None
        # npm dependency nudge still fires
        assert nudge_reason("npm install") is not None


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "prefer-pnpm.py")

    def _run(self, command: str) -> subprocess.CompletedProcess[str]:
        payload = json.dumps({"tool_input": {"command": command}})
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )

    def test_nudge_returns_ask(self) -> None:
        r = self._run("npm install")
        assert r.returncode == 0
        out = json.loads(r.stdout)
        assert out["hookSpecificOutput"]["permissionDecision"] == "ask"
        assert out["hookSpecificOutput"]["permissionDecisionReason"]

    def test_run_returns_no_output(self) -> None:
        r = self._run("npm run build")
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
