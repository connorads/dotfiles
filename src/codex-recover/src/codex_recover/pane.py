"""Read-only tmux and foreground-process identity checks."""

import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path


class PaneFailure(Exception):
    pass


def command(args: tuple[str, ...]) -> str:
    try:
        return subprocess.run(
            args, check=True, capture_output=True, text=True, timeout=5
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        raise PaneFailure("pane-probe-failed") from exc


@dataclass(frozen=True)
class PaneIdentity:
    server_socket: str
    server_pid: int
    pane_id: str
    thread_id: str
    codex_pid: int
    codex_started: str

    def matches(self) -> bool:
        try:
            return capture(self.pane_id, server=self.server_socket) == self
        except PaneFailure:
            return False


def pane_address(pane: str) -> tuple[str, int, str]:
    row = command(
        ("tmux", "display-message", "-p", "-t", pane, "#{socket_path}\037#{pid}\037#{pane_id}")
    )
    fields = row.split("\037")
    try:
        socket, pid, pane_id = fields
        return socket, int(pid), pane_id
    except (ValueError, TypeError) as exc:
        raise PaneFailure("pane-probe-failed") from exc


def capture(
    pane: str,
    *,
    server: str | None = None,
    run: Callable[[tuple[str, ...]], str] = command,
) -> PaneIdentity:
    tmux = ("tmux", "-S", server) if server else ("tmux",)
    fields = run(
        (
            *tmux,
            "display-message",
            "-p",
            "-t",
            pane,
            "\037".join(
                (
                    "#{socket_path}",
                    "#{pid}",
                    "#{pane_id}",
                    "#{@codex_thread_id}",
                    "#{@codex_started_thread}",
                    "#{pane_dead}",
                    "#{@agent_state}",
                    "#{pane_pid}",
                )
            ),
        )
    ).split("\037")
    if len(fields) != 8:
        raise PaneFailure("pane-probe-failed")
    socket, server_pid, pane_id, thread, published, dead, state, pane_pid = fields
    if not thread or published != thread:
        raise PaneFailure("pane-thread-unpublished")
    if dead != "0" or state == "hibernated":
        raise PaneFailure("pane-unavailable")
    try:
        processes: list[tuple[int, int, int, str]] = []
        for line in run(("ps", "-axo", "pid=,pgid=,tpgid=,comm=")).splitlines():
            pid, pgid, tpgid, executable = line.split(maxsplit=3)
            processes.append((int(pid), int(pgid), int(tpgid), Path(executable).name))
        foreground = next(tpgid for pid, _, tpgid, _ in processes if pid == int(pane_pid))
        candidates = [
            pid
            for pid, pgid, _, executable in processes
            if foreground > 0 and pgid == foreground and executable == "codex"
        ]
        if len(candidates) != 1:
            raise PaneFailure("pane-codex-not-live")
        codex_pid = candidates[0]
        started = run(("ps", "-p", str(codex_pid), "-o", "lstart="))
        if not started:
            raise PaneFailure("pane-codex-not-live")
        return PaneIdentity(socket, int(server_pid), pane_id, thread, codex_pid, started)
    except (ValueError, StopIteration) as exc:
        raise PaneFailure("pane-probe-failed") from exc
