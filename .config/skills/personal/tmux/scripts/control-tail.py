#!/usr/bin/env python3
"""Follow one tmux pane through control mode and optionally wait for a regex."""

from __future__ import annotations

import argparse
import codecs
import os
import re
import select
import subprocess
import sys
import time
from collections.abc import Sequence
from dataclasses import dataclass


ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
OSC_RE = re.compile(r"\x1b\][^\x07]*(?:\x07|\x1b\\)")


@dataclass(frozen=True)
class Target:
    pane_id: str
    session_id: str


@dataclass(frozen=True)
class SeedResult:
    buffer: str
    matched: bool


class CliError(Exception):
    def __init__(self, message: str, exit_code: int = 1) -> None:
        super().__init__(message)
        self.message = message
        self.exit_code = exit_code


class ControlTimeout(Exception):
    pass


class ControlClientExited(Exception):
    def __init__(self, exit_code: int, stderr: str) -> None:
        super().__init__(stderr)
        self.exit_code = exit_code
        self.stderr = stderr


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Tail tmux pane output via control mode.",
    )
    parser.add_argument("-t", "--target", required=True, help="tmux target pane/window/session")
    socket_group = parser.add_mutually_exclusive_group()
    socket_group.add_argument("-L", "--socket-name", help="tmux socket name")
    socket_group.add_argument("-S", "--socket-path", help="tmux socket path")
    parser.add_argument("-p", "--pattern", help="Python regex to wait for")
    parser.add_argument("-T", "--timeout", type=float, default=30.0, help="timeout in seconds")
    parser.add_argument("-n", "--lines", type=int, default=40, help="normalised tail lines to retain")
    parser.add_argument("--no-seed", action="store_true", help="do not seed from capture-pane before attaching")
    return parser.parse_args()


def tmux_command(args: argparse.Namespace, command: Sequence[str]) -> list[str]:
    tmux = os.environ.get("TMUX_BIN", "tmux")
    result = [tmux]
    if args.socket_name:
        result += ["-L", args.socket_name]
    if args.socket_path:
        result += ["-S", args.socket_path]
    result += list(command)
    return result


def run_tmux(args: argparse.Namespace, command: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        tmux_command(args, command),
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def resolve_target(args: argparse.Namespace) -> Target:
    completed = run_tmux(
        args,
        ["display-message", "-p", "-t", args.target, "#{pane_id}|#{session_id}"],
    )
    if completed.returncode != 0:
        message = completed.stderr.strip() or f"tmux target not found: {args.target}"
        raise CliError(message, completed.returncode or 1)

    pane_id, separator, session_id = completed.stdout.strip().partition("|")
    if not separator or not pane_id.startswith("%") or not session_id.startswith("$"):
        raise CliError(f"could not resolve tmux target: {args.target}")
    return Target(pane_id=pane_id, session_id=session_id)


def decode_tmux_payload(payload: bytes) -> bytes:
    decoded = bytearray()
    index = 0
    while index < len(payload):
        byte = payload[index]
        if (
            byte == 0x5C
            and index + 3 < len(payload)
            and all(0x30 <= payload[index + offset] <= 0x37 for offset in (1, 2, 3))
        ):
            decoded.append(int(payload[index + 1 : index + 4], 8))
            index += 4
            continue
        decoded.append(byte)
        index += 1
    return bytes(decoded)


def normalise_terminal_text(text: str) -> str:
    text = OSC_RE.sub("", text)
    text = ANSI_RE.sub("", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text


def trim_lines(text: str, max_lines: int) -> str:
    lines = text.splitlines(keepends=True)
    if len(lines) <= max_lines:
        return text
    return "".join(lines[-max_lines:])


def seed_buffer(args: argparse.Namespace, regex: re.Pattern[str] | None) -> SeedResult:
    if args.no_seed or regex is None:
        return SeedResult(buffer="", matched=False)

    completed = run_tmux(
        args,
        ["capture-pane", "-p", "-S", f"-{args.lines}", "-t", args.target],
    )
    if completed.returncode != 0:
        return SeedResult(buffer="", matched=False)

    buffer = trim_lines(normalise_terminal_text(completed.stdout), args.lines)
    return SeedResult(buffer=buffer, matched=bool(regex.search(buffer)))


def parse_output_line(line: bytes) -> tuple[bytes, bytes] | None:
    line = line.rstrip(b"\n")
    if line.startswith(b"%output "):
        parts = line.split(b" ", 2)
        if len(parts) == 3:
            return parts[1], parts[2]

    if line.startswith(b"%extended-output "):
        parts = line.split(b" ")
        if len(parts) >= 5:
            try:
                delimiter = parts.index(b":", 3)
            except ValueError:
                return None
            if delimiter + 1 < len(parts):
                return parts[1], b" ".join(parts[delimiter + 1 :])
            return parts[1], b""

    return None


def stop_control_client(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        if process.stdin:
            process.stdin.write(b"detach-client\n")
            process.stdin.flush()
    except BrokenPipeError:
        pass

    try:
        process.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            process.kill()


def print_timeout(args: argparse.Namespace, buffer: str) -> None:
    print(f"Timeout after {args.timeout:g}s waiting for pattern {args.pattern!r}", file=sys.stderr)
    if buffer:
        print("Last normalised output:", file=sys.stderr)
        print(buffer.rstrip("\n"), file=sys.stderr)


def control_deadline(args: argparse.Namespace) -> float | None:
    return time.monotonic() + args.timeout if args.timeout >= 0 else None


def raise_if_exited(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        return
    stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
    raise ControlClientExited(process.returncode or 0, stderr)


def iter_pane_text(args: argparse.Namespace, target: Target):
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    pane_id_bytes = target.pane_id.encode()
    deadline = control_deadline(args)

    process = subprocess.Popen(
        tmux_command(args, ["-C", "attach", "-t", target.session_id]),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        assert process.stdout is not None
        while True:
            remaining = None
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ControlTimeout

            wait_time = 0.1 if remaining is None else min(0.1, max(0.0, remaining))
            ready, _, _ = select.select([process.stdout], [], [], wait_time)
            if not ready:
                raise_if_exited(process)
                continue

            if deadline is not None and time.monotonic() >= deadline:
                raise ControlTimeout

            line = process.stdout.readline()
            if not line:
                raise_if_exited(process)
                time.sleep(0.05)
                continue

            parsed = parse_output_line(line)
            if parsed is None:
                continue

            output_pane, payload = parsed
            if output_pane != pane_id_bytes:
                continue

            text = decoder.decode(decode_tmux_payload(payload))
            if not text:
                continue
            yield text
    finally:
        stop_control_client(process)


def stream_text(args: argparse.Namespace, target: Target) -> int:
    try:
        for text in iter_pane_text(args, target):
            sys.stdout.write(text)
            sys.stdout.flush()
        return 0
    except ControlTimeout:
        return 0
    except ControlClientExited as error:
        if error.stderr.strip():
            print(error.stderr.strip(), file=sys.stderr)
        return error.exit_code


def wait_for_pattern(args: argparse.Namespace, target: Target, regex: re.Pattern[str]) -> int:
    seed = seed_buffer(args, regex)
    if seed.matched:
        print(f"Pattern {args.pattern!r} found in existing output")
        return 0

    buffer = seed.buffer
    try:
        for text in iter_pane_text(args, target):
            buffer = trim_lines(buffer + normalise_terminal_text(text), args.lines)
            if regex.search(buffer):
                print(f"Pattern {args.pattern!r} found")
                return 0
    except ControlTimeout:
        print_timeout(args, buffer)
        return 1
    except ControlClientExited as error:
        if error.stderr.strip():
            print(error.stderr.strip(), file=sys.stderr)
        return error.exit_code
    return 0


def compile_pattern(pattern: str) -> re.Pattern[str]:
    try:
        return re.compile(pattern, re.MULTILINE)
    except re.error as error:
        raise CliError(f"invalid regex {pattern!r}: {error}", 2) from error


def follow(args: argparse.Namespace, target: Target) -> int:
    if args.pattern:
        return wait_for_pattern(args, target, compile_pattern(args.pattern))
    return stream_text(args, target)


def main() -> int:
    args = parse_args()
    try:
        return follow(args, resolve_target(args))
    except CliError as error:
        print(error.message, file=sys.stderr)
        return error.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
