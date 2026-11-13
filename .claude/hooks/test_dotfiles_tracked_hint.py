# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for dotfiles-tracked-hint hook."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

_path = Path(__file__).parent / "dotfiles-tracked-hint.py"

HOME = "/home/user"
FATAL = "fatal: not a git repository (or any of the parent directories): .git"


def run(payload: dict, home: str = HOME) -> str:
    result = subprocess.run(
        [sys.executable, str(_path)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env={"HOME": home},
        check=True,
    )
    return result.stdout


@pytest.mark.parametrize(
    "payload",
    [
        {
            "hook_event_name": "PostToolUseFailure",
            "cwd": f"{HOME}/src/plugins",
            "tool_input": {"command": "git status"},
            "error": f"Exit code 128\n{FATAL}",
        },
        {
            "hook_event_name": "PostToolUse",
            "cwd": "/tmp",
            "tool_input": {"command": "git -C ~/src/plugins log; echo done"},
            "tool_response": {"stdout": "done", "stderr": FATAL},
        },
        {
            "hook_event_name": "PostToolUse",
            "cwd": "/tmp",
            "tool_input": {"command": f"git -C {HOME}/src/plugins status"},
            "tool_response": {"stdout": "", "stderr": FATAL},
        },
    ],
)
def test_hints_when_git_misses_a_home_path(payload: dict) -> None:
    output = json.loads(run(payload))["hookSpecificOutput"]
    assert output["hookEventName"] == payload["hook_event_name"]
    assert "dotfiles ls-files --error-unmatch" in output["additionalContext"]


@pytest.mark.parametrize(
    "payload",
    [
        {
            "hook_event_name": "PostToolUseFailure",
            "cwd": "/tmp/scratch",
            "tool_input": {"command": "git status"},
            "error": FATAL,
        },
        {
            "hook_event_name": "PostToolUse",
            "cwd": f"{HOME}/src/plugins",
            "tool_input": {"command": "git status"},
            "tool_response": {"stdout": "On branch main", "stderr": ""},
        },
        {
            "hook_event_name": "PostToolUse",
            "cwd": f"{HOME}/src/plugins",
            "tool_input": {"command": "grep -r 'not a git repository' docs"},
            "tool_response": {"stdout": "", "stderr": ""},
        },
    ],
)
def test_silent_otherwise(payload: dict) -> None:
    assert run(payload) == ""


def test_silent_on_invalid_json() -> None:
    result = subprocess.run(
        [sys.executable, str(_path)], input="not json", capture_output=True, text=True, check=True
    )
    assert result.stdout == ""
