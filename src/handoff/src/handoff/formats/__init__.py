"""Format detection, session-id resolution, and load/materialise dispatch.

Direct port of `src/formats/mod.rs`. The per-format loaders and writers live in
`claude.py` and `codex.py`; this module owns everything around them: detecting a
file's format, resolving a bare session id to a path in the native stores, reading
and writing the IR itself, and dispatching to the right format module.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .._json import dumps_pretty
from ..errors import HandoffError, bail, ctx
from ..ir import SessionFormat, SourceFormat, UniversalSession
from . import claude, codex

__all__ = [
    "ResolvedInput",
    "claude_root",
    "codex_root",
    "default_output_root",
    "detect_format",
    "load_ir",
    "load_session",
    "materialize",
    "resolve_input",
    "write_ir",
]


@dataclass(frozen=True, slots=True)
class ResolvedInput:
    """An input path paired with its resolved concrete format (`ResolvedInput`)."""

    path: Path
    format: SessionFormat


def detect_format(path: Path) -> SessionFormat:
    """Sniff a file's format (`detect_format`).

    A whole-file JSON object carrying `ir_version` is IR; otherwise the first
    non-empty line decides: `ir_version` -> IR, `type == "session_meta"` -> Codex,
    a `sessionId` key -> Claude.
    """
    with ctx(lambda: f"failed to read input for format detection: {path}"):
        raw = path.read_bytes()
    with ctx(lambda: f"input is not valid UTF-8: {path}"):
        text = raw.decode("utf-8")

    whole = _try_json(text)
    if isinstance(whole, dict) and "ir_version" in whole:
        return SessionFormat.IR

    first_line = next((line for line in text.splitlines() if line.strip()), None)
    if first_line is None:
        bail("input file is empty")

    with ctx("failed to parse the first JSON line"):
        value = json.loads(first_line)

    if isinstance(value, dict):
        if "ir_version" in value:
            return SessionFormat.IR
        if value.get("type") == "session_meta":
            return SessionFormat.CODEX
        if "sessionId" in value:
            return SessionFormat.CLAUDE

    bail(f"could not detect format for {path}")


def _try_json(text: str) -> object | None:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def resolve_input(path: Path, source_format: SourceFormat) -> ResolvedInput:
    """Resolve a path or bare session id to a concrete input (`resolve_input`)."""
    if path.exists():
        explicit = source_format.explicit()
        resolved_format = explicit if explicit is not None else detect_format(path)
        return ResolvedInput(path=path, format=resolved_format)

    session_id = str(path).strip()
    if not session_id:
        bail("input path is empty")

    explicit = source_format.explicit()
    if explicit is SessionFormat.IR:
        bail(
            "IR input must be addressed by file path; "
            "session-id lookup only works for Codex and Claude"
        )
    if explicit is SessionFormat.CODEX:
        return ResolvedInput(path=_resolve_codex_session_id(session_id), format=SessionFormat.CODEX)
    if explicit is SessionFormat.CLAUDE:
        return ResolvedInput(
            path=_resolve_claude_session_id(session_id), format=SessionFormat.CLAUDE
        )

    codex_path = _try_resolve(_resolve_codex_session_id, session_id)
    claude_path = _try_resolve(_resolve_claude_session_id, session_id)
    match (codex_path, claude_path):
        case (Path() as found, None):
            return ResolvedInput(path=found, format=SessionFormat.CODEX)
        case (None, Path() as found):
            return ResolvedInput(path=found, format=SessionFormat.CLAUDE)
        case (Path(), Path()):
            bail(f"session id {session_id} exists in both Codex and Claude stores; specify --from")
        case _:
            bail(
                f"could not resolve {session_id} as a path or native session id "
                "in the default Codex/Claude stores"
            )


def _try_resolve(resolver: Callable[[str], Path], session_id: str) -> Path | None:
    try:
        return resolver(session_id)
    except HandoffError:
        return None


def load_session(path: Path, source_format: SourceFormat) -> UniversalSession:
    """Resolve then load a session into the IR (`load_session`)."""
    resolved = resolve_input(path, source_format)
    match resolved.format:
        case SessionFormat.IR:
            return load_ir(resolved.path)
        case SessionFormat.CODEX:
            return codex.load(resolved.path)
        case SessionFormat.CLAUDE:
            return claude.load(resolved.path)


def write_ir(session: UniversalSession, output: Path) -> None:
    """Write the IR as pretty JSON (`write_ir`)."""
    parent = output.parent
    if str(parent):
        with ctx(lambda: f"failed to create parent directory for {output}"):
            parent.mkdir(parents=True, exist_ok=True)
    with ctx("failed to encode IR JSON"):
        text = dumps_pretty(session.to_json_dict())
    with ctx(lambda: f"failed to write {output}"):
        output.write_text(text, encoding="utf-8")


def load_ir(path: Path) -> UniversalSession:
    """Parse an IR file (`load_ir`)."""
    with ctx(lambda: f"failed to read IR file {path}"):
        text = path.read_text(encoding="utf-8")
    with ctx(lambda: f"failed to parse {path}"):
        return UniversalSession.from_json_dict(json.loads(text))


def materialize(session: UniversalSession, target: SessionFormat, output: Path) -> Path:
    """Write the session in `target` format, returning the primary file (`materialize`)."""
    match target:
        case SessionFormat.IR:
            write_ir(session, output)
            return output
        case SessionFormat.CODEX:
            return codex.write(session, output)
        case SessionFormat.CLAUDE:
            return claude.write(session, output)


def default_output_root(target: SessionFormat) -> Path:
    """Default store root for a target format (`default_output_root`)."""
    match target:
        case SessionFormat.CODEX:
            return codex_root()
        case SessionFormat.CLAUDE:
            return claude_root()
        case SessionFormat.IR:
            bail("IR output requires an explicit file path")


def _resolve_codex_session_id(session_id: str) -> Path:
    sessions_root = codex_root() / "sessions"
    suffix = f"-{session_id}.jsonl"
    with ctx(lambda: f"could not find Codex session {session_id} under {sessions_root}"):
        return _find_in_tree(sessions_root, lambda p: p.name.endswith(suffix))


def _resolve_claude_session_id(session_id: str) -> Path:
    projects_root = claude_root() / "projects"
    target_name = f"{session_id}.jsonl"
    with ctx(lambda: f"could not find Claude session {session_id} under {projects_root}"):
        return _find_in_tree(projects_root, lambda p: p.name == target_name)


def codex_root() -> Path:
    """Codex home (`codex_root`): $HANDOFF_CODEX_HOME > $CODEX_HOME > ~/.codex."""
    return _discover_root("HANDOFF_CODEX_HOME", ["CODEX_HOME"], ".codex")


def claude_root() -> Path:
    """Claude home (`claude_root`): $HANDOFF_CLAUDE_HOME > $CLAUDE_CONFIG_DIR > $CLAUDE_HOME > ~/.claude."""
    return _discover_root("HANDOFF_CLAUDE_HOME", ["CLAUDE_CONFIG_DIR", "CLAUDE_HOME"], ".claude")


def _discover_root(primary_env: str, secondary_envs: list[str], suffix: str) -> Path:
    primary = _env_path(primary_env)
    if primary is not None:
        return primary
    for env_name in secondary_envs:
        found = _env_path(env_name)
        if found is not None:
            return found
    home = os.environ.get("HOME")
    if home is None:
        bail("HOME is not set")
    return Path(home) / suffix


def _env_path(name: str) -> Path | None:
    raw = os.environ.get(name)
    return Path(raw) if raw is not None else None


def _find_in_tree(root: Path, predicate: Callable[[Path], bool]) -> Path:
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            entries = list(current.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.is_dir():
                stack.append(entry)
            elif predicate(entry):
                return entry
    bail(f"could not find a matching session under {root}")
