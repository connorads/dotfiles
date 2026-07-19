# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Characterisation tests for _shellparse (behaviour extracted from the hooks)."""

import pytest

from _shellparse import (
    COMMAND_SEPARATORS,
    NOT_COMMIT_RE,
    command_segments,
    env_assignments,
    strip_env_prefix,
    tokenise,
)


class TestTokenise:
    def test_simple_command(self) -> None:
        assert tokenise("cat file.txt") == ["cat", "file.txt"]

    def test_quoted_value_stays_whole(self) -> None:
        assert tokenise('echo "a && b"') == ["echo", "a && b"]

    def test_separators_are_own_tokens(self) -> None:
        assert tokenise("a && b || c ; d | e") == [
            "a", "&&", "b", "||", "c", ";", "d", "|", "e",
        ]

    def test_hash_is_not_a_comment(self) -> None:
        assert tokenise("curl http://x/#frag") == ["curl", "http://x/#frag"]

    def test_unbalanced_quote_returns_none(self) -> None:
        assert tokenise("echo 'unclosed") is None

    def test_glued_separator_split(self) -> None:
        # punctuation_chars splits glued separators out of words
        assert tokenise("a&&b") == ["a", "&&", "b"]


class TestCommandSegments:
    def test_splits_at_all_separators(self) -> None:
        tokens = ["a", "&&", "b", ";", "c", "|", "d", "||", "e"]
        assert command_segments(tokens) == [["a"], ["b"], ["c"], ["d"], ["e"]]

    def test_no_empty_segments(self) -> None:
        assert command_segments(["&&", "a", ";", ";"]) == [["a"]]

    def test_single_segment(self) -> None:
        assert command_segments(["cat", "f"]) == [["cat", "f"]]

    def test_separator_set(self) -> None:
        assert COMMAND_SEPARATORS == {";", "&&", "||", "|"}


class TestStripEnvPrefix:
    def test_strips_leading_assignments(self) -> None:
        assert strip_env_prefix(["FOO=1", "BAR=x y", "npm", "install"]) == [
            "npm", "install",
        ]

    def test_empty_value_is_assignment(self) -> None:
        assert strip_env_prefix(["NPM_OK=", "npm", "ci"]) == ["npm", "ci"]

    def test_no_assignments(self) -> None:
        assert strip_env_prefix(["ls", "-la"]) == ["ls", "-la"]

    def test_all_assignments(self) -> None:
        assert strip_env_prefix(["A=1", "B=2"]) == []

    def test_invalid_name_not_stripped(self) -> None:
        assert strip_env_prefix(["1AB=x", "cmd"]) == ["1AB=x", "cmd"]


class TestEnvAssignments:
    def test_collects_leading_prefix(self) -> None:
        assert env_assignments(["A=1", "B=two", "cmd", "C=3"]) == {
            "A": "1", "B": "two",
        }

    def test_stops_at_command(self) -> None:
        assert env_assignments(["cmd", "A=1"]) == {}

    def test_empty_value(self) -> None:
        assert env_assignments(["NPM_OK=", "npm"]) == {"NPM_OK": ""}


class TestNotCommitRe:
    @pytest.mark.parametrize(
        "command",
        [
            'git commit -m "switch from npm install to pnpm"',
            'dotfiles commit -m "npx note"',
            "git commit -F - <<'EOF'",
        ],
    )
    def test_commit_commands_match(self, command: str) -> None:
        assert NOT_COMMIT_RE.search(command)

    @pytest.mark.parametrize(
        "command",
        [
            "npm install",
            "git add file.txt",
            'echo "commit this"',
        ],
    )
    def test_non_commit_commands_do_not_match(self, command: str) -> None:
        assert not NOT_COMMIT_RE.search(command)
