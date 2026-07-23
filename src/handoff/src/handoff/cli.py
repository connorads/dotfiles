"""Command-line interface (port of `src/cli.rs` + `src/main.rs`).

The Rust CLI is built with `clap` and has two coexisting surfaces:

- a *default quick-convert* mode (positional ``INPUT`` plus ``--from`` / ``--to`` /
  ``--output`` / ``--keep-session-id`` / ``--no-open``), and
- four subcommands: ``inspect``, ``import``, ``export``, ``convert``.

clap glues them together with ``args_conflicts_with_subcommands`` and
``subcommand_negates_reqs`` so the top-level positional/flags and the subcommands
never fight. argparse has no direct analogue, so this port routes on the first token:
if ``sys.argv[1]`` names a subcommand we parse with that subcommand's parser, otherwise
we parse the quick-convert surface. See the module docstring notes on the deviations.

Errors mirror `anyhow`: every failure is a :class:`HandoffError`, and :func:`main`
prints it to stderr in anyhow's ``Error: ...`` / ``Caused by:`` chain form, exiting 1.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from . import __version__
from ._ids import is_uuid, new_uuid4, new_uuid7
from ._json import dumps_pretty, sort_value
from .errors import HandoffError, bail, ctx
from .formats import (
    default_output_root,
    load_ir,
    load_session,
    materialize,
    resolve_input,
    write_ir,
)
from .ir import SessionFormat, SourceFormat, UniversalSession

__all__ = ["main", "run"]

_ABOUT = "Translate session storage between Codex, Claude, and a universal IR"
_AFTER_HELP = (
    "Quick usage:\n"
    "  handoff --from claude --to codex <SESSION_ID>\n"
    "  handoff --from codex --to claude <SESSION_ID>\n"
    "  handoff --from claude --to codex <SESSION_ID> --no-open\n\n"
    "Advanced usage remains available through subcommands such as "
    "inspect/import/export/convert."
)
_SUBCOMMANDS = ("inspect", "import", "export", "convert")


# --- clap value-enum converters ----------------------------------------------------


def _source_format(value: str) -> SourceFormat:
    try:
        return SourceFormat(value)
    except ValueError:
        allowed = ", ".join(fmt.value for fmt in SourceFormat)
        raise argparse.ArgumentTypeError(
            f"invalid value '{value}' (possible values: {allowed})"
        ) from None


def _session_format(value: str) -> SessionFormat:
    try:
        return SessionFormat(value)
    except ValueError:
        allowed = ", ".join(fmt.value for fmt in SessionFormat)
        raise argparse.ArgumentTypeError(
            f"invalid value '{value}' (possible values: {allowed})"
        ) from None


# --- parsers -----------------------------------------------------------------------


def _quick_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="handoff",
        description=_ABOUT,
        epilog=_AFTER_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        allow_abbrev=False,
    )
    parser.add_argument("--version", action="version", version=f"handoff {__version__}")
    parser.add_argument("--from", dest="from_", type=_source_format, metavar="FROM")
    parser.add_argument("--to", dest="to", type=_session_format, metavar="TO")
    parser.add_argument("--output", dest="output", metavar="OUTPUT")
    parser.add_argument("--keep-session-id", dest="keep_session_id", action="store_true")
    parser.add_argument("--no-open", dest="no_open", action="store_true")
    parser.add_argument("input", nargs="?")
    return parser


def _inspect_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="handoff inspect", allow_abbrev=False)
    parser.add_argument("input")
    parser.add_argument(
        "--from",
        dest="from_",
        type=_source_format,
        default=SourceFormat.AUTO,
        metavar="FROM",
    )
    parser.add_argument("--json", dest="json", action="store_true")
    return parser


def _import_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="handoff import", allow_abbrev=False)
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument(
        "--from",
        dest="from_",
        type=_source_format,
        default=SourceFormat.AUTO,
        metavar="FROM",
    )
    return parser


def _export_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="handoff export", allow_abbrev=False)
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--to", dest="to", type=_session_format, required=True, metavar="TO")
    parser.add_argument("--new-session-id", dest="new_session_id", action="store_true")
    return parser


def _convert_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="handoff convert", allow_abbrev=False)
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument(
        "--from",
        dest="from_",
        type=_source_format,
        default=SourceFormat.AUTO,
        metavar="FROM",
    )
    parser.add_argument("--to", dest="to", type=_session_format, required=True, metavar="TO")
    parser.add_argument("--new-session-id", dest="new_session_id", action="store_true")
    return parser


# --- entry points ------------------------------------------------------------------


def run(argv: list[str] | None = None) -> None:
    """Dispatch a parsed command (`cli::run`).

    Routes on the first token: a subcommand name selects that subcommand's parser,
    anything else is the default quick-convert surface (mirroring clap's
    `args_conflicts_with_subcommands` / `subcommand_negates_reqs`).
    """
    argv = list(sys.argv[1:] if argv is None else argv)

    if argv and argv[0] in _SUBCOMMANDS:
        command = argv[0]
        rest = argv[1:]
        match command:
            case "inspect":
                args = _inspect_parser().parse_args(rest)
                _inspect(args.input, args.from_, args.json)
            case "import":
                args = _import_parser().parse_args(rest)
                _import(args.input, args.output, args.from_)
            case "export":
                args = _export_parser().parse_args(rest)
                _export(args.input, args.output, args.to, args.new_session_id)
            case "convert":
                args = _convert_parser().parse_args(rest)
                _convert(args.input, args.output, args.from_, args.to, args.new_session_id)
        return

    args = _quick_parser().parse_args(argv)
    _quick_convert(args.input, args.from_, args.to, args.output, args.keep_session_id, args.no_open)


def main() -> None:
    """Process entry point (`main.rs`).

    Runs :func:`run`; a :class:`HandoffError` is printed in anyhow's chain form
    to stderr and the process exits 1.
    """
    try:
        run()
    except HandoffError as exc:
        print(_format_error_chain(exc), file=sys.stderr)
        raise SystemExit(1) from None


# --- quick convert -----------------------------------------------------------------


def _quick_convert(
    input_: str | None,
    from_: SourceFormat | None,
    to: SessionFormat | None,
    output: str | None,
    keep_session_id: bool,
    no_open: bool,
) -> None:
    if input_ is None:
        bail("missing input session id or path")
    source_format = from_ if from_ is not None else SourceFormat.AUTO
    if to is None:
        bail("missing --to; example: handoff --from claude --to codex <SESSION_ID>")

    with ctx(lambda: f"failed to load source session {input_}"):
        session = load_session(Path(input_), source_format)

    if to is SessionFormat.IR and output is None:
        bail("IR output requires --output with a target file path")

    output_path = Path(output) if output is not None else default_output_root(to)
    wrote_standalone_jsonl = output_path.suffix == ".jsonl"

    _maybe_rekey_session(session, (not keep_session_id) and to is not SessionFormat.IR, to)
    path = materialize(session, to, output_path)

    print(f"created {to.value} session: {session.metadata.session_id}")
    print(f"stored at: {path}")
    hint = _resume_hint(to, session.metadata.session_id)
    if hint is not None:
        print(f"resume with: {hint}")
    _maybe_open_session(
        to,
        session.metadata.session_id,
        output_path,
        session.metadata.cwd,
        wrote_standalone_jsonl,
        no_open,
    )


# --- subcommands -------------------------------------------------------------------


def _inspect(input_: str, from_: SourceFormat, json_flag: bool) -> None:
    detected = resolve_input(Path(input_), from_).format
    session = load_session(Path(input_), from_)
    summary = _summarize(session)

    if json_flag:
        value = {"detected_format": detected.value, "summary": summary}
        print(dumps_pretty(sort_value(value)))
    else:
        print(f"format: {detected.value}")
        print(f"session_id: {session.metadata.session_id}")
        if session.metadata.title is not None:
            print(f"title: {session.metadata.title}")
        if session.metadata.cwd is not None:
            print(f"cwd: {session.metadata.cwd}")
        print(f"events: {len(session.events)}")
        for kind, count in summary.items():
            print(f"{kind}: {count}")


def _import(input_: str, output: str, from_: SourceFormat) -> None:
    session = load_session(Path(input_), from_)
    write_ir(session, Path(output))
    print(output)


def _export(input_: str, output: str, to: SessionFormat, new_session_id: bool) -> None:
    session = load_ir(Path(input_))
    _maybe_rekey_session(session, new_session_id, to)
    path = materialize(session, to, Path(output))
    print(path)


def _convert(
    input_: str,
    output: str,
    from_: SourceFormat,
    to: SessionFormat,
    new_session_id: bool,
) -> None:
    with ctx(lambda: f"failed to load source session {input_}"):
        session = load_session(Path(input_), from_)
    _maybe_rekey_session(session, new_session_id, to)
    path = materialize(session, to, Path(output))
    print(path)


# --- helpers -----------------------------------------------------------------------


def _summarize(session: UniversalSession) -> dict[str, int]:
    """Count events by kind, keys sorted (`summarize`; Rust `BTreeMap`)."""
    counts: dict[str, int] = {}
    for event in session.events:
        counts[event.KIND] = counts.get(event.KIND, 0) + 1
    return {key: counts[key] for key in sorted(counts)}


def _maybe_rekey_session(
    session: UniversalSession, new_session_id: bool, target: SessionFormat
) -> None:
    """Assign a session id when required (`maybe_rekey_session`).

    Note the inverted call from quick-convert: even when *keeping* the id
    (``new_session_id`` false), a non-UUID id is replaced because native Codex/Claude
    stores require a UUID.
    """
    if not new_session_id:
        if target is SessionFormat.CODEX and not is_uuid(session.metadata.session_id):
            session.metadata.session_id = new_uuid7()
        if target is SessionFormat.CLAUDE and not is_uuid(session.metadata.session_id):
            session.metadata.session_id = new_uuid4()
        return

    match target:
        case SessionFormat.IR:
            session.metadata.session_id = new_uuid4()
        case SessionFormat.CODEX:
            session.metadata.session_id = new_uuid7()
        case SessionFormat.CLAUDE:
            session.metadata.session_id = new_uuid4()


def _resume_hint(format_: SessionFormat, session_id: str) -> str | None:
    """The `resume with:` hint for a target format (`resume_hint`)."""
    match format_:
        case SessionFormat.CODEX:
            return f"codex resume {session_id}"
        case SessionFormat.CLAUDE:
            return f"claude -r {session_id}"
        case SessionFormat.IR:
            return None


def _maybe_open_session(
    format_: SessionFormat,
    session_id: str,
    output_root: Path,
    session_cwd: str | None,
    wrote_standalone_jsonl: bool,
    no_open: bool,
) -> None:
    """Launch the native CLI to resume the session (`maybe_open_session`)."""
    if no_open or format_ is SessionFormat.IR:
        return

    if wrote_standalone_jsonl:
        bail(
            "automatic open requires writing into a native Codex/Claude home "
            "directory, not a standalone .jsonl file; pass --no-open to keep the "
            "conversion only"
        )

    argv, env, cwd = _resume_command(format_, session_id, output_root, session_cwd)
    print(f"opening {format_.value} session...")
    with ctx("failed to flush stdout"):
        sys.stdout.flush()

    with ctx(lambda: f"failed to launch {format_.value}"):
        result = subprocess.run(argv, env=env, cwd=cwd)
    if result.returncode != 0:
        code = "signal" if result.returncode < 0 else str(result.returncode)
        bail(f"{format_.value} exited with status {code}")


def _resume_command(
    format_: SessionFormat,
    session_id: str,
    output_root: Path,
    session_cwd: str | None,
) -> tuple[list[str], dict[str, str], str | None]:
    """Build the resume command's argv, environment, and cwd (`resume_command`)."""
    _prepare_runtime_home(format_, output_root)

    match format_:
        case SessionFormat.CODEX:
            argv = [_codex_binary(), "resume", session_id]
        case SessionFormat.CLAUDE:
            argv = [_claude_binary(), "-r", session_id]
        case SessionFormat.IR:
            bail("cannot open IR directly")

    env = dict(os.environ)
    match format_:
        case SessionFormat.CODEX:
            env["CODEX_HOME"] = str(output_root)
        case SessionFormat.CLAUDE:
            env["CLAUDE_CONFIG_DIR"] = str(output_root)
            env["CLAUDE_HOME"] = str(output_root)
        case SessionFormat.IR:
            pass

    cwd: str | None = None
    if session_cwd is not None and Path(session_cwd).is_dir():
        cwd = session_cwd

    return argv, env, cwd


def _codex_binary() -> str:
    """Codex binary, overridable via `$HANDOFF_CODEX_BIN` (`codex_binary`)."""
    return os.environ.get("HANDOFF_CODEX_BIN", "codex")


def _claude_binary() -> str:
    """Claude binary, overridable via `$HANDOFF_CLAUDE_BIN` (`claude_binary`)."""
    return os.environ.get("HANDOFF_CLAUDE_BIN", "claude")


def _prepare_runtime_home(format_: SessionFormat, output_root: Path) -> None:
    """Prepare the target home before launch (`prepare_runtime_home`)."""
    match format_:
        case SessionFormat.CODEX:
            _bootstrap_codex_auth(output_root)
        case SessionFormat.CLAUDE | SessionFormat.IR:
            pass


def _bootstrap_codex_auth(output_root: Path) -> None:
    """Symlink the installed Codex `auth.json` into a fresh home (`bootstrap_codex_auth`)."""
    installed_home = _installed_codex_home()
    if _same_path(installed_home, output_root):
        return

    source_auth = installed_home / "auth.json"
    if not source_auth.is_file():
        return

    target_auth = output_root / "auth.json"
    if target_auth.exists():
        return

    with ctx(lambda: f"failed to link Codex auth from {source_auth} to {target_auth}"):
        os.symlink(source_auth, target_auth)


def _installed_codex_home() -> Path:
    """The installed Codex home: `$CODEX_HOME` else `~/.codex` (`installed_codex_home`)."""
    codex_home = os.environ.get("CODEX_HOME")
    if codex_home is not None:
        return Path(codex_home)
    home = os.environ.get("HOME")
    if home is None:
        bail("HOME is not set")
    return Path(home) / ".codex"


def _same_path(lhs: Path, rhs: Path) -> bool:
    """True if two paths refer to the same location (`same_path`).

    Matches Rust `fs::canonicalize`: an equal comparison first, else canonicalise both
    (which requires each to exist) and compare; any failure is treated as *not* same.
    """
    if lhs == rhs:
        return True
    try:
        return lhs.resolve(strict=True) == rhs.resolve(strict=True)
    except OSError:
        return False


def _format_error_chain(exc: HandoffError) -> str:
    """Render an error like anyhow's `Debug` (`main.rs`'s `Error: {:?}`)."""
    causes: list[str] = []
    cause = exc.__cause__
    while cause is not None:
        causes.append(str(cause))
        cause = cause.__cause__

    out = f"Error: {exc}"
    if causes:
        out += "\n\nCaused by:"
        if len(causes) == 1:
            out += f"\n    {causes[0]}"
        else:
            for index, message in enumerate(causes):
                out += f"\n{index:>5}: {message}"
    return out
