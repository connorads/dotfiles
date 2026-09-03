#!/usr/bin/env python3
"""Capture a process argv without flattening argument boundaries."""

from __future__ import annotations

import ctypes
import json
import os
import struct
import sys


def linux_argv(pid: int) -> list[str]:
    root = os.environ.get("AGENT_PROC_ROOT", "/proc")
    with open(f"{root}/{pid}/cmdline", "rb") as handle:
        return [
            part.decode(errors="surrogateescape") for part in handle.read().split(b"\0") if part
        ]


def macos_argv(pid: int) -> list[str]:
    libc = ctypes.CDLL(None, use_errno=True)
    mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2, pid
    size = ctypes.c_size_t()
    if libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0:
        raise OSError(ctypes.get_errno(), "sysctl size")
    buf = ctypes.create_string_buffer(size.value)
    if libc.sysctl(mib, 3, buf, ctypes.byref(size), None, 0) != 0:
        raise OSError(ctypes.get_errno(), "sysctl data")
    raw = buf.raw[: size.value]
    argc = struct.unpack_from("i", raw)[0]
    fields = raw[4:].split(b"\0")
    fields = fields[1:]  # executable path is followed by argv[0]
    while fields and not fields[0]:
        fields.pop(0)
    return [part.decode(errors="surrogateescape") for part in fields[:argc]]


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        print("usage: codex-process-argv.py PID", file=sys.stderr)
        return 2
    argv = (
        linux_argv(int(sys.argv[1]))
        if sys.platform.startswith("linux")
        else macos_argv(int(sys.argv[1]))
    )
    json.dump(argv, sys.stdout, ensure_ascii=False)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
