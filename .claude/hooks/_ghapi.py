"""Shared `gh api` write-detection for agent Bash guards.

One conceptual policy, many enforcement surfaces: this module is the Python
core used by the Claude hook (guard-mutating-api.py, JSON-decision contract)
and the Codex hook (guard-mutating-api-codex.py, exit-2 contract). Same split
as _secretpaths.py and its own delivery hooks.

Read-only `gh api` calls are auto-allowed via the `Bash(gh api *)` allow rule.
This core denies writes: explicit mutating methods
(-X/--method POST/PUT/PATCH/DELETE), and implicit POST triggers
(-f, -F, --raw-field, --field, --input), the latter with guidance that tells
the agent to retry with an explicit GET or mutating method.

Every decision is `deny`, never `ask`. A hook returning "ask" is inert under
`bypassPermissions` - only an explicit `ask` *rule* in settings.json forces a
prompt there - so an ask decision here would be decoration, which is how a
ruleset rewrite once went through unprompted. Ordinary writes therefore deny
but name a `MUTATE_OK=1` env-prefix hatch, mirroring `_secretpaths.BYPASS_VAR`.

Two classes of write get no hatch, because they are exactly the acts where
intent matters and self-approval defeats the point:

- `repos/*/pulls/*/merge` - merging a PR by another name. `gh pr merge` is
  ask-ruled in settings.json, and an unhatched deny here stops `gh api` routing
  around that rule.
- `repos/*/rulesets*` and `repos/*/branches/*/protection*` - branch-protection
  writes.

Trade, accepted deliberately: no hatch means an agent cannot make a ruleset
change even when asked to. The human runs it by hand, or lifts the rule for
that one command. Flag order makes a prefix `ask` rule unreliable for `gh api`,
and an unreliable gate is worse than none because it reads as covered. Both
deny reasons say so, so the way forward is obvious at the point of refusal.

`cover_pr_merge` extends the merge class to the `gh pr merge` porcelain, for
callers with no `permissions.ask` of their own (Codex). Claude leaves it off:
its ask rule *is* the authorisation path, and a hook deny - evaluated first -
would make that prompt unreachable.

gh api switches from GET to POST implicitly when body params or --input are present,
so `gh api repos/o/r/issues/1/comments -f body='hi'` would POST without -X.

An explicit `-X GET`/`--method GET` overrides that inference (params become query
string), so `gh api path -X GET -f ref=x` is treated as read-only and not flagged.

`gh api graphql` always POSTs, even for reads, so the verb heuristic is wrong there.
For GraphQL the read/write signal is the operation type in the `query` document
(query/subscription/fragment = read, mutation = write), so a read-only inline query
is allowed while a mutation - or any document we cannot inspect (@file, @- stdin,
query field absent) - must state POST intent before being denied.

Limitation: if the whole shell command can't be tokenised (e.g. an unescaped `'`
inside the document) detection drops to the regex fallback, which has no GraphQL
awareness and flags the read as an implicit write. That is a false positive
(rejected with retry guidance), not a false negative, so it stays safe.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_ghapi.py -v
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Literal, NamedTuple

sys.path.insert(0, str(Path(__file__).parent))
import _shellparse

# HTTP methods considered mutating
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Env marker for a deliberate opt-out on ordinary writes (precedent: SECRETS_OK
# in _secretpaths, NPM_OK in prefer-pnpm). Self-typeable by the agent, so it
# guards accident rather than intent - which is why the merge and protection
# classes below ignore it.
BYPASS_VAR = "MUTATE_OK"
_BYPASS_FALSEY = frozenset({"", "0", "false", "False", "no"})


class ApiDecision(NamedTuple):
    permission: Literal["deny"]
    reason: str


IMPLICIT_WRITE_DECISION = ApiDecision(
    permission="deny",
    reason=(
        "Blocked implicit POST: `gh api` defaults to POST when "
        "-f/-F/--field/--raw-field/--input is used without `--method`. For a "
        "read, retry with `--method GET`; for an intended write, retry with an "
        "explicit mutating method such as `--method POST`."
    ),
)

MERGE_DECISION = ApiDecision(
    permission="deny",
    reason=(
        f"Blocked PR merge. Merging is the user's call, and this route has no "
        f"`{BYPASS_VAR}` bypass, deliberately - a self-typeable hatch would "
        "just route around the prompt that gates merging. Hand back with the PR "
        "open, checks green, and let the user merge."
    ),
)

PROTECTION_DECISION = ApiDecision(
    permission="deny",
    reason=(
        f"Blocked branch-protection write (ruleset or branch protection). This "
        f"surface has no `{BYPASS_VAR}` bypass, deliberately - a self-typeable "
        "hatch is no gate on the one act that must be the user's. Report the "
        "exact change you want and let the user apply it, or have them lift "
        "this rule for the single command."
    ),
)

# Pattern to detect `gh api` (with optional flags before `api`)
GH_API_RE = re.compile(r"\bgh\s+api\b")
# `gh pr merge` - the same act as a pulls/*/merge API call, by the porcelain
# route. Only consulted when the caller asks for it (see `cover_pr_merge`).
GH_PR_MERGE_RE = re.compile(r"\bgh\s+pr\s+merge\b")

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
_FALLBACK_BYPASS_RE = re.compile(rf"\b{BYPASS_VAR}=(\S*)")

# --- Token-level detection (preferred path) ---
# A glued method flag carries its verb in one token: -XPOST, -XGET, --method=POST.
GLUED_METHOD_RE = re.compile(r"^(?:-X|--method=)([A-Za-z]+)$", re.IGNORECASE)
# Body-param flags glued to a value: -fkey=val, -Fkey=val (pflag shorthand), and
# the long forms with `=`. These switch gh from GET to POST unless --method GET is set.
GLUED_IMPLICIT_RE = re.compile(r"^(?:-[fF].|--(?:raw-field|field|input)=)")
IMPLICIT_FLAGS = {"-f", "-F", "--field", "--raw-field", "--input"}

# --- Unhatched write classes, matched on the request path ---
# A path may carry a leading slash or a full https://api.github.com/ prefix, so
# strip those before matching on the component shape.
_PATH_PREFIX_RE = re.compile(r"^(?:https?://[^/]+/)?/?")
MERGE_PATH_RE = re.compile(r"^repos/[^/]+/[^/]+/pulls/[^/]+/merge/?$", re.IGNORECASE)
PROTECTION_PATH_RE = re.compile(
    r"^repos/[^/]+/[^/]+/(?:rulesets|branches/[^/]+/protection)(?:/.*)?$",
    re.IGNORECASE,
)
# Fallback equivalents: the same shapes, found anywhere in an untokenisable line.
MERGE_PATH_LOOSE_RE = re.compile(r"repos/[^/\s]+/[^/\s]+/pulls/[^/\s]+/merge\b", re.IGNORECASE)
PROTECTION_PATH_LOOSE_RE = re.compile(
    r"repos/[^/\s]+/[^/\s]+/(?:rulesets|branches/[^/\s]+/protection)\b", re.IGNORECASE
)


def _bypassed(segment: list[str]) -> bool:
    """True when the segment carries a non-falsey MUTATE_OK= env prefix."""
    value = _shellparse.env_assignments(segment).get(BYPASS_VAR)
    return value is not None and value not in _BYPASS_FALSEY


def _fallback_invocations(command: str) -> list[str]:
    """Best-effort `gh api` argument substrings for unparseable commands."""
    invocations: list[str] = []
    for match in GH_API_RE.finditer(command):
        rest = command[match.end() :]
        separator = SHELL_SEPARATOR_RE.search(rest)
        invocations.append(rest[: separator.start()] if separator else rest)
    return invocations


def _explicit_write_decision(methods: set[str]) -> ApiDecision:
    verbs = "/".join(sorted(methods & MUTATING_METHODS))
    return ApiDecision(
        permission="deny",
        reason=(
            f"Blocked mutating `gh api` {verbs} request. If the write is "
            f"genuinely intended, re-run with a `{BYPASS_VAR}=1` prefix."
        ),
    )


def _loose_path_decision(args: str) -> ApiDecision | None:
    """Unhatched write class in a rough argument string, or None."""
    if MERGE_PATH_LOOSE_RE.search(args):
        return MERGE_DECISION
    if PROTECTION_PATH_LOOSE_RE.search(args):
        return PROTECTION_DECISION
    return None


def _decision_args_regex(args: str) -> ApiDecision | None:
    """Classify a rough `gh api` argument string when tokenisation fails."""
    method_match = METHOD_FLAG_RE.search(args)
    implicit = IMPLICIT_POST_RE.search(args) is not None and GET_METHOD_FLAG_RE.search(args) is None
    if method_match is None and not implicit:
        return None
    # Only a write reaches the unhatched classes; reads of those paths are fine.
    unhatched = _loose_path_decision(args)
    if unhatched is not None:
        return unhatched
    if method_match is not None:
        return _explicit_write_decision({method_match.group(1).upper()})
    return IMPLICIT_WRITE_DECISION


def _regex_fallback(command: str, cover_pr_merge: bool) -> ApiDecision | None:
    """Safely classify commands that can't be shell-tokenised."""
    if cover_pr_merge and GH_PR_MERGE_RE.search(command):
        return MERGE_DECISION
    hatch = _FALLBACK_BYPASS_RE.search(command)
    hatched = hatch is not None and hatch.group(1) not in _BYPASS_FALSEY
    pending: ApiDecision | None = None
    for args in _fallback_invocations(command):
        decision = _decision_args_regex(args)
        if decision is None:
            continue
        # Unhatched classes and the implicit-POST ambiguity ignore the hatch,
        # matching the token-level path.
        if decision in (MERGE_DECISION, PROTECTION_DECISION, IMPLICIT_WRITE_DECISION):
            return decision
        if hatched:
            continue
        pending = decision
    return pending


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


def _is_gh_pr_merge(segment: list[str]) -> bool:
    """True when the segment invokes `gh pr merge` (env prefix and flags aside)."""
    argv = _shellparse.strip_env_prefix(segment)
    return [tok for tok in argv if not tok.startswith("-")][:3] == ["gh", "pr", "merge"]


def _unhatched_path_decision(args: list[str]) -> ApiDecision | None:
    """Unhatched write class for a `gh api` argv slice, or None.

    The path is a positional argument, but flags and their values interleave
    freely, so every non-flag token is checked as a candidate path.
    """
    for tok in args:
        if tok.startswith("-"):
            continue
        path = _PATH_PREFIX_RE.sub("", tok, count=1)
        if MERGE_PATH_RE.match(path):
            return MERGE_DECISION
        if PROTECTION_PATH_RE.match(path):
            return PROTECTION_DECISION
    return None


# --- GraphQL awareness ---
# `gh api graphql` always POSTs, even for reads, so the implicit-POST verb
# heuristic is wrong there. The real read/write signal is the operation type
# (query/subscription/fragment = read, mutation = write), which rides in the
# `query` body param. We allow a clearly read-only inline document and flag
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


def gh_api_decision(command: str, *, cover_pr_merge: bool = False) -> ApiDecision | None:
    """Return the strongest deny decision a command requires, or None.

    Merges and branch-protection writes are denied outright. Other writes are
    denied but name the MUTATE_OK=1 hatch, and implicit writes are denied with
    retry guidance so the agent can restate read-or-write intent. Read-only
    commands return no decision, including reads of the unhatched paths.

    Set `cover_pr_merge` to include the `gh pr merge` porcelain in the merge
    class - correct for Codex, wrong for Claude, whose `ask` rule for that
    command must stay reachable.

    Compound commands are analysed per shell command segment, so a GET override
    or a MUTATE_OK prefix only affects the invocation in its own segment.
    """
    if _shellparse.NOT_COMMIT_RE.search(command):
        return None
    if not GH_API_RE.search(command) and not (cover_pr_merge and GH_PR_MERGE_RE.search(command)):
        return None

    tokens = _shellparse.tokenise(command)
    if tokens is None:
        return _regex_fallback(command, cover_pr_merge)

    pending: ApiDecision | None = None
    for segment in _shellparse.command_segments(tokens):
        if cover_pr_merge and _is_gh_pr_merge(segment):
            return MERGE_DECISION
        for args in _gh_api_arg_vectors(segment):
            methods, implicit = _methods_and_implicit(args)
            explicit_write = bool(methods & MUTATING_METHODS)
            # GraphQL reads POST unconditionally, so they remain allowed.
            # A mutation or uninspectable document must state POST intent.
            implicit_write = (
                implicit
                and "GET" not in methods
                and (
                    not _is_graphql_invocation(args)
                    or _graphql_doc_mutates(_gql_query_doc(args)) is not False
                )
            )
            if not explicit_write and not implicit_write:
                continue
            # Only a write reaches the unhatched classes; reads of those paths
            # are ordinary reads, and the hatch does not apply here.
            unhatched = _unhatched_path_decision(args)
            if unhatched is not None:
                return unhatched
            if not explicit_write:
                # An implicit POST is a read-or-write ambiguity, not a
                # permission question, so the hatch does not resolve it -
                # otherwise MUTATE_OK=1 would become the standard workaround
                # and turn accidental POSTs on read queries into real writes.
                return IMPLICIT_WRITE_DECISION
            if _bypassed(segment):
                continue
            pending = _explicit_write_decision(methods)

    return pending
