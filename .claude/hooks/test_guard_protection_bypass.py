# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for guard-protection-bypass hook."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

# Import the module under test (filename has hyphens)
_spec = importlib.util.spec_from_file_location(
    "guard_protection_bypass", Path(__file__).parent / "guard-protection-bypass.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
bypass_reason = _mod.bypass_reason


# --- bypass_reason: commands that DO disable a protection ---


class TestFlagsBypasses:
    @pytest.mark.parametrize(
        "command",
        [
            # ignore-scripts re-enabled
            "npm install --ignore-scripts=false",
            "npm i --ignore-scripts false",
            "pnpm add foo --no-ignore-scripts",
            "pnpm install --ignore-scripts=false lodash",
            # age-gate zeroed
            "npm install --min-release-age=0",
            "bun install --minimum-release-age=0",
            "bun install --minimum-release-age 0",
            "deno install --minimum-dependency-age=0",
            "mise upgrade --bump --before 0d",
            "mise upgrade --before=0",
            # deno lifecycle scripts
            "deno install --allow-scripts npm:esbuild",
            "deno cache --allow-scripts",
            # bun trust
            "bun pm trust esbuild",
            "bun pm trust --all",
            # env-var forms
            "NPM_CONFIG_IGNORE_SCRIPTS=false npm install",
            "npm_config_ignore_scripts=false pnpm add foo",
            "NPM_CONFIG_MIN_RELEASE_AGE=0 npm i",
            # later in a chain
            "cd repo && npm install --ignore-scripts=false",
        ],
    )
    def test_flags_bypass(self, command: str) -> None:
        assert bypass_reason(command) is not None


# --- bypass_reason: commands that must NOT be flagged ---


class TestAllowsLegitimate:
    @pytest.mark.parametrize(
        "command",
        [
            # normal installs (protections intact)
            "npm install",
            "npm ci",
            "pnpm install",
            "pnpm add lodash",
            "bun install",
            "npm install --save-dev typescript",
            # --ignore-scripts alone means TRUE (protective) - not a bypass
            "npm install --ignore-scripts",
            "npm install --ignore-scripts=true",
            # age flag with a real (non-zero) value
            "mise upgrade --before 4d",
            "git log --before=2024-01-01",
            "git log --before '2 days ago'",
            # bun pm read-only ops
            "bun pm untrusted",
            "bun pm ls",
            # the flag text quoted / in echo / commit messages
            'echo "do not use --ignore-scripts=false"',
            'git commit -m "block --ignore-scripts=false"',
            'dotfiles commit -m "guard --min-release-age=0"',
            # unrelated commands
            "npm run build",
            "ls -la",
            "deno run main.ts",
        ],
    )
    def test_allows(self, command: str) -> None:
        assert bypass_reason(command) is None


# --- Integration test via subprocess ---


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "guard-protection-bypass.py")

    def _run(self, command: str) -> subprocess.CompletedProcess[str]:
        payload = json.dumps({"tool_input": {"command": command}})
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )

    def test_bypass_returns_ask(self) -> None:
        r = self._run("npm install --ignore-scripts=false")
        assert r.returncode == 0
        out = json.loads(r.stdout)
        assert out["hookSpecificOutput"]["permissionDecision"] == "ask"
        assert out["hookSpecificOutput"]["permissionDecisionReason"]

    def test_legit_returns_no_output(self) -> None:
        r = self._run("npm install")
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
