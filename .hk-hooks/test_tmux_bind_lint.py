# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Pure-core tests for the tmux-bind-lint pre-commit guard.

Manual-only (the repo runs no pytest over .hk-hooks/), like the two parity
checkers: `uv run --with pytest pytest ~/.hk-hooks/test_tmux_bind_lint.py -v`.
The bats suite (~/.config/zsh/tests/tmux-bind-lint.bats) is the automated gate.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

# Import the module under test (filename has a hyphen). Register in sys.modules
# so its slots=True dataclasses resolve their own module during class creation.
_spec = importlib.util.spec_from_file_location(
    "tmux_bind_lint", Path(__file__).parent / "tmux-bind-lint.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
sys.modules["tmux_bind_lint"] = _mod
_spec.loader.exec_module(_mod)


# --- normalise_key ---------------------------------------------------------


class TestNormaliseKey:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("'~'", "~"),
            ("'*'", "*"),
            ("'/'", "/"),
            ('"n"', "n"),
            ("n", "n"),
            ("C-l", "C-l"),
            ("M-h", "M-h"),
            ("\\\\", "\\\\"),  # escaped backslash key - left as-is
            ("!", "!"),
        ],
    )
    def test_strips_one_quote_layer_keeps_case(self, raw: str, expected: str) -> None:
        assert _mod.normalise_key(raw) == expected

    def test_case_is_significant(self) -> None:
        assert _mod.normalise_key("M-H") != _mod.normalise_key("M-h")


# --- parse_conf: one line form -> (table, key) -----------------------------


def _one(text: str) -> tuple[str, str]:
    bindings = _mod.parse_conf(text)
    assert len(bindings) == 1, f"expected 1 binding, got {bindings}"
    return bindings[0].table, bindings[0].key


class TestParseConf:
    @pytest.mark.parametrize(
        ("line", "expected"),
        [
            # bare bind -> prefix table
            ("bind n next-window", ("prefix", "n")),
            # -N "note" before key (note holds spaces)
            ('bind -N "Next window" n next-window', ("prefix", "n")),
            # -n -> root table
            ("bind -n C-h select-pane -L", ("root", "C-h")),
            # -T <table>
            ("bind -T copy-mode-vi C-l select-pane -R", ("copy-mode-vi", "C-l")),
            # -N note THEN -n (flags in either order)
            ('bind -N "Prev" -n M-H previous-window', ("root", "M-H")),
            # bind-key spelling
            ("bind-key ? display-popup", ("prefix", "?")),
            # single-quoted punctuation key
            ("bind -N 'float' '~' run-shell x", ("prefix", "~")),
            ("bind '*' new-pane", ("prefix", "*")),
            # -r repeat flag (defensive; not in config today)
            ("bind -r H resize-pane -L", ("prefix", "H")),
        ],
    )
    def test_line_forms(self, line: str, expected: tuple[str, str]) -> None:
        assert _one(line) == expected

    def test_trailing_backslash_continuation(self) -> None:
        text = 'bind -N "New worktree" M-w \\\n  command-prompt -p "branch:" "x %%"'
        table, key = _one(text)
        assert (table, key) == ("prefix", "M-w")
        assert _mod.parse_conf(text)[0].line == 1

    def test_command_separator_not_consumed_past_key(self) -> None:
        # `\;` separates commands within one bind; the key is still the first token.
        text = "bind r source-file ~/.config/tmux/tmux.conf \\; display-message done"
        assert _one(text) == ("prefix", "r")

    def test_unbind_is_ignored(self) -> None:
        assert _mod.parse_conf("unbind-key -n M-h") == []
        assert _mod.parse_conf("unbind J") == []

    def test_non_bind_lines_ignored(self) -> None:
        text = "set -g mouse on\n# a comment\nsetw -g mode-keys vi"
        assert _mod.parse_conf(text) == []


# --- find_conflicts --------------------------------------------------------


class TestFindConflicts:
    def test_exact_duplicate_one_finding(self) -> None:
        text = "bind n next-window\nbind -N 'dup' n other-cmd"
        findings = _mod.find_conflicts(_mod.parse_conf(text))
        assert len(findings) == 1
        f = findings[0]
        assert isinstance(f, _mod.Duplicate)
        assert (f.table, f.key, f.lines) == ("prefix", "n", (1, 2))

    def test_same_key_different_tables_no_finding(self) -> None:
        text = "bind -n C-l send-keys\nbind -T copy-mode-vi C-l select-pane -R"
        assert _mod.find_conflicts(_mod.parse_conf(text)) == []

    def test_alias_collision_same_table_one_finding(self) -> None:
        text = "bind Tab last-window\nbind C-i next-window"
        findings = _mod.find_conflicts(_mod.parse_conf(text))
        assert len(findings) == 1
        f = findings[0]
        assert isinstance(f, _mod.AliasCollision)
        assert f.table == "prefix"
        assert {f.key_a, f.key_b} == {"Tab", "C-i"}

    def test_alias_collision_different_tables_no_finding(self) -> None:
        text = "bind Tab last-window\nbind -n C-i next-window"
        assert _mod.find_conflicts(_mod.parse_conf(text)) == []

    def test_clean_config_no_findings(self) -> None:
        text = "bind n next-window\nbind p previous-window\nbind -n C-h select-pane -L"
        assert _mod.find_conflicts(_mod.parse_conf(text)) == []
