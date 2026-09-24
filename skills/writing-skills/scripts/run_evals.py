#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""run_evals.py: run a skill's evals/evals.json with and without the skill.

Usage:
  run_evals.py <skill-dir> --agent claude|codex [--model M] [--judge-model M]
               [--runs 3] [--case GLOB] [-j N] [--max-cost-usd X] [--out DIR]

Each run gets a fresh temp workspace holding the case's `files`; the
with-skill arm also gets the skill at .claude/skills/<name> and
.agents/skills/<name>, so the agent discovers it like any project skill and
decides for itself whether to load it. Grading is deterministic `checks` plus
a judge (the same CLI, headless, not told the arm) for free-text `assertions`.

Writes results.json (agentskills.io benchmark.json shape plus per-case detail)
and report.md, linking every transcript, to --out (default: a new temp dir).
stdout carries only the summary table; diagnostics go to stderr.

Exit: 0 every case's with-skill runs passed; 1 a case failed, a run errored,
or bad usage; 2 partial - the cost ceiling stopped the suite early.
"""

from __future__ import annotations

import argparse
import difflib
import fnmatch
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Iterable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

RUN_TIMEOUT_S = 1800
JUDGE_TIMEOUT_S = 600
ARMS = ("with_skill", "without_skill")


class EvalsError(Exception):
    """evals.json is malformed; the message names the field."""


# --- Domain types -----------------------------------------------------------


@dataclass(frozen=True)
class ToolUsed:
    """Calls to `tool` (None: any tool) whose input matches, counted in [min, max]."""

    tool: str | None
    input_match: str | None
    min: int
    max: int | None


@dataclass(frozen=True)
class ToolOrder:
    """(tool, input_match) steps that must occur in this order, gaps allowed."""

    steps: tuple[tuple[str | None, str | None], ...]


@dataclass(frozen=True)
class FileExists:
    path: str  # glob over workspace-relative paths


@dataclass(frozen=True)
class Regex:
    pattern: str
    path: str | None  # glob over workspace files; None: the final message


Check = ToolUsed | ToolOrder | FileExists | Regex


@dataclass(frozen=True)
class Case:
    id: Any
    name: str
    prompt: str
    expected_output: str
    files: tuple[str, ...]
    assertions: tuple[str, ...]
    checks: tuple[Check, ...]


@dataclass(frozen=True)
class ToolCall:
    """One tool call; clients' shell tools are all named Bash."""

    tool: str
    input_text: str
    output: str


@dataclass(frozen=True)
class Transcript:
    tool_calls: tuple[ToolCall, ...]
    final_message: str
    tokens: int | None
    cost_usd: float | None
    skill_loaded: bool


@dataclass(frozen=True)
class CheckResult:
    text: str
    passed: bool
    evidence: str


@dataclass(frozen=True)
class RunRecord:
    case: str
    arm: str
    run: int
    passed: int
    total: int
    skill_loaded: bool
    tokens: int | None
    seconds: float
    cost_usd: float | None
    error: str | None
    transcript: str


# --- Parsing ------------------------------------------------------------------


def _regex(value: object, where: str) -> str:
    if not isinstance(value, str):
        raise EvalsError(f"{where}: pattern must be a string")
    try:
        re.compile(value)
    except re.error as e:
        raise EvalsError(f"{where}: invalid regex {value!r}: {e}") from None
    return value


def _opt_regex(value: object, where: str) -> str | None:
    return None if value is None else _regex(value, where)


def _parse_check(raw: object, where: str) -> Check:
    if not isinstance(raw, dict):
        raise EvalsError(f"{where}: a check must be an object")
    kind = raw.get("type")
    if kind == "tool_used":
        return ToolUsed(
            tool=raw.get("tool"),
            input_match=_opt_regex(raw.get("input_match"), where),
            min=int(raw.get("min", 1)),
            max=None if raw.get("max") is None else int(raw["max"]),
        )
    if kind == "tool_order":
        steps = raw.get("steps")
        if not isinstance(steps, list) or not steps:
            raise EvalsError(f"{where}: tool_order needs a non-empty steps list")
        return ToolOrder(
            tuple((s.get("tool"), _opt_regex(s.get("input_match"), where)) for s in steps)
        )
    if kind == "file_exists":
        if not isinstance(raw.get("path"), str):
            raise EvalsError(f"{where}: file_exists needs a path glob")
        return FileExists(raw["path"])
    if kind == "regex":
        if "pattern" not in raw:
            raise EvalsError(f"{where}: regex needs a pattern")
        return Regex(_regex(raw["pattern"], where), raw.get("path"))
    raise EvalsError(
        f"{where}: unknown check type {kind!r} (tool_used, tool_order, file_exists, regex)"
    )


def parse_evals(data: object) -> list[Case]:
    if not isinstance(data, dict) or not isinstance(data.get("evals"), list):
        raise EvalsError("evals.json needs an 'evals' list")
    cases = []
    for i, raw in enumerate(data["evals"]):
        where = f"evals[{i}]"
        if not isinstance(raw, dict) or not isinstance(raw.get("prompt"), str):
            raise EvalsError(f"{where}: missing string 'prompt'")
        cases.append(
            Case(
                id=raw.get("id", i + 1),
                name=str(raw.get("name") or f"eval-{raw.get('id', i + 1)}"),
                prompt=raw["prompt"],
                expected_output=str(raw.get("expected_output", "")),
                files=tuple(raw.get("files") or ()),
                assertions=tuple(raw.get("assertions") or ()),
                checks=tuple(
                    _parse_check(c, f"{where}.checks[{j}]")
                    for j, c in enumerate(raw.get("checks") or ())
                ),
            )
        )
    return cases


# --- Transcript normalisation -------------------------------------------------


def _obj(value: object) -> dict:
    """The value if it is a JSON object, else empty: client events vary in shape."""
    return value if isinstance(value, dict) else {}


def _json_lines(lines: Iterable[str]) -> Iterable[dict]:
    for line in lines:
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict):
            yield obj


def _text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def _loads_skill(call: ToolCall, skill: str) -> bool:
    if call.tool == "Skill":
        try:
            return json.loads(call.input_text).get("skill", "").split(":")[-1] == skill
        except (ValueError, AttributeError):
            return False
    return f"{skill}/SKILL.md" in call.input_text


def _normalise_claude(
    events: Iterable[dict],
) -> tuple[list[ToolCall], str, int | None, float | None]:
    calls: dict[str, int] = {}
    out: list[ToolCall] = []
    final, tokens, cost = "", None, None
    for ev in events:
        kind = ev.get("type")
        content = _obj(ev.get("message")).get("content")
        if kind == "assistant" and isinstance(content, list):
            for block in map(_obj, content):
                if block.get("type") == "tool_use":
                    calls[block.get("id", "")] = len(out)
                    out.append(
                        ToolCall(block.get("name", ""), json.dumps(block.get("input", {})), "")
                    )
                elif block.get("type") == "text" and block.get("text"):
                    final = block["text"]
        elif kind == "user" and isinstance(content, list):
            for block in map(_obj, content):
                idx = calls.get(block.get("tool_use_id", ""))
                if idx is not None:
                    c = out[idx]
                    out[idx] = ToolCall(c.tool, c.input_text, _text(block.get("content")))
        elif kind == "result":
            final = ev.get("result") or final
            cost = ev.get("total_cost_usd")
            usage = _obj(ev.get("usage"))
            tokens = sum(
                int(usage.get(k) or 0)
                for k in (
                    "input_tokens",
                    "output_tokens",
                    "cache_read_input_tokens",
                    "cache_creation_input_tokens",
                )
            )
    return out, final, tokens, cost


def _normalise_codex(
    events: Iterable[dict],
) -> tuple[list[ToolCall], str, int | None, float | None]:
    out: list[ToolCall] = []
    final, tokens = "", None
    for ev in events:
        if ev.get("type") == "item.completed":
            item = _obj(ev.get("item"))
            kind = item.get("type")
            if kind == "agent_message":
                final = item.get("text", "")
            elif kind == "command_execution":
                out.append(
                    ToolCall("Bash", item.get("command", ""), item.get("aggregated_output", ""))
                )
            elif kind == "file_change":
                out.append(ToolCall("Edit", json.dumps(item.get("changes", [])), ""))
            elif kind == "mcp_tool_call":
                out.append(
                    ToolCall(
                        str(item.get("tool", "mcp")), json.dumps(item.get("arguments", {})), ""
                    )
                )
            elif kind == "web_search":
                out.append(ToolCall("WebSearch", str(item.get("query", "")), ""))
        elif ev.get("type") == "turn.completed":
            usage = _obj(ev.get("usage"))
            tokens = (
                (tokens or 0)
                + int(usage.get("input_tokens") or 0)
                + int(usage.get("output_tokens") or 0)
            )
    return out, final, tokens, None


def normalise(agent: str, lines: Iterable[str], skill: str) -> Transcript:
    parse = _normalise_claude if agent == "claude" else _normalise_codex
    calls, final, tokens, cost = parse(_json_lines(lines))
    return Transcript(tuple(calls), final, tokens, cost, any(_loads_skill(c, skill) for c in calls))


# --- Grading --------------------------------------------------------------------


def _matches(call: ToolCall, tool: str | None, pattern: str | None) -> bool:
    return (tool is None or call.tool == tool) and (
        pattern is None or re.search(pattern, call.input_text) is not None
    )


def _describe(check: Check) -> str:
    if isinstance(check, ToolUsed):
        span = f"{check.min}..{'' if check.max is None else check.max}"
        return f"tool_used {check.tool or 'any'} /{check.input_match or ''}/ x{span}"
    if isinstance(check, ToolOrder):
        return "tool_order " + " -> ".join(f"{t or 'any'} /{p or ''}/" for t, p in check.steps)
    if isinstance(check, FileExists):
        return f"file_exists {check.path}"
    return f"regex /{check.pattern}/ in {check.path or 'final message'}"


def grade(check: Check, t: Transcript, files: Mapping[str, str]) -> CheckResult:
    text = _describe(check)
    if isinstance(check, ToolUsed):
        n = sum(_matches(c, check.tool, check.input_match) for c in t.tool_calls)
        ok = n >= check.min and (check.max is None or n <= check.max)
        return CheckResult(text, ok, f"{n} matching call(s) of {len(t.tool_calls)}")
    if isinstance(check, ToolOrder):
        steps = iter(check.steps)
        want = next(steps, None)
        for c in t.tool_calls:
            if want and _matches(c, *want):
                want = next(steps, None)
        return CheckResult(
            text, want is None, "all steps in order" if want is None else f"missing step {want}"
        )
    if isinstance(check, FileExists):
        hits = [p for p in files if fnmatch.fnmatch(p, check.path)]
        return CheckResult(text, bool(hits), ", ".join(hits[:5]) or "no matching file")
    if check.path is None:
        m = re.search(check.pattern, t.final_message)
        return CheckResult(
            text, m is not None, m.group(0)[:200] if m else "no match in final message"
        )
    for p, body in files.items():
        if fnmatch.fnmatch(p, check.path) and (m := re.search(check.pattern, body)):
            return CheckResult(text, True, f"{p}: {m.group(0)[:200]}")
    return CheckResult(text, False, f"no match in files {check.path}")


# --- Aggregation ------------------------------------------------------------------


def _rate(r: RunRecord) -> float:
    if r.error:
        return 0.0
    return r.passed / r.total if r.total else 1.0


def _stat(values: Sequence[float]) -> dict[str, float] | None:
    if not values:
        return None
    return {
        "mean": statistics.fmean(values),
        "stddev": statistics.stdev(values) if len(values) > 1 else 0.0,
    }


def _arm(records: Sequence[RunRecord]) -> dict[str, Any]:
    costs = [r.cost_usd for r in records if r.cost_usd is not None]
    return {
        "runs": len(records),
        "errors": sum(1 for r in records if r.error),
        "pass_rate": _stat([_rate(r) for r in records]),
        "skill_load_rate": statistics.fmean(r.skill_loaded for r in records) if records else None,
        "time_seconds": _stat([r.seconds for r in records]),
        "tokens": _stat([r.tokens for r in records if r.tokens is not None]),
        "cost_usd": sum(costs) if costs else None,
    }


def _delta(w: dict[str, Any], wo: dict[str, Any]) -> dict[str, float | None]:
    def diff(key: str) -> float | None:
        a, b = w.get(key), wo.get(key)
        return a["mean"] - b["mean"] if a and b else None

    return {
        "pass_rate": diff("pass_rate"),
        "time_seconds": diff("time_seconds"),
        "tokens": diff("tokens"),
    }


def _summary(records: Sequence[RunRecord]) -> dict[str, Any]:
    arms = {arm: _arm([r for r in records if r.arm == arm]) for arm in ARMS}
    return {**arms, "delta": _delta(arms["with_skill"], arms["without_skill"])}


def aggregate(records: Sequence[RunRecord]) -> dict[str, Any]:
    names = list(dict.fromkeys(r.case for r in records))
    return {
        "run_summary": _summary(records),
        "cases": [{"name": n, **_summary([r for r in records if r.case == n])} for n in names],
    }


def case_passed(case: dict[str, Any]) -> bool:
    w = case["with_skill"]
    return bool(w["runs"]) and not w["errors"] and w["pass_rate"]["mean"] == 1.0


# --- Judge prompt -------------------------------------------------------------------

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "assertion": {"type": "string"},
                    "passed": {"type": "boolean"},
                    "evidence": {"type": "string"},
                },
                "required": ["assertion", "passed", "evidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["results"],
    "additionalProperties": False,
}


def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n // 2] + f"\n...[{len(s) - n} chars cut]...\n" + s[-n // 2 :]


def workspace_diff(before: Mapping[str, str], after: Mapping[str, str]) -> str:
    """Unified diff of every file the run added, changed or deleted."""
    chunks = []
    for p in sorted(before.keys() | after.keys()):
        a, b = before.get(p), after.get(p)
        if a == b:
            continue
        chunks.extend(
            difflib.unified_diff(
                (a or "").splitlines(keepends=True),
                (b or "").splitlines(keepends=True),
                fromfile="/dev/null" if a is None else f"a/{p}",
                tofile="/dev/null" if b is None else f"b/{p}",
            )
        )
    return "".join(chunks)


def judge_prompt(
    case: Case, t: Transcript, before: Mapping[str, str], after: Mapping[str, str]
) -> str:
    calls = "\n".join(
        f"- {c.tool}: {_clip(c.input_text, 600)}\n  -> {_clip(c.output, 800)}" for c in t.tool_calls
    )
    listing = "\n".join(sorted(after)) or "(none)"
    asserts = "\n".join(f"{i}. {a}" for i, a in enumerate(case.assertions, 1))
    return f"""You grade one run of an AI coding agent against assertions.
Judge only from the evidence below. A PASS needs concrete evidence: quote or
cite it. When the evidence is absent or ambiguous, FAIL.

## Task the agent was given
{case.prompt}

## What success looks like
{case.expected_output or "(not stated)"}

## Assertions - grade each, in this order
{asserts}

## Agent's final message
{_clip(t.final_message, 12000)}

## Files in the workspace after the run
{listing}

## Every change the run made to workspace files (unified diff)
{_clip(workspace_diff(before, after), 40000) or "(no file changed)"}

## Tool calls, in order (trimmed)
{_clip(calls, 40000) or "(none)"}

Return one result per assertion, in order, with the assertion text, passed,
and the evidence."""


def verdicts(case: Case, raw: object) -> list[CheckResult]:
    got = raw.get("results", []) if isinstance(raw, dict) else []
    out = []
    for i, a in enumerate(case.assertions):
        r = got[i] if i < len(got) and isinstance(got[i], dict) else {}
        out.append(
            CheckResult(
                a, r.get("passed") is True, str(r.get("evidence") or "judge returned no verdict")
            )
        )
    return out


# --- Client adapters (imperative shell) ------------------------------------------------


class ClientError(Exception):
    pass


class Client(Protocol):
    name: str

    def run(self, ws: Path, prompt: str, model: str | None) -> subprocess.CompletedProcess[str]: ...

    def judge(self, prompt: str, model: str | None) -> tuple[Any, float | None]: ...


CLAUDE_SETTINGS = json.dumps(
    {
        "permissions": {"allow": ["WebSearch", "WebFetch"]},
        "sandbox": {
            "enabled": True,
            "failIfUnavailable": True,
            "allowUnsandboxedCommands": False,
            "autoAllowBashIfSandboxed": True,
        },
    }
)


class Claude:
    # --setting-sources project: the workspace's .claude/skills load, the
    # user's skills and CLAUDE.md don't ("" would drop project skills too).
    # acceptEdits confines edits to the workspace; Bash runs in the native
    # sandbox, which confines writes to it. Web search and fetch are allowed
    # because verifying claims live is behaviour evals grade. Writes under the
    # workspace's .claude/ stay denied whatever the rules say (a built-in
    # safety check), so a case prompt should not target that directory.
    name = "claude"

    def env(self) -> dict[str, str]:
        return {**os.environ, "ENABLE_CLAUDEAI_MCP_SERVERS": "false"}

    def run(self, ws: Path, prompt: str, model: str | None) -> subprocess.CompletedProcess[str]:
        argv = [
            "claude",
            "-p",
            "--setting-sources",
            "project",
            "--strict-mcp-config",
            "--no-session-persistence",
            "--permission-mode",
            "acceptEdits",
            "--settings",
            CLAUDE_SETTINGS,
            "--output-format",
            "stream-json",
            "--verbose",
        ]
        argv += ["--model", model] if model else []
        return subprocess.run(
            argv,
            input=prompt,
            cwd=ws,
            env=self.env(),
            capture_output=True,
            text=True,
            check=False,
            timeout=RUN_TIMEOUT_S,
        )

    def judge(self, prompt: str, model: str | None) -> tuple[Any, float | None]:
        argv = [
            "claude",
            "-p",
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--no-session-persistence",
            "--tools",
            "",
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(JUDGE_SCHEMA),
        ]
        argv += ["--model", model] if model else []
        with tempfile.TemporaryDirectory(prefix="eval-judge-") as d:
            r = subprocess.run(
                argv,
                input=prompt,
                cwd=d,
                env=self.env(),
                capture_output=True,
                text=True,
                check=False,
                timeout=JUDGE_TIMEOUT_S,
            )
        try:
            out = json.loads(r.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            raise ClientError(f"claude judge exited {r.returncode}: {r.stderr[-400:]}") from None
        if out.get("is_error") or "structured_output" not in out:
            raise ClientError(f"claude judge: {str(out.get('result'))[:400]}")
        return out["structured_output"], out.get("total_cost_usd")


class Codex:
    # --ignore-user-config still reads ~/.agents/skills, ~/.codex/skills,
    # plugins and ~/.codex/AGENTS.md, so each call gets a throwaway HOME and
    # CODEX_HOME whose only content is a symlink to the real auth.json.
    name = "codex"
    base = (
        "codex",
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
    )

    def __init__(self) -> None:
        home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
        self.auth = home / "auth.json"
        if not self.auth.exists():
            raise ClientError(f"codex auth not found at {self.auth}; run `codex login` first")

    def env(self, home: Path) -> dict[str, str]:
        (home / ".codex").mkdir()
        (home / ".codex" / "auth.json").symlink_to(self.auth)
        return {**os.environ, "HOME": str(home), "CODEX_HOME": str(home / ".codex")}

    def run(self, ws: Path, prompt: str, model: str | None) -> subprocess.CompletedProcess[str]:
        argv = [*self.base, "-s", "workspace-write", "--json", "-C", str(ws)]
        argv += ["-m", model] if model else []
        home = Path(tempfile.mkdtemp(prefix="eval-home-"))
        return subprocess.run(
            [*argv, "-"],
            input=prompt,
            cwd=ws,
            env=self.env(home),
            capture_output=True,
            check=False,
            text=True,
            timeout=RUN_TIMEOUT_S,
        )

    def judge(self, prompt: str, model: str | None) -> tuple[Any, float | None]:
        with tempfile.TemporaryDirectory(prefix="eval-judge-") as d:
            schema, out, home = Path(d, "schema.json"), Path(d, "verdict.json"), Path(d, "home")
            home.mkdir()
            schema.write_text(json.dumps(JUDGE_SCHEMA))
            argv = [*self.base, "-s", "read-only", "--output-schema", str(schema), "-o", str(out)]
            argv += ["-m", model] if model else []
            r = subprocess.run(
                [*argv, "-"],
                input=prompt,
                cwd=d,
                env=self.env(home),
                capture_output=True,
                check=False,
                text=True,
                timeout=JUDGE_TIMEOUT_S,
            )
            try:
                return json.loads(out.read_text()), None
            except (OSError, ValueError):
                raise ClientError(f"codex judge exited {r.returncode}: {r.stderr[-400:]}") from None


# --- Workspace ----------------------------------------------------------------------------


def _copy(src: Path, dest: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"))
        for f in dest.rglob("SKILL.fixture.md"):
            f.rename(f.with_name("SKILL.md"))
    else:
        shutil.copy2(src, dest.with_name("SKILL.md") if src.name == "SKILL.fixture.md" else dest)


def make_workspace(skill_dir: Path, case: Case, with_skill: bool) -> Path:
    ws = Path(tempfile.mkdtemp(prefix="eval-ws-")).resolve()
    for entry in case.files:
        _copy(skill_dir / entry, ws / Path(entry).name)
    if with_skill:
        for root in (".claude/skills", ".agents/skills"):
            shutil.copytree(
                skill_dir,
                ws / root / skill_dir.name,
                ignore=shutil.ignore_patterns("evals", "__pycache__", ".DS_Store"),
            )
    return ws


def snapshot(ws: Path, skill: str, limit: int = 2000) -> dict[str, str]:
    """Workspace text by relative path, minus the placed skill under test."""
    hidden = (f".claude/skills/{skill}/", f".agents/skills/{skill}/", ".git/")
    files: dict[str, str] = {}
    for p in sorted(ws.rglob("*")):
        rel = p.relative_to(ws).as_posix()
        if rel.startswith(hidden) or not p.is_file():
            continue
        files[rel] = p.read_text(errors="replace") if p.stat().st_size <= 65536 else ""
        if len(files) >= limit:
            break
    return files


# --- Orchestration ---------------------------------------------------------------------------


class Budget:
    def __init__(self, ceiling: float | None) -> None:
        self.ceiling, self.spent, self.skipped = ceiling, 0.0, 0
        self.lock = threading.Lock()

    def add(self, cost: float | None) -> None:
        with self.lock:
            self.spent += cost or 0.0

    def allow(self) -> bool:
        with self.lock:
            if self.ceiling is not None and self.spent >= self.ceiling:
                self.skipped += 1
                return False
            return True


def run_one(
    client: Client,
    args: argparse.Namespace,
    skill_dir: Path,
    case: Case,
    arm: str,
    n: int,
    out: Path,
    budget: Budget,
) -> RunRecord | None:
    if not budget.allow():
        return None
    run_dir = out / case.name / arm / f"run-{n}"
    run_dir.mkdir(parents=True, exist_ok=True)
    transcript_rel = (run_dir / "transcript.jsonl").relative_to(out).as_posix()
    start = time.monotonic()
    try:
        ws = make_workspace(skill_dir, case, arm == "with_skill")
        before = snapshot(ws, skill_dir.name)
        proc = client.run(ws, case.prompt.replace("<workspace>", str(ws)), args.model)
        seconds = time.monotonic() - start
        (run_dir / "transcript.jsonl").write_text(proc.stdout)
        (run_dir / "stderr.txt").write_text(proc.stderr)
        t = normalise(client.name, proc.stdout.splitlines(), skill_dir.name)
        budget.add(t.cost_usd)
        files = snapshot(ws, skill_dir.name)
        results = [grade(c, t, files) for c in case.checks]
        cost = t.cost_usd
        if case.assertions:
            raw, judge_cost = client.judge(
                judge_prompt(case, t, before, files), args.judge_model or args.model
            )
            budget.add(judge_cost)
            cost = (
                None if cost is None and judge_cost is None else (cost or 0.0) + (judge_cost or 0.0)
            )
            results += verdicts(case, raw)
        error = (
            None
            if proc.returncode == 0
            else f"{client.name} exited {proc.returncode}: {proc.stderr[-300:]}"
        )
    # One run's failure must not lose every other run's results.
    except Exception as e:
        seconds = time.monotonic() - start
        (run_dir / "transcript.jsonl").touch()
        (run_dir / "error.txt").write_text(str(e))
        return RunRecord(
            case.name, arm, n, 0, 0, False, None, seconds, None, str(e), transcript_rel
        )
    passed = sum(r.passed for r in results)
    (run_dir / "grading.json").write_text(
        json.dumps(
            {
                "assertion_results": [r.__dict__ for r in results],
                "summary": {
                    "passed": passed,
                    "failed": len(results) - passed,
                    "total": len(results),
                    "pass_rate": passed / len(results) if results else 1.0,
                },
                "workspace": str(ws),
            },
            indent=2,
        )
    )
    (run_dir / "timing.json").write_text(
        json.dumps(
            {
                "total_tokens": t.tokens,
                "duration_ms": round(seconds * 1000),
                "cost_usd": cost,
                "skill_loaded": t.skill_loaded,
            },
            indent=2,
        )
    )
    return RunRecord(
        case.name,
        arm,
        n,
        passed,
        len(results),
        t.skill_loaded,
        t.tokens,
        seconds,
        cost,
        error,
        transcript_rel,
    )


def _fmt(stat: dict[str, float] | None, pct: bool = False) -> str:
    if not stat:
        return "-"
    return (
        f"{stat['mean']:.0%}±{stat['stddev']:.0%}"
        if pct
        else f"{stat['mean']:.0f}±{stat['stddev']:.0f}"
    )


def table(bench: dict[str, Any]) -> str:
    rows = [
        "case                                      arm            pass       load  tokens         cost"
    ]
    for c in bench["cases"]:
        for arm in ARMS:
            a = c[arm]
            cost = "-" if a["cost_usd"] is None else f"${a['cost_usd']:.2f}"
            load = "-" if a["skill_load_rate"] is None else f"{a['skill_load_rate']:.0%}"
            rows.append(
                f"{c['name'][:40]:<41} {arm:<14} {_fmt(a['pass_rate'], True):<10} {load:<5} "
                f"{_fmt(a['tokens']):<14} {cost}"
            )
    d = bench["run_summary"]["delta"]["pass_rate"]
    rows.append(f"overall pass-rate delta (with - without): {'-' if d is None else f'{d:+.0%}'}")
    return "\n".join(rows)


def report(bench: dict[str, Any], records: Sequence[RunRecord]) -> str:
    lines = [
        f"# Eval report: {bench['meta']['skill']}",
        "",
        "```text",
        table(bench),
        "```",
        "",
        "| case | arm | run | pass | skill loaded | tokens | cost | log |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in sorted(records, key=lambda r: (r.case, r.arm, r.run)):
        cost = "-" if r.cost_usd is None else f"${r.cost_usd:.3f}"
        status = f"error: {r.error[:60]}" if r.error else f"{r.passed}/{r.total}"
        lines.append(
            f"| {r.case} | {r.arm} | {r.run} | {status} | {r.skill_loaded} | {r.tokens or '-'} | {cost} "
            f"| [{r.transcript}]({r.transcript}) |"
        )
    return "\n".join(lines) + "\n"


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # exit 2 is reserved for "partial"
        self.print_usage(sys.stderr)
        print(f"run_evals.py: error: {message}", file=sys.stderr)
        sys.exit(1)


def main(argv: Sequence[str] | None = None) -> int:
    p = Parser(
        description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("skill_dir", type=Path)
    p.add_argument("--agent", required=True, choices=["claude", "codex"])
    p.add_argument("--model")
    p.add_argument("--judge-model", help="default: --model")
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--case", default="*", help="glob over case names")
    p.add_argument("-j", "--jobs", type=int, default=4)
    p.add_argument("--max-cost-usd", type=float, help="stop starting runs once spend reaches this")
    p.add_argument("--out", type=Path)
    args = p.parse_args(argv)

    skill_dir = args.skill_dir.resolve()
    try:
        cases = parse_evals(json.loads((skill_dir / "evals" / "evals.json").read_text()))
    except (OSError, ValueError, EvalsError) as e:
        p.error(f"cannot load {skill_dir}/evals/evals.json: {e}")
    cases = [c for c in cases if fnmatch.fnmatch(c.name, args.case)]
    if not cases:
        p.error(f"no case matches --case {args.case!r}")
    for c in cases:
        for entry in c.files:
            if not (skill_dir / entry).exists():
                p.error(f"case {c.name}: files entry {entry} does not exist")
    if shutil.which(args.agent) is None:
        p.error(f"`{args.agent}` not found on PATH; install it or put it on PATH")
    try:
        client = Claude() if args.agent == "claude" else Codex()
    except ClientError as e:
        p.error(str(e))

    out = (args.out or Path(tempfile.mkdtemp(prefix=f"evals-{skill_dir.name}-"))).resolve()
    out.mkdir(parents=True, exist_ok=True)
    budget = Budget(args.max_cost_usd)
    jobs = [(c, arm, n) for n in range(1, args.runs + 1) for c in cases for arm in ARMS]
    print(f"{len(jobs)} runs -> {out}", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        futures = [
            pool.submit(run_one, client, args, skill_dir, c, arm, n, out, budget)
            for c, arm, n in jobs
        ]
        records = [r for f in futures if (r := f.result()) is not None]

    bench = aggregate(records)
    partial = budget.skipped > 0
    bench["meta"] = {
        "skill": skill_dir.name,
        "agent": args.agent,
        "model": args.model,
        "judge_model": args.judge_model or args.model,
        "runs_per_arm": args.runs,
        "partial": partial,
        "skipped_runs": budget.skipped,
        "spent_usd": round(budget.spent, 4),
    }
    (out / "results.json").write_text(json.dumps(bench, indent=2))
    (out / "report.md").write_text(report(bench, records))
    print(table(bench))
    for r in records:
        if r.error:
            print(f"error: {r.case}/{r.arm}/run-{r.run}: {r.error[:200]}", file=sys.stderr)
    print(f"spent ${budget.spent:.2f}; report: {out / 'report.md'}", file=sys.stderr)
    if partial:
        print(
            f"cost ceiling ${args.max_cost_usd} reached: {budget.skipped} run(s) skipped",
            file=sys.stderr,
        )
        return 2
    return 0 if all(case_passed(c) for c in bench["cases"]) else 1


if __name__ == "__main__":
    sys.exit(main())
