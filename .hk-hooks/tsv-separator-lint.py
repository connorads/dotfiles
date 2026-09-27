"""Pre-commit guard: no tab-valued IFS in the tmux subsystem's record parsing.

TAB is IFS whitespace, so `IFS=<tab> read` collapses runs of tabs: an empty
interior field vanishes and every later field shifts one slot left, silently.
The tmux subsystem is built on multi-field records whose fields are routinely
empty - an unset @agent_state, an unnamed window, a dead pane's cwd - so the
shift is the normal case, not an edge one. Every producer/consumer pair here
separates with US (0x1f), which is not whitespace and so holds empty fields in
place. shellcheck has no rule for this and no linter models it.

Flagged in any spelling, because the audit-by-grep this replaces missed most of
them: $'\t', "$(printf '\t')", a raw tab in the assignment, and the indirect
form where IFS is read from a variable the same file gave a tab (`d=$'\t'`).
Only shell files are scanned, so prose about the rule is not itself a finding.

To change the policy: a legitimate tab-valued IFS would need an opt-out marker
here first - there is none, because after the US migration no site needs one.
Reach for `${var%%"$sep"*}` walks or `awk -F` (neither collapses) before asking
for one.

Exit codes: 0 = no tab-valued IFS, 1 = at least one.

Tests:
  bats ~/.config/zsh/tests/tsv-separator-lint.bats            (CLI contract, the gate)
  uv run --with pytest pytest ~/.hk-hooks/test_tsv_separator_lint.py -v   (pure core)
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import assert_never

TAB = "\t"

# Files worth scanning: a shell extension, a shell shebang, or a shellcheck
# shell directive. Everything else (Markdown, Python, tmux.conf) is skipped, so
# documenting the rule never trips it.
SHELL_SUFFIXES: frozenset[str] = frozenset({".sh", ".bash", ".zsh", ".bats"})
_SHEBANG = re.compile(r"^#!.*\b(sh|bash|dash|zsh|ksh)\b")
_SHELLCHECK_SHELL = re.compile(r"^#\s*shellcheck\s+shell=", re.MULTILINE)


@dataclass(frozen=True, slots=True)
class DirectTab:
    """IFS is assigned a tab in this very statement."""

    line: int
    source: str


@dataclass(frozen=True, slots=True)
class IndirectTab:
    """IFS is assigned from a variable the same file gave a tab."""

    line: int
    source: str
    var: str
    var_line: int


Finding = DirectTab | IndirectTab


# --- pure core -------------------------------------------------------------


def read_word(text: str, start: int) -> str:
    """Return the shell word beginning at `start`, honouring quoting.

    Consumes '...', "...", $'...' and $(...)/`...` substitutions whole, so a
    value holding spaces - "$(printf '\\t')" - comes back in one piece. Stops
    at unquoted whitespace or a command terminator.
    """
    i, n = start, len(text)
    out: list[str] = []
    while i < n:
        c = text[i]
        if c in " \t\n;|&)":
            break
        if c == "$" and text.startswith("$'", i):
            j = i + 2
            while j < n and text[j] != "'":
                j += 2 if text[j] == "\\" else 1
            out.append(text[i : j + 1])
            i = j + 1
        elif c in "'\"":
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if (c == '"' and text[j] == "\\") else 1
            out.append(text[i : j + 1])
            i = j + 1
        elif c == "$" and text.startswith("$(", i):
            depth, j = 1, i + 2
            while j < n and depth:
                if text[j] == "(":
                    depth += 1
                elif text[j] == ")":
                    depth -= 1
                j += 1
            out.append(text[i:j])
            i = j
        elif c == "`":
            j = text.find("`", i + 1)
            j = n if j < 0 else j + 1
            out.append(text[i:j])
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


# A tab, spelled the four ways a shell or printf format can spell one. Bare
# '\t' inside single quotes is NOT a tab (it is a backslash and a t), so the
# ANSI-C and printf-format cases are matched on their own.
_TAB_ESCAPE = re.compile(r"\\(t|0?11|x09|X09)")


def _escaped_tab(body: str) -> bool:
    return bool(_TAB_ESCAPE.search(body))


def value_is_tab(word: str) -> bool:
    """True when this shell word evaluates to something containing a tab."""
    if TAB in word:
        return True
    for m in re.finditer(r"\$'((?:[^'\\]|\\.)*)'", word):
        if _escaped_tab(m.group(1)):
            return True
    # $(printf '\t') / `printf "\011"` - the escapes are printf's, not the
    # shell's, so a single-quoted format still yields a tab.
    for m in re.finditer(r"(?:\$\(|`)\s*printf\s+(.*?)(?:\)|`)", word, re.DOTALL):
        if _escaped_tab(m.group(1)):
            return True
    return False


_VAR_REF = re.compile(r"^[\"']?\$\{?(\w+)\}?[\"']?$")


def referenced_var(word: str) -> str | None:
    """The single variable this word is, if it is nothing else (`"$sep"`)."""
    m = _VAR_REF.match(word)
    return m.group(1) if m else None


_ASSIGN = re.compile(r"(?<![\w$])(\w+)=")
_IS_COMMENT = re.compile(r"^\s*#")


def _statements(text: str) -> list[tuple[int, str]]:
    """Source lines, 1-indexed, with whole-line comments dropped."""
    return [(n, line) for n, line in enumerate(text.splitlines(), 1) if not _IS_COMMENT.match(line)]


def tab_valued_vars(text: str) -> dict[str, int]:
    """Names this file assigns a tab, mapped to the line that does it."""
    found: dict[str, int] = {}
    for n, line in _statements(text):
        for m in _ASSIGN.finditer(line):
            name = m.group(1)
            if name == "IFS":
                continue
            if value_is_tab(read_word(line, m.end())):
                found.setdefault(name, n)
    return found


def find_tab_ifs(text: str) -> list[Finding]:
    """Every IFS assignment in `text` whose value is, or becomes, a tab."""
    tabby = tab_valued_vars(text)
    findings: list[Finding] = []
    for n, line in _statements(text):
        for m in re.finditer(r"(?<![\w$])IFS=", line):
            word = read_word(line, m.end())
            source = line.strip()
            if value_is_tab(word):
                findings.append(DirectTab(line=n, source=source))
                continue
            var = referenced_var(word)
            if var is not None and var in tabby:
                findings.append(IndirectTab(line=n, source=source, var=var, var_line=tabby[var]))
    return findings


def render(path: str, finding: Finding) -> str:
    """Render one finding to a single-line diagnostic message."""
    match finding:
        case DirectTab(line, source):
            return (
                f"{path}:{line}: IFS is a tab - an empty interior field collapses"
                f" and shifts the rest left. Use US (0x1f) instead: {source}"
            )
        case IndirectTab(line, source, var, var_line):
            return (
                f"{path}:{line}: IFS is ${var}, given a tab on line {var_line}"
                f" - an empty interior field collapses and shifts the rest left."
                f" Use US (0x1f) instead: {source}"
            )
        case _:
            assert_never(finding)


# --- imperative shell ------------------------------------------------------


def is_shell_file(path: Path, text: str) -> bool:
    if path.suffix in SHELL_SUFFIXES:
        return True
    first = text.split("\n", 1)[0]
    return bool(_SHEBANG.match(first)) or bool(_SHELLCHECK_SHELL.search(text))


def main(argv: list[str]) -> int:
    findings = 0
    for arg in argv:
        path = Path(arg)
        try:
            text = path.read_text()
        except (OSError, UnicodeDecodeError):
            continue
        if not is_shell_file(path, text):
            continue
        for finding in find_tab_ifs(text):
            print(f"tsv-separator-lint: {render(arg, finding)}", file=sys.stderr)
            findings += 1
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
