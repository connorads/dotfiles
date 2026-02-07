# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for no-self-attribution hook (strip mode)."""

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

# Import the module under test (filename has hyphens)
_spec = importlib.util.spec_from_file_location(
    "no_self_attribution", Path(__file__).parent / "no-self-attribution.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
clean_git_commit = _mod.clean_git_commit
clean_gh_command = _mod.clean_gh_command
_strip_lines_matching = _mod._strip_lines_matching
_strip_lines_matching_in_command = _mod._strip_lines_matching_in_command
_remove_trailer_args = _mod._remove_trailer_args
_clean_file = _mod._clean_file
COMMIT_PATTERNS = _mod.COMMIT_PATTERNS
GH_PATTERNS = _mod.GH_PATTERNS


# --- _strip_lines_matching ---


class TestStripLinesMatching:
    def test_removes_matching_line(self) -> None:
        text = "feat: stuff\n\nCo-Authored-By: Claude <noreply@anthropic.com>"
        result = _strip_lines_matching(text, COMMIT_PATTERNS)
        assert "Co-Authored-By" not in result
        assert "feat: stuff" in result

    def test_strips_trailing_blank_lines(self) -> None:
        text = "feat: stuff\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n"
        result = _strip_lines_matching(text, COMMIT_PATTERNS)
        assert result == "feat: stuff"

    def test_preserves_non_matching_text(self) -> None:
        text = "feat: stuff\n\nSigned-off-by: Connor"
        result = _strip_lines_matching(text, COMMIT_PATTERNS)
        assert result == text


# --- _remove_trailer_args ---


class TestRemoveTrailerArgs:
    def test_removes_trailer_double_quoted(self) -> None:
        cmd = 'git commit -m "feat" --trailer "Co-Authored-By: Claude <noreply@anthropic.com>"'
        result = _remove_trailer_args(cmd, COMMIT_PATTERNS)
        assert "--trailer" not in result
        assert 'git commit -m "feat"' == result.strip()

    def test_removes_trailer_single_quoted(self) -> None:
        cmd = "git commit -m 'feat' --trailer 'Co-Authored-By: Claude <noreply@anthropic.com>'"
        result = _remove_trailer_args(cmd, COMMIT_PATTERNS)
        assert "--trailer" not in result

    def test_preserves_unrelated_trailer(self) -> None:
        cmd = 'git commit -m "feat" --trailer "Reviewed-by: Alice"'
        result = _remove_trailer_args(cmd, COMMIT_PATTERNS)
        assert result == cmd


# --- _clean_file ---


class TestCleanFile:
    def test_cleans_file_in_place(self) -> None:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False
        ) as f:
            f.write("feat: stuff\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n")
            f.flush()
            assert _clean_file(f.name, COMMIT_PATTERNS) is True
            content = Path(f.name).read_text()
            assert "Co-Authored-By" not in content
            assert "feat: stuff" in content

    def test_returns_false_when_no_match(self) -> None:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False
        ) as f:
            f.write("feat: clean commit\n")
            f.flush()
            assert _clean_file(f.name, COMMIT_PATTERNS) is False

    def test_returns_false_for_missing_file(self) -> None:
        assert _clean_file("/tmp/nonexistent-file-abc123.txt", COMMIT_PATTERNS) is False


# --- clean_git_commit ---


class TestCleanGitCommit:
    @pytest.mark.parametrize(
        "command,expected_absent",
        [
            (
                'git commit -m "feat: stuff\\nCo-Authored-By: Claude <noreply@anthropic.com>"',
                "Co-Authored-By",
            ),
            (
                'git commit -m "feat: stuff\\nCo-Authored-By: claude <noreply@anthropic.com>"',
                "Co-Authored-By",
            ),
            (
                'git commit -m "feat: stuff\\nCo-Authored-By: Anthropic <noreply@anthropic.com>"',
                "Co-Authored-By",
            ),
            (
                'git commit --message="feat: stuff\\nCo-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"',
                "Co-Authored-By",
            ),
            (
                'dotfiles commit -m "feat: stuff\\nCo-Authored-By: Claude <noreply@anthropic.com>"',
                "Co-Authored-By",
            ),
        ],
    )
    def test_strips_attribution_from_inline_message(
        self, command: str, expected_absent: str
    ) -> None:
        result = clean_git_commit(command)
        assert result is not None
        assert expected_absent not in result
        assert "feat: stuff" in result

    def test_strips_trailer_arg(self) -> None:
        cmd = 'git commit -m "feat" --trailer "Co-Authored-By: Claude <noreply@anthropic.com>"'
        result = clean_git_commit(cmd)
        assert result is not None
        assert "--trailer" not in result
        assert "feat" in result

    def test_strips_attribution_from_file(self) -> None:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False
        ) as f:
            f.write("feat: stuff\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n")
            f.flush()
            result = clean_git_commit(f"git commit -F {f.name}")
        assert result is not None
        # File should be cleaned in-place
        content = Path(f.name).read_text()
        assert "Co-Authored-By" not in content

    def test_strips_attribution_from_file_long_flag(self) -> None:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False
        ) as f:
            f.write("Co-Authored-By: Claude <noreply@anthropic.com>\n")
            f.flush()
            result = clean_git_commit(f"git commit --file={f.name}")
        assert result is not None

    def test_strips_from_heredoc(self) -> None:
        cmd = "git commit -m \"$(cat <<'EOF'\nfeat: stuff\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF\n)\""
        result = clean_git_commit(cmd)
        assert result is not None
        assert "Co-Authored-By" not in result

    @pytest.mark.parametrize(
        "command",
        [
            'git commit -m "fix: stuff"',
            'git commit -m "fix: mention Claude in docs"',
            "git status",
            "ls -la",
        ],
    )
    def test_returns_none_for_safe_commands(self, command: str) -> None:
        assert clean_git_commit(command) is None


# --- clean_gh_command ---


class TestCleanGhCommand:
    @pytest.mark.parametrize(
        "command,expected_absent",
        [
            (
                'gh pr create --body "Summary\\n\\n\U0001f916 Generated with [Claude Code](https://claude.ai)"',
                "Generated with",
            ),
            (
                'gh pr create --body "Generated by Claude"',
                "Generated by Claude",
            ),
            (
                'gh pr create --body "\U0001f916 Claude Code"',
                "Claude Code",
            ),
            (
                'gh issue create --body "text\\nGenerated with Claude"',
                "Generated with",
            ),
        ],
    )
    def test_strips_attribution_from_command(
        self, command: str, expected_absent: str
    ) -> None:
        result = clean_gh_command(command)
        assert result is not None
        assert expected_absent not in result

    def test_strips_attribution_from_body_file(self) -> None:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False
        ) as f:
            f.write("## Summary\n\n\U0001f916 Generated with [Claude Code]\n")
            f.flush()
            result = clean_gh_command(
                f"gh pr create --title t --body-file {f.name}"
            )
        assert result is not None
        content = Path(f.name).read_text()
        assert "Generated with" not in content

    @pytest.mark.parametrize(
        "command",
        [
            "gh pr view 123",
            'gh pr create --body "just a normal PR"',
        ],
    )
    def test_returns_none_for_safe_commands(self, command: str) -> None:
        assert clean_gh_command(command) is None


# --- Integration test via subprocess ---


class TestIntegration:
    HOOK_PATH = str(Path(__file__).parent / "no-self-attribution.py")

    def _run(self, tool_input_command: str) -> subprocess.CompletedProcess[str]:
        payload = json.dumps({"tool_input": {"command": tool_input_command}})
        return subprocess.run(
            [sys.executable, self.HOOK_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )

    def test_strips_and_returns_json(self) -> None:
        r = self._run(
            'git commit -m "x\\nCo-Authored-By: Claude <noreply@anthropic.com>"'
        )
        assert r.returncode == 0
        output = json.loads(r.stdout)
        cleaned_cmd = output["hookSpecificOutput"]["updatedInput"]["command"]
        assert "Co-Authored-By" not in cleaned_cmd
        assert output["hookSpecificOutput"]["permissionDecision"] == "allow"

    def test_allows_safe_command_no_output(self) -> None:
        r = self._run('git commit -m "fix: stuff"')
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

    def test_gh_strips_and_returns_json(self) -> None:
        r = self._run(
            'gh pr create --body "Summary\\n\\n\U0001f916 Generated with [Claude Code](https://claude.ai)"'
        )
        assert r.returncode == 0
        output = json.loads(r.stdout)
        cleaned_cmd = output["hookSpecificOutput"]["updatedInput"]["command"]
        assert "Generated with" not in cleaned_cmd
