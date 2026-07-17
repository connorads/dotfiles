#!/usr/bin/env python3
"""Static triage runner for Go binaries.

The script records command outputs in a workspace. It never launches the target
binary; every command is a static inspection tool.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path


def which_any(names: list[str]) -> str | None:
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    return None


def run_command(label: str, cmd: list[str], out_dir: Path, timeout: int = 120) -> dict:
    output_path = out_dir / f"{label}.txt"
    started = time.time()
    record = {
        "label": label,
        "cmd": cmd,
        "output": str(output_path),
        "returncode": None,
        "duration_seconds": None,
        "error": None,
    }

    try:
        proc = subprocess.run(
            cmd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
        )
        output_path.write_text(proc.stdout, encoding="utf-8", errors="replace")
        record["returncode"] = proc.returncode
    except Exception as exc:  # pragma: no cover - defensive triage path
        output_path.write_text(str(exc), encoding="utf-8", errors="replace")
        record["error"] = str(exc)
    finally:
        record["duration_seconds"] = round(time.time() - started, 3)

    return record


def command_exists(cmd: list[str]) -> bool:
    return bool(cmd and shutil.which(cmd[0]))


def build_commands(binary: Path, go_cmd: list[str]) -> list[tuple[str, list[str], int]]:
    commands: list[tuple[str, list[str], int]] = []

    def add(label: str, cmd: list[str], timeout: int = 120) -> None:
        if shutil.which(cmd[0]):
            commands.append((label, cmd, timeout))

    add("file", ["file", str(binary)])

    if shutil.which("shasum"):
        add("sha256", ["shasum", "-a", "256", str(binary)])
    elif shutil.which("sha256sum"):
        add("sha256", ["sha256sum", str(binary)])

    if command_exists(go_cmd):
        commands.append(("go-version-m", go_cmd + ["version", "-m", str(binary)], 120))
        commands.append(("go-version-m-json", go_cmd + ["version", "-m", "-json", str(binary)], 120))
        commands.append(("go-tool-nm", go_cmd + ["tool", "nm", str(binary)], 240))

    add("strings", ["strings", "-a", str(binary)], timeout=240)

    if sys.platform == "darwin":
        add("otool-l", ["otool", "-l", str(binary)])
        add("otool-Iv", ["otool", "-Iv", str(binary)])
        add("otool-L", ["otool", "-L", str(binary)])
    else:
        add("readelf-h", ["readelf", "-h", str(binary)])
        add("readelf-S", ["readelf", "-S", str(binary)])
        add("readelf-s", ["readelf", "-s", str(binary)], timeout=240)
        add("readelf-d", ["readelf", "-d", str(binary)])
        add("objdump-fh", ["objdump", "-f", "-h", str(binary)])

    goresym = which_any(["GoReSym", "goresym"])
    if goresym:
        commands.append(
            (
                "goresym",
                [goresym, "-t", "-d", "-p", "-strings", str(binary)],
                300,
            )
        )

    redress = shutil.which("redress")
    if redress:
        for subcommand in ["info", "packages", "moduledata", "source"]:
            commands.append((f"redress-{subcommand}", [redress, subcommand, str(binary)], 300))
        commands.append(("redress-types-all", [redress, "types", "all", str(binary)], 300))

    return commands


def main() -> int:
    parser = argparse.ArgumentParser(description="Run static Go binary triage tools.")
    parser.add_argument("binary", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument(
        "--go-cmd",
        default=os.environ.get("GO_RE_GO", "go"),
        help='Go command to use, e.g. "mise exec go@1.25 -- go".',
    )
    args = parser.parse_args()

    binary = args.binary.expanduser().resolve()
    if not binary.is_file():
        parser.error(f"not a file: {binary}")

    out_dir = args.out
    if out_dir is None:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        out_dir = Path("/tmp") / f"go-re-{binary.stem}-{stamp}"
    out_dir = out_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    metadata = {
        "binary": str(binary),
        "out_dir": str(out_dir),
        "argv": sys.argv,
        "note": "Static inspection only; target binary is not executed.",
        "commands": [],
    }

    go_cmd = shlex.split(args.go_cmd)
    for label, cmd, timeout in build_commands(binary, go_cmd):
        print("+", " ".join(shlex.quote(part) for part in cmd), file=sys.stderr)
        metadata["commands"].append(run_command(label, cmd, out_dir, timeout=timeout))

    (out_dir / "triage-metadata.json").write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )
    print(out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
