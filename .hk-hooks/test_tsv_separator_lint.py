# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Pure-core tests for the tsv-separator-lint pre-commit guard.

Run by `mise run py-checks` (cd .hk-hooks && pytest), and directly with
`uv run --with pytest pytest ~/.hk-hooks/test_tsv_separator_lint.py -v`.
The bats suite (~/.config/zsh/tests/tsv-separator-lint.bats) is the CLI gate.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

# Import the module under test (filename has hyphens). Register in sys.modules
# so its slots=True dataclasses resolve their own module during class creation.
_spec = importlib.util.spec_from_file_location(
    "tsv_separator_lint", Path(__file__).parent / "tsv-separator-lint.py"
)
assert _spec
assert _spec.loader
_mod = importlib.util.module_from_spec(_spec)
sys.modules["tsv_separator_lint"] = _mod
_spec.loader.exec_module(_mod)

TAB = "\t"


# --- read_word -------------------------------------------------------------


class TestReadWord:
    @pytest.mark.parametrize(
        ("line", "expected"),
        [
            ("IFS=$'\\t' read -r a b", "$'\\t'"),
            ("IFS=\"$(printf '\\t')\" read -r a", "\"$(printf '\\t')\""),
            ("IFS=$(printf '\\037') read", "$(printf '\\037')"),
            ('while IFS="$_US" read -r a; do', '"$_US"'),
            ("IFS=, read -r x y", ","),
            ("IFS= read -r line", ""),
            ("IFS=`printf '\\t'` read", "`printf '\\t'`"),
        ],
    )
    def test_word_boundaries(self, line: str, expected: str) -> None:
        start = line.index("IFS=") + len("IFS=")
        assert _mod.read_word(line, start) == expected


# --- value_is_tab ----------------------------------------------------------


class TestValueIsTab:
    @pytest.mark.parametrize(
        "word",
        [
            "$'\\t'",
            "$'\\011'",
            "$'\\x09'",
            "\"$(printf '\\t')\"",
            '$(printf "\\011")',
            "`printf '\\t'`",
            f"'{TAB}'",
            f'"{TAB}"',
            "$'|\\t'",  # a tab anywhere in IFS is enough to collapse
        ],
    )
    def test_tabby(self, word: str) -> None:
        assert _mod.value_is_tab(word)

    @pytest.mark.parametrize(
        "word",
        [
            "$'\\037'",
            "\"$(printf '\\037')\"",
            ",",
            "",
            '"$_US"',
            "'\\t'",  # single quotes: a backslash and a t, not a tab
            "$(printf '\\n')",
        ],
    )
    def test_not_tabby(self, word: str) -> None:
        assert not _mod.value_is_tab(word)


# --- find_tab_ifs ----------------------------------------------------------


class TestFindTabIfs:
    def test_direct_ansi_c(self) -> None:
        findings = _mod.find_tab_ifs("#!/bin/sh\nIFS=$'\\t' read -r a b\n")
        assert [f.line for f in findings] == [2]
        assert isinstance(findings[0], _mod.DirectTab)

    def test_direct_printf(self) -> None:
        text = "#!/bin/sh\nwhile IFS=\"$(printf '\\t')\" read -r a b; do :; done\n"
        assert len(_mod.find_tab_ifs(text)) == 1

    def test_direct_raw_tab(self) -> None:
        assert len(_mod.find_tab_ifs(f"#!/bin/sh\nIFS='{TAB}' read -r a b\n")) == 1

    def test_indirect_via_variable(self) -> None:
        """The spelling the grep-based audit missed: IFS read from `d=$'\\t'`."""
        text = "#!/bin/bash\nd=$'\\t'\nwhile IFS=$d read -r a b; do :; done\n"
        findings = _mod.find_tab_ifs(text)
        assert len(findings) == 1
        f = findings[0]
        assert isinstance(f, _mod.IndirectTab)
        assert (f.line, f.var, f.var_line) == (3, "d", 2)

    def test_indirect_via_quoted_printf_variable(self) -> None:
        text = "#!/bin/sh\n_tab=$(printf '\\011')\nIFS=\"$_tab\" read -r a b\n"
        findings = _mod.find_tab_ifs(text)
        assert len(findings) == 1
        assert isinstance(findings[0], _mod.IndirectTab)

    def test_us_separator_is_clean(self) -> None:
        text = "#!/bin/sh\n_US=$(printf '\\037')\nwhile IFS=\"$_US\" read -r a; do :; done\n"
        assert _mod.find_tab_ifs(text) == []

    def test_other_separators_are_clean(self) -> None:
        text = "#!/bin/sh\nIFS=, read -r x y\nIFS= read -r line\nIFS=' ' read -r w\n"
        assert _mod.find_tab_ifs(text) == []

    def test_comment_lines_are_not_findings(self) -> None:
        """Documenting the rule in a shell comment must not trip it."""
        text = "#!/bin/sh\n# Never write IFS=$'\\t' read here.\nIFS=\"$_US\" read -r a\n"
        assert _mod.find_tab_ifs(text) == []

    def test_a_variable_named_like_ifs_is_not_ifs(self) -> None:
        text = "#!/bin/sh\nOLDIFS=$'\\t'\nIFS=\"$_US\" read -r a\n"
        assert _mod.find_tab_ifs(text) == []

    def test_every_site_in_a_file_is_reported(self) -> None:
        text = "#!/bin/sh\nIFS=$'\\t' read -r a\nIFS=$'\\t' read -r b\n"
        assert [f.line for f in _mod.find_tab_ifs(text)] == [2, 3]


# --- is_shell_file ---------------------------------------------------------


class TestIsShellFile:
    @pytest.mark.parametrize(
        ("name", "text"),
        [
            ("x.sh", "no shebang here\n"),
            ("x.bats", "@test 'a' {\n"),
            ("memwatch", "#!/usr/bin/env zsh\n"),
            ("lib", "# shellcheck shell=bash\nfoo() { :; }\n"),
        ],
    )
    def test_shell(self, name: str, text: str) -> None:
        assert _mod.is_shell_file(Path(name), text)

    @pytest.mark.parametrize(
        ("name", "text"),
        [
            ("notes.md", "Never write `IFS=$'\\t' read`.\n"),
            ("tool.py", "#!/usr/bin/env python3\n"),
            ("tmux.conf", "set -g status on\n"),
        ],
    )
    def test_not_shell(self, name: str, text: str) -> None:
        assert not _mod.is_shell_file(Path(name), text)


# --- render ----------------------------------------------------------------


class TestRender:
    def test_direct_names_the_file_line_and_source(self) -> None:
        msg = _mod.render("a.sh", _mod.DirectTab(line=7, source="IFS=$'\\t' read"))
        assert msg.startswith("a.sh:7:")
        assert "IFS=$'\\t' read" in msg
        assert "0x1f" in msg

    def test_indirect_names_the_variable_and_its_assignment(self) -> None:
        msg = _mod.render(
            "b.sh", _mod.IndirectTab(line=9, source="IFS=$d read", var="d", var_line=3)
        )
        assert "$d" in msg
        assert "line 3" in msg
