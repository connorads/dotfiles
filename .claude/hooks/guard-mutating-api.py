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

`gh api graphql` always POSTs, even for reads, so the verb heuristic is wrong there.
For GraphQL the read/write signal is the operation type in the `query` document
(query/subscription/fragment = read, mutation = write), so a read-only inline query
is allowed while a mutation - or any document we cannot inspect (@file, @- stdin,
query field absent) - still asks.

Limitation: if the whole shell command can't be tokenised (e.g. an unescaped `'`
inside the document) detection drops to the regex fallback, which has no GraphQL
awareness and flags the read as mutating. That is a false positive (extra prompt),
not a false negative, so it stays safe.

Exit codes:
  0 - Always

Output:
  JSON with permissionDecision "ask" for mutating calls, nothing otherwise.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_guard_mutating_api.py -v
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _shellparse

# HTTP methods considered mutating
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

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
    starts = [i for i in range(len(tokens) - 1) if tokens[i] == "gh" and tokens[i + 1] == "api"]
    invocations: list[list[str]] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(tokens)
        invocations.append(tokens[start + 2 : end])
    return invocations


# --- GraphQL awareness ---
# `gh api graphql` always POSTs, even for reads, so the implicit-POST verb
# heuristic is wrong there. The real read/write signal is the operation type
# (query/subscription/fragment = read, mutation = write), which rides in the
# `query` body param. We allow a clearly read-only inline document and ask for
# anything we cannot inspect (mutation, @file, @- stdin, query field absent).
_GQL_WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _strip_gql_literals(doc: str) -> str:
    """Blank block strings, strings, and `#` comments so braces or the word
    `mutation` inside them do not count toward operation detection."""
    out: list[str] = []
    i = 0
    n = len(doc)
    while i < n:
        if doc.startswith('"""', i):
            end = doc.find('"""', i + 3)
            stop = n if end == -1 else end + 3
            out.append(" " * (stop - i))
            i = stop
            continue
        ch = doc[i]
        if ch == '"':
            j = i + 1
            while j < n and doc[j] != '"':
                j += 2 if doc[j] == "\\" else 1
            stop = n if j >= n else j + 1
            out.append(" " * (stop - i))
            i = stop
            continue
        if ch == "#":
            end = doc.find("\n", i)
            stop = n if end == -1 else end
            out.append(" " * (stop - i))
            i = stop
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _graphql_doc_mutates(doc: str | None) -> bool | None:
    """Classify a GraphQL document: True if it mutates, False if read-only,
    None if uninspectable (absent, or a `@file`/`@-` reference)."""
    if doc is None:
        return None
    if doc.lstrip().startswith("@"):
        return None
    clean = _strip_gql_literals(doc)
    depth = 0
    i = 0
    n = len(clean)
    while i < n:
        ch = clean[i]
        if ch == "{":
            depth += 1
            i += 1
            continue
        if ch == "}":
            depth -= 1
            i += 1
            continue
        match = _GQL_WORD_RE.match(clean, i)
        if match:
            # A `mutation` keyword at depth 0 is in operation-type position.
            if depth == 0 and match.group() == "mutation":
                return True
            i = match.end()
            continue
        i += 1
    return False


def _gql_query_doc(args: list[str]) -> str | None:
    """Return the value of the `query` body param, or None if absent.

    Handles separate (`-f query=...`), glued (`-fquery=...`/`-Fquery=...`),
    and long (`--field=query=...`/`--raw-field=query=...`) forms.
    """
    i = 0
    n = len(args)
    while i < n:
        tok = args[i]
        pair: str | None = None
        if tok in ("-f", "-F", "--field", "--raw-field"):
            if i + 1 < n:
                pair = args[i + 1]
            i += 2
        elif GLUED_IMPLICIT_RE.match(tok):
            pair = tok.partition("=")[2] if tok.startswith("--") else tok[2:]
            i += 1
        else:
            i += 1
            continue
        if pair is not None:
            key, sep, value = pair.partition("=")
            if sep and key == "query":
                return value
    return None


def _is_graphql_invocation(args: list[str]) -> bool:
    """True when this `gh api` call targets the GraphQL endpoint (spelled `graphql`)."""
    return any(a == "graphql" for a in args)


def is_mutating_gh_api(command: str) -> bool:
    """Return True if command issues a mutating `gh api` request.

    Detects explicit methods (-X POST, --method DELETE) and implicit POST via
    body-param flags (-f, -F, --field, --raw-field, --input). An explicit
    -X GET / --method GET keeps body params as a query string, so it stays a read.

    Compound commands are analysed per shell command segment so a GET override
    only affects the `gh api` invocation in the same segment.
    """
    if _shellparse.NOT_COMMIT_RE.search(command):
        return False
    if not GH_API_RE.search(command):
        return False

    tokens = _shellparse.tokenise(command)
    if tokens is None:
        return _regex_fallback(command)

    for segment in _shellparse.command_segments(tokens):
        for args in _gh_api_arg_vectors(segment):
            methods, implicit = _methods_and_implicit(args)
            if methods & MUTATING_METHODS:
                return True
            if implicit and "GET" not in methods:
                if _is_graphql_invocation(args):
                    # graphql POSTs unconditionally; gate on operation type, not
                    # verb. Unknown (None) errs safe -> ask.
                    if _graphql_doc_mutates(_gql_query_doc(args)) is not False:
                        return True
                else:
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
