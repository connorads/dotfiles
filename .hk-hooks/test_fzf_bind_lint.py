# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Pure-core tests for the fzf-bind-lint pre-commit guard.

Manual-only (the repo runs no pytest over .hk-hooks/), like the tmux twin:
`uv run --with pytest pytest ~/.hk-hooks/test_fzf_bind_lint.py -v`.
The bats suite (~/.config/zsh/tests/fzf-bind-lint.bats) is the automated gate.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

# Import the module under test (filename has a hyphen). Register in sys.modules
# so its slots=True dataclasses resolve their own module during class creation.
_spec = importlib.util.spec_from_file_location(
    "fzf_bind_lint", Path(__file__).parent / "fzf-bind-lint.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
sys.modules["fzf_bind_lint"] = _mod
_spec.loader.exec_module(_mod)


# --- value extraction: flag forms ------------------------------------------


def _keys(text: str) -> set[str]:
    invs = _mod.parse_invocations(text)
    assert len(invs) == 1, f"expected 1 invocation, got {invs}"
    return set(invs[0].keys)


class TestExtraction:
    @pytest.mark.parametrize(
        ("line", "expected"),
        [
            # --expect: space separator, single-quoted
            ("fzf --expect 'ctrl-y,alt-i'", {"ctrl-y", "alt-i"}),
            # --expect: = separator, bare value
            ("fzf --expect=ctrl-y,ctrl-i", {"ctrl-y", "ctrl-i"}),
            # --expect: double-quoted
            ('fzf --expect "ctrl-m,enter"', {"ctrl-m", "enter"}),
            # --bind: key is the token before the first colon
            ("fzf --bind 'tab:toggle+down,btab:toggle+up'", {"tab", "btab"}),
            # --bind: = separator
            ("fzf --bind=enter:accept", {"enter"}),
            # lowercased on extraction
            ("fzf --expect 'Ctrl-I'", {"ctrl-i"}),
            # both flags union
            (
                "fzf --bind 'tab:toggle' --expect 'ctrl-i'",
                {"tab", "ctrl-i"},
            ),
        ],
    )
    def test_flag_forms(self, line: str, expected: set[str]) -> None:
        assert _keys(line) == expected

    def test_paren_comma_in_bind_action_is_one_entry(self) -> None:
        # The comma inside execute(...) must not split the entry - key is `enter`.
        keys = _keys("fzf --bind 'enter:execute(echo a,b)'")
        assert keys == {"enter"}
        assert "a" not in keys and "b" not in keys

    def test_nested_brackets_in_bind_action(self) -> None:
        keys = _keys("fzf --bind 'ctrl-r:reload[find . ,-type f]+first'")
        assert keys == {"ctrl-r"}

    def test_multiline_continuation_is_one_invocation(self) -> None:
        text = (
            "out=$(skl list \\\n"
            "  | fzf --reverse --multi \\\n"
            "      --bind 'tab:toggle+down,btab:toggle+up' \\\n"
            "      --expect 'ctrl-y,ctrl-i')"
        )
        invs = _mod.parse_invocations(text)
        assert len(invs) == 1
        assert invs[0].line == 1
        assert set(invs[0].keys) == {"tab", "btab", "ctrl-y", "ctrl-i"}

    def test_line_without_fzf_ignored(self) -> None:
        assert _mod.parse_invocations("grep --bind foo") == []

    def test_fzf_line_without_expect_or_bind_ignored(self) -> None:
        assert _mod.parse_invocations("fzf --reverse --multi") == []


# --- find_conflicts --------------------------------------------------------


def _find(text: str) -> list:
    return _mod.find_conflicts(_mod.parse_invocations(text))


class TestFindConflicts:
    def test_ctrl_i_and_tab_flagged(self) -> None:
        findings = _find("fzf --bind 'tab:toggle' --expect 'ctrl-y,ctrl-i'")
        assert len(findings) == 1
        f = findings[0]
        assert (f.key, f.alias) == ("ctrl-i", "tab")

    def test_enter_alone_not_flagged(self) -> None:
        # enter without ctrl-m is legitimate - both members required.
        assert _find("fzf --bind 'enter:accept' --expect 'ctrl-y'") == []

    def test_btab_is_not_tab(self) -> None:
        # btab / shift-tab must never count as tab.
        assert _find("fzf --bind 'btab:toggle+up' --expect 'ctrl-i'") == []

    @pytest.mark.parametrize(
        ("ctrl", "alias"),
        [
            ("ctrl-i", "tab"),
            ("ctrl-m", "enter"),
            ("ctrl-m", "return"),
            ("ctrl-h", "bspace"),
            ("ctrl-h", "backspace"),
            ("ctrl-[", "esc"),
            ("ctrl-[", "escape"),
        ],
    )
    def test_each_pair_flagged(self, ctrl: str, alias: str) -> None:
        findings = _find(f"fzf --bind '{alias}:accept' --expect '{ctrl}'")
        assert len(findings) == 1
        assert (findings[0].key, findings[0].alias) == (ctrl, alias)

    def test_clean_invocation_no_findings(self) -> None:
        assert _find("fzf --bind 'tab:toggle+down,btab:toggle+up' --expect 'ctrl-y,alt-i'") == []


# --- render ----------------------------------------------------------------


def test_render_names_file_line_and_both_keys() -> None:
    c = _mod.Collision(line=36, key="ctrl-i", alias="tab")
    msg = _mod.render(".config/skl/bin/pick", c)
    assert msg.startswith("fzf-bind-lint: .config/skl/bin/pick:36 ")
    assert "ctrl-i" in msg and "tab" in msg
