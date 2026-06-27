#!/usr/bin/env python3
"""
Claude Code hook to gate mutating `gh api` calls behind a permission prompt.

Read-only `gh api` calls are auto-allowed via the `Bash(gh api *)` allow rule.
This hook catches both explicit mutating methods (-X/-method POST/PUT/PATCH/DELETE)
and implicit POST triggers (-f, -F, --raw-field, --field, --input) and returns
permissionDecision: "ask" so the user is prompted for confirmation.

gh api switches from GET to POST implicitly when body params or --input are present,
so `gh api repos/o/r/issues/1/comments -f body='hi'` would POST without -X.

An explicit `-X GET`/`--method GET` overrides that inference (params become query
string), so `gh api path -X GET -f ref=x` is treated as read-only and not flagged.

Exit codes:
  0 - Always

Output:
  JSON with permissionDecision "ask" for mutating calls, nothing otherwise.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_mutating_api.py -v
"""

from __future__ import annotations

import json
import re
import shlex
import sys

# HTTP methods considered mutating
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Commands where `gh api` may appear in quoted args (e.g. commit messages) — skip these.
NOT_GH_API_CMD_RE = re.compile(r"\b(?:git|dotfiles)\b.*\bcommit\b")

# Pattern to detect `gh api` (with optional flags before `api`)
GH_API_RE = re.compile(r"\bgh\s+api\b")

# --- Regex fallback (used only when the command can't be tokenised) ---
# These still inspect only text after each `gh api` token. A flag used by an
# earlier shell helper, such as `cut -f1`, must not make a later read-only
# `gh api` look mutating.
METHOD_FLAG_RE = re.compile(
    r"(?:-X\s*|--method[\s=])(" + "|".join(MUTATING_METHODS) + r")\b",
    re.IGNORECASE,
)
GET_METHOD_FLAG_RE = re.compile(r"(?:-X\s*|--method[\s=])GET\b", re.IGNORECASE)
IMPLICIT_POST_RE = re.compile(
    r"(?:^|\s)(?:-[fF](?:\s+|\S)|--raw-field[\s=]|--field[\s=]|--input[\s=])"
)
SHELL_SEPARATOR_RE = re.compile(r"\s(?:&&|\|\||[;|])\s")

# --- Token-level detection (preferred path) ---
# Command separators that split shell commands without trying to be a full shell
# parser. `shlex` keeps quoted separators inside values, which is what we need.
COMMAND_SEPARATORS = {";", "&&", "||", "|"}

# A glued method flag carries its verb in one token: -XPOST, -XGET, --method=POST.
GLUED_METHOD_RE = re.compile(r"^(?:-X|--method=)([A-Za-z]+)$", re.IGNORECASE)
# Body-param flags glued to a value: -fkey=val, -Fkey=val (pflag shorthand), and
# the long forms with `=`. These switch gh from GET to POST unless --method GET is set.
GLUED_IMPLICIT_RE = re.compile(r"^(?:-[fF].|--(?:raw-field|field|input)=)")
IMPLICIT_FLAGS = {"-f", "-F", "--field", "--raw-field", "--input"}


def _fallback_invocations(command: str) -> list[str]:
    """Best-effort `gh api` argument substrings for unparseable commands."""
    invocations: list[str] = []
    for match in GH_API_RE.finditer(command):
        rest = command[match.end() :]
        separator = SHELL_SEPARATOR_RE.search(rest)
        invocations.append(rest[: separator.start()] if separator else rest)
    return invocations


def _is_mutating_args_regex(args: str) -> bool:
    """Return True when a rough `gh api` argument string looks mutating."""
    if METHOD_FLAG_RE.search(args) is not None:
        return True
    return IMPLICIT_POST_RE.search(args) is not None and GET_METHOD_FLAG_RE.search(args) is None


def _regex_fallback(command: str) -> bool:
    """Safe-erring detection for commands that can't be shell-tokenised."""
    return any(_is_mutating_args_regex(args) for args in _fallback_invocations(command))


def _methods_and_implicit(tokens: list[str]) -> tuple[set[str], bool]:
    """Extract HTTP method(s) and whether any body-param flag is present.

    Operates on real argv tokens, so a method substring inside a quoted value
    (e.g. -f body='see -X GET docs') is part of the value token, not a flag.
    """
    methods: set[str] = set()
    implicit = False
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok in ("-X", "--method"):
            if i + 1 < len(tokens):
                methods.add(tokens[i + 1].upper())
            i += 2
            continue
        glued = GLUED_METHOD_RE.match(tok)
        if glued:
            methods.add(glued.group(1).upper())
        elif tok in IMPLICIT_FLAGS or GLUED_IMPLICIT_RE.match(tok):
            implicit = True
        i += 1
    return methods, implicit


def _gh_api_arg_vectors(tokens: list[str]) -> list[list[str]]:
    """Return argv slices after each `gh api` token pair in a segment."""
    starts = [
        i
        for i in range(len(tokens) - 1)
        if tokens[i] == "gh" and tokens[i + 1] == "api"
    ]
    invocations: list[list[str]] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(tokens)
        invocations.append(tokens[start + 2 : end])
    return invocations


def _command_segments(tokens: list[str]) -> list[list[str]]:
    """Split tokens into shell command segments at simple separators."""
    segments: list[list[str]] = []
    current: list[str] = []
    for tok in tokens:
        if tok in COMMAND_SEPARATORS:
            if current:
                segments.append(current)
                current = []
            continue
        current.append(tok)

    if current:
        segments.append(current)
    return segments


def is_mutating_gh_api(command: str) -> bool:
    """Return True if command issues a mutating `gh api` request.

    Detects explicit methods (-X POST, --method DELETE) and implicit POST via
    body-param flags (-f, -F, --field, --raw-field, --input). An explicit
    -X GET / --method GET keeps body params as a query string, so it stays a read.

    Compound commands are analysed per shell command segment so a GET override
    only affects the `gh api` invocation in the same segment.
    """
    if NOT_GH_API_CMD_RE.search(command):
        return False
    if not GH_API_RE.search(command):
        return False

    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        return _regex_fallback(command)

    for segment in _command_segments(tokens):
        for args in _gh_api_arg_vectors(segment):
            methods, implicit = _methods_and_implicit(args)
            if methods & MUTATING_METHODS:
                return True
            if implicit and "GET" not in methods:
                return True

    return False


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    tool_input = input_data.get("tool_input", {})
    command = tool_input.get("command", "")

    if not command:
        return 0

    if is_mutating_gh_api(command):
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
            }
        }
        json.dump(output, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
