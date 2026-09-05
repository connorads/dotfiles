"""Shared behavioural fixtures for the Claude and OpenCode security policies."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import _ghapi
import _secretpaths
import pytest


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / filename)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guard_protection_bypass = _load("guard_protection_bypass", "guard-protection-bypass.py")
prefer_pnpm = _load("prefer_pnpm", "prefer-pnpm.py")

FIXTURES = Path.home() / "src/opencode-plugins/fixtures/policy-cases.json"
CASES = json.loads(FIXTURES.read_text())


def _claude_kind(case: dict[str, object]) -> str:
    request = case["request"]
    assert isinstance(request, dict)
    value = request.get("command") if request.get("kind") == "shell" else request.get("path")
    assert isinstance(value, str)
    command = value if request.get("kind") == "shell" else f"cat {value}"
    if _secretpaths.secret_access_reason(command):
        return "deny"
    if _ghapi.gh_api_decision(command, cover_pr_merge=True):
        return "deny"
    if prefer_pnpm.nudge_reason(command):
        return "deny"
    if guard_protection_bypass.bypass_reason(command):
        return "ask"
    return "pass"


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_shared_policy_outcome(case: dict[str, object]) -> None:
    assert _claude_kind(case) == case["decision"]
