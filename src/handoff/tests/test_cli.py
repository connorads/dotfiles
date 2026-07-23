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
    (installed_home / "auth.json").write_text(
        '{"access_token":"test"}', encoding="utf-8"
    )

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
