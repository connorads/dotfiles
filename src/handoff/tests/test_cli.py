"""CLI subprocess tests.

Ported from `tests/roundtrip.rs` (the tests that spawn `CARGO_BIN_EXE_handoff`):

- `resolves_codex_session_ids_from_default_store_roots`
- `resolves_claude_session_ids_from_default_store_roots`
- `resolves_claude_session_ids_from_claude_config_dir_root`
- `quick_cli_converts_by_session_id_and_prints_resume_hint`
- `quick_cli_opens_claude_target_by_default`
- `quick_cli_opens_codex_target_by_default_bootstraps_auth`
- `quick_cli_opens_target_agent_by_default`

The Rust `.env(...)` / `.env_remove(...)` builder calls map to the `run_cli` fixture's
`env=` / `remove_env=` arguments (subprocess env; no in-process leakage). Fake agent
launchers are POSIX shell scripts, matching the Rust `fake-claude.sh` / `fake-codex.sh`.
"""

from __future__ import annotations

import shlex
import stat
from collections.abc import Callable
from pathlib import Path

import pytest
from handoff.formats import load_session, materialize
from handoff.ir import SessionFormat, SourceFormat


def _make_executable(path: Path, contents: str) -> None:
    path.write_text(contents, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP)


def test_resolves_codex_session_ids_from_default_store_roots(
    fixture: Callable[[str], Path],
    tmp_path: Path,
    run_cli: Callable[..., object],
) -> None:
    """Rust `resolves_codex_session_ids_from_default_store_roots`."""
    session = load_session(fixture("codex_sample.jsonl"), SourceFormat.CODEX)
    materialize(session, SessionFormat.CODEX, tmp_path)

    result = run_cli(
        "inspect",
        "019cd6bd-10df-7e61-8506-e9ac5bdf4e6e",
        "--from",
        "codex",
        "--json",
        env={"HANDOFF_CODEX_HOME": tmp_path},
    )

    assert result.returncode == 0
    assert '"detected_format": "codex"' in result.stdout


def test_resolves_claude_session_ids_from_default_store_roots(
    fixture: Callable[[str], Path],
    tmp_path: Path,
    run_cli: Callable[..., object],
) -> None:
    """Rust `resolves_claude_session_ids_from_default_store_roots`."""
    session = load_session(fixture("claude_sample.jsonl"), SourceFormat.CLAUDE)
    materialize(session, SessionFormat.CLAUDE, tmp_path)

    result = run_cli(
        "inspect",
        "d89e26cd-11f2-47e8-bea5-a73ad5458483",
        "--from",
        "claude",
        "--json",
        env={"HANDOFF_CLAUDE_HOME": tmp_path},
    )

    assert result.returncode == 0
    assert '"detected_format": "claude"' in result.stdout


def test_resolves_claude_session_ids_from_claude_config_dir_root(
    fixture: Callable[[str], Path],
    tmp_path: Path,
    run_cli: Callable[..., object],
) -> None:
    """Rust `resolves_claude_session_ids_from_claude_config_dir_root`."""
    session = load_session(fixture("claude_sample.jsonl"), SourceFormat.CLAUDE)
    materialize(session, SessionFormat.CLAUDE, tmp_path)

    result = run_cli(
        "inspect",
        "d89e26cd-11f2-47e8-bea5-a73ad5458483",
        "--from",
        "claude",
        "--json",
        remove_env=("HANDOFF_CLAUDE_HOME", "CLAUDE_HOME"),
        env={"CLAUDE_CONFIG_DIR": tmp_path},
    )

    assert result.returncode == 0
    assert '"detected_format": "claude"' in result.stdout


def test_quick_cli_converts_by_session_id_and_prints_resume_hint(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """Rust `quick_cli_converts_by_session_id_and_prints_resume_hint`."""
    source_session = load_session(fixture("claude_sample.jsonl"), SourceFormat.CLAUDE)
    source_home = tmp_path_factory.mktemp("source_home")
    target_home = tmp_path_factory.mktemp("target_home")
    materialize(source_session, SessionFormat.CLAUDE, source_home)

    result = run_cli(
        "--from",
        "claude",
        "--to",
        "codex",
        "d89e26cd-11f2-47e8-bea5-a73ad5458483",
        "--no-open",
        env={
            "HANDOFF_CLAUDE_HOME": source_home,
            "HANDOFF_CODEX_HOME": target_home,
        },
    )

    assert result.returncode == 0
    assert "created codex session:" in result.stdout
    assert "resume with: codex resume " in result.stdout


def test_quick_cli_opens_claude_target_by_default(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """Rust `quick_cli_opens_claude_target_by_default`."""
    source_session = load_session(fixture("codex_sample.jsonl"), SourceFormat.CODEX)
    source_home = tmp_path_factory.mktemp("source_home")
    target_home = tmp_path_factory.mktemp("target_home")
    source_session.metadata.cwd = str(target_home / "missing-session-cwd")
    materialize(source_session, SessionFormat.CODEX, source_home)

    log_path = target_home / "launcher.log"
    script_path = target_home / "fake-claude.sh"
    _make_executable(
        script_path,
        "#!/bin/sh\n"
        f'printf \'%s\\n\' "$@" > "{log_path}"\n'
        f'printf \'CLAUDE_CONFIG_DIR=%s\\n\' "$CLAUDE_CONFIG_DIR" >> "{log_path}"\n'
        f'printf \'CLAUDE_HOME=%s\\n\' "$CLAUDE_HOME" >> "{log_path}"\n',
    )

    result = run_cli(
        "--from",
        "codex",
        "--to",
        "claude",
        "--keep-session-id",
        "019cd6bd-10df-7e61-8506-e9ac5bdf4e6e",
        "--output",
        target_home,
        env={
            "HANDOFF_CODEX_HOME": source_home,
            "HANDOFF_CLAUDE_BIN": script_path,
        },
    )

    assert result.returncode == 0
    log = log_path.read_text(encoding="utf-8")
    assert "-r" in log
    assert "019cd6bd-10df-7e61-8506-e9ac5bdf4e6e" in log
    assert "CLAUDE_CONFIG_DIR=" in log
    assert "CLAUDE_HOME=" in log


def test_quick_cli_opens_codex_target_by_default_bootstraps_auth(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """Rust `quick_cli_opens_codex_target_by_default_bootstraps_auth`."""
    source_session = load_session(fixture("claude_sample.jsonl"), SourceFormat.CLAUDE)
    source_home = tmp_path_factory.mktemp("source_home")
    target_home = tmp_path_factory.mktemp("target_home")
    installed_home = tmp_path_factory.mktemp("installed_home")
    source_session.metadata.cwd = str(target_home / "missing-session-cwd")
    materialize(source_session, SessionFormat.CLAUDE, source_home)
    (installed_home / "auth.json").write_text('{"access_token":"test"}', encoding="utf-8")

    log_path = target_home / "launcher.log"
    script_path = target_home / "fake-codex.sh"
    _make_executable(
        script_path,
        "#!/bin/sh\n"
        'if [ ! -e "$CODEX_HOME/auth.json" ]; then\n'
        "  echo 'missing auth' >&2\n"
        "  exit 1\n"
        "fi\n"
        f'printf \'%s\\n\' "$@" > "{log_path}"\n'
        f'printf \'CODEX_HOME=%s\\n\' "$CODEX_HOME" >> "{log_path}"\n',
    )

    result = run_cli(
        "--from",
        "claude",
        "--to",
        "codex",
        "--keep-session-id",
        "d89e26cd-11f2-47e8-bea5-a73ad5458483",
        "--output",
        target_home,
        env={
            "HANDOFF_CLAUDE_HOME": source_home,
            "CODEX_HOME": installed_home,
            "HANDOFF_CODEX_BIN": script_path,
        },
    )

    assert result.returncode == 0
    log = log_path.read_text(encoding="utf-8")
    assert "resume" in log
    assert "d89e26cd-11f2-47e8-bea5-a73ad5458483" in log


def test_quick_cli_opens_target_agent_by_default(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """Rust `quick_cli_opens_target_agent_by_default`."""
    source_session = load_session(fixture("claude_sample.jsonl"), SourceFormat.CLAUDE)
    source_home = tmp_path_factory.mktemp("source_home")
    target_home = tmp_path_factory.mktemp("target_home")
    source_session.metadata.cwd = str(target_home / "missing-session-cwd")
    materialize(source_session, SessionFormat.CLAUDE, source_home)

    log_path = target_home / "launcher.log"
    script_path = target_home / "fake-codex.sh"
    _make_executable(
        script_path,
        "#!/bin/sh\n"
        f'printf \'%s\\n\' "$@" > "{log_path}"\n'
        f'printf \'CODEX_HOME=%s\\n\' "$CODEX_HOME" >> "{log_path}"\n',
    )

    result = run_cli(
        "--from",
        "claude",
        "--to",
        "codex",
        "d89e26cd-11f2-47e8-bea5-a73ad5458483",
        "--output",
        target_home,
        env={
            "HANDOFF_CLAUDE_HOME": source_home,
            "HANDOFF_CODEX_BIN": script_path,
        },
    )

    assert result.returncode == 0
    log = log_path.read_text(encoding="utf-8")
    assert "resume" in log
    assert "CODEX_HOME=" in log


# --- open-args seam (ADDITION: not in the Rust suite) --------------------------------
#
# `HANDOFF_{CLAUDE,CODEX}_OPEN_ARGS` append caller-chosen flags to the resume argv, so
# a handed-off pane can carry its source pane's permission posture. handoff forwards
# the tokens verbatim; it never invents a flag.


def _launcher(target_home: Path, name: str) -> tuple[Path, Path]:
    """A fake agent binary that logs one argv token per line, and its log path."""
    log_path = target_home / f"{name}.log"
    script_path = target_home / f"fake-{name}.sh"
    _make_executable(
        script_path,
        f'#!/bin/sh\nprintf \'%s\\n\' "$@" > "{log_path}"\n',
    )
    return script_path, log_path


def _codex_to_claude(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
) -> tuple[Path, Path, Path, str]:
    """Stage a Codex source session and a fake `claude`; returns homes, log, and id."""
    session_id = "019cd6bd-10df-7e61-8506-e9ac5bdf4e6e"
    source_session = load_session(fixture("codex_sample.jsonl"), SourceFormat.CODEX)
    source_home = tmp_path_factory.mktemp("source_home")
    target_home = tmp_path_factory.mktemp("target_home")
    source_session.metadata.cwd = str(target_home / "missing-session-cwd")
    materialize(source_session, SessionFormat.CODEX, source_home)
    _, log_path = _launcher(target_home, "claude")
    return source_home, target_home, log_path, session_id


def _run_to_claude(
    run_cli: Callable[..., object],
    source_home: Path,
    target_home: Path,
    session_id: str,
    open_args: str | None,
) -> object:
    env: dict[str, object] = {
        "HANDOFF_CODEX_HOME": source_home,
        "HANDOFF_CLAUDE_BIN": target_home / "fake-claude.sh",
    }
    if open_args is not None:
        env["HANDOFF_CLAUDE_OPEN_ARGS"] = open_args
    return run_cli(
        "--from",
        "codex",
        "--to",
        "claude",
        "--keep-session-id",
        session_id,
        "--output",
        target_home,
        remove_env=("HANDOFF_CLAUDE_OPEN_ARGS", "HANDOFF_CODEX_OPEN_ARGS"),
        env=env,
    )


def test_claude_open_args_land_before_the_resume_token(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """ADDITION: the env flags are launched, ahead of `-r <sid>`."""
    source_home, target_home, log_path, session_id = _codex_to_claude(fixture, tmp_path_factory)

    result = _run_to_claude(
        run_cli,
        source_home,
        target_home,
        session_id,
        "--dangerously-skip-permissions --append-system-prompt-file /tmp/append.md",
    )

    assert result.returncode == 0
    assert log_path.read_text(encoding="utf-8").splitlines() == [
        "--dangerously-skip-permissions",
        "--append-system-prompt-file",
        "/tmp/append.md",
        "-r",
        session_id,
    ]


def test_claude_open_args_keep_a_quoted_path_as_one_token(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """ADDITION: POSIX split, no shell - a quoted path with a space stays one token."""
    source_home, target_home, log_path, session_id = _codex_to_claude(fixture, tmp_path_factory)

    result = _run_to_claude(
        run_cli,
        source_home,
        target_home,
        session_id,
        "--append-system-prompt-file '/tmp/my notes/append.md'",
    )

    assert result.returncode == 0
    assert log_path.read_text(encoding="utf-8").splitlines() == [
        "--append-system-prompt-file",
        "/tmp/my notes/append.md",
        "-r",
        session_id,
    ]


def test_claude_open_args_do_not_expand_home(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """ADDITION: no shell means no variable expansion - `$HOME` arrives literal."""
    source_home, target_home, log_path, session_id = _codex_to_claude(fixture, tmp_path_factory)

    result = _run_to_claude(
        run_cli, source_home, target_home, session_id, "--append-system-prompt-file $HOME/a.md"
    )

    assert result.returncode == 0
    assert "$HOME/a.md" in log_path.read_text(encoding="utf-8").splitlines()


def test_the_other_targets_open_args_are_ignored(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """ADDITION: only the *target* CLI's var is read - a Codex flag is meaningless here."""
    source_home, target_home, log_path, session_id = _codex_to_claude(fixture, tmp_path_factory)

    result = run_cli(
        "--from",
        "codex",
        "--to",
        "claude",
        "--keep-session-id",
        session_id,
        "--output",
        target_home,
        remove_env=("HANDOFF_CLAUDE_OPEN_ARGS", "HANDOFF_CODEX_OPEN_ARGS"),
        env={
            "HANDOFF_CODEX_HOME": source_home,
            "HANDOFF_CLAUDE_BIN": target_home / "fake-claude.sh",
            "HANDOFF_CODEX_OPEN_ARGS": "--dangerously-bypass-approvals-and-sandbox",
        },
    )

    assert result.returncode == 0
    assert log_path.read_text(encoding="utf-8").splitlines() == ["-r", session_id]


def test_unset_open_args_leave_the_resume_argv_unchanged(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """ADDITION: the seam is inert when unset - argv is exactly `-r <sid>`."""
    source_home, target_home, log_path, session_id = _codex_to_claude(fixture, tmp_path_factory)

    result = _run_to_claude(run_cli, source_home, target_home, session_id, None)

    assert result.returncode == 0
    assert log_path.read_text(encoding="utf-8").splitlines() == ["-r", session_id]


def test_blank_open_args_leave_the_resume_argv_unchanged(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """ADDITION: a whitespace-only value is the same as unset (the wrapper's default)."""
    source_home, target_home, log_path, session_id = _codex_to_claude(fixture, tmp_path_factory)

    result = _run_to_claude(run_cli, source_home, target_home, session_id, "   ")

    assert result.returncode == 0
    assert log_path.read_text(encoding="utf-8").splitlines() == ["-r", session_id]


def test_unbalanced_quote_in_open_args_fails_with_a_clear_message(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """ADDITION: a malformed value is a normal handoff error, not a traceback."""
    source_home, target_home, log_path, session_id = _codex_to_claude(fixture, tmp_path_factory)

    result = _run_to_claude(
        run_cli, source_home, target_home, session_id, "--append-system-prompt-file '/tmp/a.md"
    )

    assert result.returncode == 1
    assert "failed to parse $HANDOFF_CLAUDE_OPEN_ARGS" in result.stderr
    assert "Traceback" not in result.stderr
    assert not log_path.exists()


def test_printed_resume_hint_matches_the_launched_argv(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """ADDITION: the hint is derived from the same argv builder, under `claude`."""
    source_home, target_home, log_path, session_id = _codex_to_claude(fixture, tmp_path_factory)

    result = _run_to_claude(
        run_cli, source_home, target_home, session_id, "--dangerously-skip-permissions"
    )

    assert result.returncode == 0
    hint = next(
        line[len("resume with: ") :]
        for line in result.stdout.splitlines()
        if line.startswith("resume with: ")
    )
    launched = log_path.read_text(encoding="utf-8").splitlines()
    assert shlex.split(hint) == ["claude", *launched]


def test_codex_open_args_precede_the_resume_subcommand(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """ADDITION: Codex takes root-level args *before* `resume`, so order is mandatory."""
    session_id = "d89e26cd-11f2-47e8-bea5-a73ad5458483"
    source_session = load_session(fixture("claude_sample.jsonl"), SourceFormat.CLAUDE)
    source_home = tmp_path_factory.mktemp("source_home")
    target_home = tmp_path_factory.mktemp("target_home")
    source_session.metadata.cwd = str(target_home / "missing-session-cwd")
    materialize(source_session, SessionFormat.CLAUDE, source_home)
    script_path, log_path = _launcher(target_home, "codex")

    result = run_cli(
        "--from",
        "claude",
        "--to",
        "codex",
        "--keep-session-id",
        session_id,
        "--output",
        target_home,
        remove_env=("HANDOFF_CLAUDE_OPEN_ARGS", "HANDOFF_CODEX_OPEN_ARGS"),
        env={
            "HANDOFF_CLAUDE_HOME": source_home,
            "HANDOFF_CODEX_BIN": script_path,
            "HANDOFF_CODEX_OPEN_ARGS": "--dangerously-bypass-approvals-and-sandbox",
        },
    )

    assert result.returncode == 0
    assert log_path.read_text(encoding="utf-8").splitlines() == [
        "--dangerously-bypass-approvals-and-sandbox",
        "resume",
        session_id,
    ]


def test_a_rejected_flag_is_diagnosable_from_the_error(
    fixture: Callable[[str], Path],
    tmp_path_factory: pytest.TempPathFactory,
    run_cli: Callable[..., object],
) -> None:
    """ADDITION: the non-zero-exit bail names the whole command it launched."""
    source_home, target_home, _log_path, session_id = _codex_to_claude(fixture, tmp_path_factory)
    _make_executable(target_home / "fake-claude.sh", "#!/bin/sh\nexit 2\n")

    result = _run_to_claude(run_cli, source_home, target_home, session_id, "--nope")

    assert result.returncode == 1
    assert "claude exited with status 2" in result.stderr
    assert "--nope" in result.stderr
