#!/usr/bin/env python3
"""Resolve a live Claude Code process to a session id.

This is intentionally read-only. It combines Claude's pid registry, launch
arguments, open transcript files, and pane-content verification.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import cast

SESSION_ID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


JsonScalar = str | int | float | bool | None
JsonValue = JsonScalar | dict[str, "JsonValue"] | list["JsonValue"]
JsonObject = dict[str, JsonValue]


@dataclass(frozen=True)
class ResolveResult:
    status: str
    pid: int
    session_id: str = ""
    source: str = ""
    cwd: str = ""
    name: str = ""
    claude_status: str = ""
    reason: str = ""
    evidence: tuple[str, ...] = ()
    candidates: tuple[JsonObject, ...] = ()

    def to_json(self) -> JsonObject:
        data: JsonObject = {"status": self.status, "pid": self.pid}
        if self.session_id:
            data["sessionId"] = self.session_id
        if self.source:
            data["source"] = self.source
        if self.cwd:
            data["cwd"] = self.cwd
        if self.name:
            data["name"] = self.name
        if self.claude_status:
            data["claudeStatus"] = self.claude_status
        if self.reason:
            data["reason"] = self.reason
        if self.evidence:
            data["evidence"] = list(self.evidence)
        if self.candidates:
            data["candidates"] = list(self.candidates)
        return data


def home_path(*parts: str) -> Path:
    return Path(os.environ.get("HOME", str(Path.home()))).joinpath(*parts)


def run(args: list[str]) -> str:
    try:
        proc = subprocess.run(args, check=False, text=True, capture_output=True)
    except OSError:
        return ""
    if proc.returncode != 0:
        return ""
    return proc.stdout


def normalise(text: str) -> str:
    return " ".join(ANSI_RE.sub(" ", text).split()).lower()


def json_object(value: object) -> JsonObject | None:
    if not isinstance(value, dict):
        return None
    return cast(JsonObject, value)


def json_line_object(line: str) -> JsonObject | None:
    try:
        loaded: object = json.loads(line)
    except json.JSONDecodeError:
        return None
    return json_object(loaded)


def object_str(obj: JsonObject, key: str) -> str:
    value = obj.get(key)
    return value if isinstance(value, str) else ""


def object_int(obj: JsonObject, key: str) -> int:
    value = obj.get(key)
    return value if isinstance(value, int) else 0


def registry_result(pid: str, config_dir: Path) -> ResolveResult | None:
    path = config_dir / "sessions" / f"{pid}.json"
    try:
        loaded: object = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    meta = json_object(loaded)
    if meta is None:
        return None
    sid = object_str(meta, "sessionId")
    if not sid:
        return None
    return ResolveResult(
        "resolved",
        pid=int(pid),
        session_id=sid,
        source="registry",
        cwd=object_str(meta, "cwd"),
        name=object_str(meta, "name"),
        claude_status=object_str(meta, "status"),
        evidence=(f"registry:{path}",),
    )


def command_for_pid(pid: str) -> str:
    return run(["ps", "-o", "command=", "-p", pid]).strip()


def parse_session_id_from_command(command: str) -> str:
    if not command:
        return ""
    try:
        args = shlex.split(command)
    except ValueError:
        args = command.split()
    for i, arg in enumerate(args):
        if arg.startswith("--resume=") or arg.startswith("--session-id="):
            return arg.split("=", 1)[1]
        if arg in {"--resume", "--session-id", "-r"} and i + 1 < len(args):
            return args[i + 1]
    return ""


def cwd_for_pid(pid: str) -> str:
    field_out = run(["lsof", "-a", "-p", pid, "-d", "cwd", "-Fn"])
    for line in field_out.splitlines():
        if line.startswith("n/"):
            return line[1:]

    out = run(["lsof", "-a", "-p", pid, "-d", "cwd"])
    for line in reversed(out.splitlines()):
        parts = line.split()
        if parts and parts[-1].startswith("/"):
            return parts[-1]
    return ""


def launch_arg_result(pid: str, cwd: str) -> ResolveResult | None:
    command = command_for_pid(pid)
    sid = parse_session_id_from_command(command)
    if not sid:
        return None
    return ResolveResult(
        "resolved",
        pid=int(pid),
        session_id=sid,
        source="launch-args",
        cwd=cwd or cwd_for_pid(pid),
        evidence=(f"command:{command}",),
    )


def session_id_from_jsonl(path: Path) -> str:
    try:
        with path.open(errors="replace") as fh:
            for line in fh:
                obj = json_line_object(line)
                if obj is None:
                    continue
                sid = object_str(obj, "sessionId")
                if sid:
                    return sid
    except OSError:
        return ""
    return path.stem if SESSION_ID_RE.match(path.stem) else ""


def open_jsonl_result(pid: str, cwd: str, config_dir: Path) -> ResolveResult | None:
    paths: list[Path] = []
    seen: set[str] = set()

    field_out = run(["lsof", "-p", pid, "-Fn"])
    candidates = [line[1:] for line in field_out.splitlines() if line.startswith("n/")]
    if not candidates:
        out = run(["lsof", "-p", pid])
        candidates = [line.split()[-1] for line in out.splitlines() if line.split()]

    projects_prefix = f"{config_dir}/projects/"
    for candidate in candidates:
        if projects_prefix not in candidate or not candidate.endswith(".jsonl"):
            continue
        if candidate not in seen:
            seen.add(candidate)
            paths.append(Path(candidate))
    if len(paths) != 1:
        return None
    sid = session_id_from_jsonl(paths[0])
    if not sid:
        return None
    return ResolveResult(
        "resolved",
        pid=int(pid),
        session_id=sid,
        source="open-jsonl",
        cwd=cwd or cwd_for_pid(pid),
        evidence=(f"open-jsonl:{paths[0]}",),
    )


def project_slug(cwd: str) -> str:
    # Claude slugs EVERY non-alphanumeric char to "-" (dots included), so
    # ~/.trees/x becomes --trees-x; a bare "/" replace misses dotted paths.
    return re.sub(r"[^A-Za-z0-9]", "-", cwd)


def candidate_jsonls(cwd: str, config_dir: Path) -> list[Path]:
    if not cwd:
        return []
    project_dir = config_dir / "projects" / project_slug(cwd)
    try:
        return sorted(project_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return []


def capture_text(pane: str, capture_file: str) -> str:
    if capture_file:
        try:
            return Path(capture_file).read_text(errors="replace")
        except OSError:
            return ""
    if not pane:
        return ""
    return run(["tmux", "capture-pane", "-p", "-J", "-t", pane, "-S", "-3000"])


def text_parts(obj: JsonObject) -> list[str]:
    msg = json_object(obj.get("message"))
    if msg is None:
        return []
    content = msg.get("content")
    parts: list[str] = []
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            else:
                content_obj = json_object(item)
                if content_obj is not None:
                    text = object_str(content_obj, "text")
                    if text:
                        parts.append(text)
    return parts


def chunk_windows(text: str) -> list[str]:
    words = text.split()
    if len(text) >= 35 and len(words) < 8:
        return [text]
    chunks: list[str] = []
    for i in range(0, max(0, len(words) - 7), 4):
        chunk = " ".join(words[i : i + 8])
        if len(chunk) >= 35:
            chunks.append(chunk)
    return chunks


def score_jsonl(path: Path, capture_norm: str) -> JsonObject:
    score = 0
    sid = ""
    hits: list[str] = []
    seen_hits: set[str] = set()
    try:
        with path.open(errors="replace") as fh:
            for line in fh:
                obj = json_line_object(line)
                if obj is None:
                    continue
                if not sid:
                    sid = object_str(obj, "sessionId")
                weight = 2 if obj.get("type") == "user" else 1
                for part in text_parts(obj):
                    for chunk in chunk_windows(normalise(part)):
                        if chunk in capture_norm and chunk not in seen_hits:
                            seen_hits.add(chunk)
                            score += weight
                            hits.append(chunk[:120])
                            if len(hits) >= 8:
                                return {
                                    "path": str(path),
                                    "sessionId": sid or path.stem,
                                    "score": score,
                                    "hits": hits,
                                }
    except OSError:
        pass
    return {"path": str(path), "sessionId": sid or path.stem, "score": score, "hits": hits}


def content_match_result(
    pid: str, pane: str, cwd: str, capture_file: str, config_dir: Path
) -> ResolveResult | None:
    capture_norm = normalise(capture_text(pane, capture_file))
    if len(capture_norm) < 40:
        return None
    scored = [score_jsonl(path, capture_norm) for path in candidate_jsonls(cwd, config_dir)]
    scored = [item for item in scored if object_int(item, "score") > 0]
    if not scored:
        return ResolveResult(
            "unresolved", pid=int(pid), reason="no transcript matched visible pane text"
        )
    scored.sort(key=lambda item: object_int(item, "score"), reverse=True)
    top = scored[0]
    top_score = object_int(top, "score")
    if top_score < 2:
        return ResolveResult(
            "unresolved",
            pid=int(pid),
            reason="transcript evidence below threshold",
            candidates=tuple(scored[:5]),
        )
    if len(scored) > 1 and object_int(scored[1], "score") == top_score:
        return ResolveResult(
            "ambiguous",
            pid=int(pid),
            reason="multiple transcripts matched equally",
            candidates=tuple(scored[:5]),
        )
    hits_value = top.get("hits", [])
    hits = tuple(str(hit) for hit in hits_value) if isinstance(hits_value, list) else ()
    return ResolveResult(
        "resolved",
        pid=int(pid),
        session_id=object_str(top, "sessionId"),
        source="content-match",
        cwd=cwd,
        evidence=(f"matched:{object_str(top, 'path')}", *hits),
        candidates=tuple(scored[:5]),
    )


def resolve(args: argparse.Namespace) -> ResolveResult:
    pid = str(args.pid)
    cwd = args.cwd or cwd_for_pid(pid)
    config_dir = Path(args.config_dir) if args.config_dir else home_path(".claude")
    for resolver in (
        lambda: registry_result(pid, config_dir),
        lambda: launch_arg_result(pid, cwd),
        lambda: open_jsonl_result(pid, cwd, config_dir),
        lambda: content_match_result(
            pid, args.pane or "", cwd, args.capture_file or "", config_dir
        ),
    ):
        resolved = resolver()
        if not resolved:
            continue
        if resolved.status != "unresolved":
            return resolved
    return ResolveResult(
        "unresolved",
        pid=int(pid),
        reason="no registry, launch argument, open transcript, or content match",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", required=True, type=int)
    parser.add_argument("--pane", default="")
    parser.add_argument("--cwd", default="")
    parser.add_argument("--config-dir", default="")
    parser.add_argument("--capture-file", default="")
    parser.add_argument("--format", choices=["json", "session-id"], default="json")
    args = parser.parse_args()

    resolved = resolve(args)
    if args.format == "session-id":
        if resolved.status == "resolved":
            print(resolved.session_id)
        return 0 if resolved.status == "resolved" else 1

    print(json.dumps(resolved.to_json(), sort_keys=True))
    if resolved.status == "resolved":
        return 0
    if resolved.status == "ambiguous":
        return 2
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
