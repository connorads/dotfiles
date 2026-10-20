"""Read-only browser and graphics-memory history. Never collect process arguments."""

import argparse
import datetime
import fcntl
import json
import logging
import logging.handlers
import os
import re
import subprocess
import time
from pathlib import Path
from typing import TypedDict


class Process(TypedDict):
    pid: int
    ppid: int
    rss_kib: int
    executable: str


BROWSER = re.compile(r"chrome|chromium|webkit|safari|electron", re.IGNORECASE)


def processes(output: str) -> dict[int, Process]:
    result: dict[int, Process] = {}
    for line in output.splitlines():
        fields = line.strip().split(None, 3)
        if len(fields) != 4 or not all(value.isdigit() for value in fields[:3]):
            continue
        pid, ppid, rss = map(int, fields[:3])
        result[pid] = Process(pid=pid, ppid=ppid, rss_kib=rss, executable=fields[3])
    return result


def browser_tree(rows: dict[int, Process]) -> list[Process]:
    selected: set[int] = set()
    for row in rows.values():
        if not BROWSER.search(row["executable"]):
            continue
        pid = row["pid"]
        while pid in rows and pid not in selected:
            selected.add(pid)
            pid = rows[pid]["ppid"]
    return [rows[pid] for pid in sorted(selected)]


def footprints(output: str) -> dict[int, str]:
    result: dict[int, str] = {}
    for line in output.splitlines():
        fields = line.split()
        if len(fields) >= 3 and fields[0].isdigit():
            result[int(fields[0])] = fields[-1]
    return result


def command(*args: str) -> str:
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=10)


def sample() -> dict[str, object]:
    rows = processes(command("/bin/ps", "-axo", "pid=,ppid=,rss=,comm="))
    memory = footprints(command("/usr/bin/top", "-l", "1", "-stats", "pid,command,mem"))
    selected = browser_tree(rows)
    graphics = [
        row
        for row in rows.values()
        if any(
            name in row["executable"]
            for name in ("WindowServer", "kernel_task", "Wallpaper", "VTDecoder")
        )
    ]
    return {
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
        "browser_count": sum(bool(BROWSER.search(row["executable"])) for row in rows.values()),
        "browsers_and_ancestors": selected,
        "graphics": graphics,
        "footprint": {
            str(row["pid"]): memory.get(row["pid"], "unavailable") for row in selected + graphics
        },
        "vm_stat": command("/usr/bin/vm_stat").strip(),
        "console_user": command("/usr/bin/stat", "-f", "%Su", "/dev/console").strip(),
        "compressor": command(
            "/usr/sbin/sysctl",
            "vm.compressor.pages_compressed",
            "vm.compressor.pages_compressed_limit",
            "vm.compressor.pages_compressed_incore",
            "vm.compressor_bytes_used",
            "vm.compressor.segment.limit",
            "vm.swapusage",
        ).strip(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Print one sample without writing logs")
    args = parser.parse_args()
    if args.once:
        print(json.dumps(sample()))
        return
    os.umask(0o077)
    directory = Path.home() / "Library/Logs/memory-trace"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / "logger.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        lock.seek(0)
        lock.truncate()
        lock.write(str(os.getpid()))
        lock.flush()
        logger = logging.getLogger("memory-trace")
        logger.setLevel(logging.INFO)
        logger.addHandler(
            logging.handlers.RotatingFileHandler(
                directory / "samples.jsonl", maxBytes=10_000_000, backupCount=7
            )
        )
        while True:
            started = time.monotonic()
            try:
                logger.info(json.dumps(sample()))
            except (OSError, subprocess.SubprocessError) as error:
                logger.info(
                    json.dumps(
                        {
                            "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
                            "error": type(error).__name__,
                        }
                    )
                )
            time.sleep(max(0, 15 - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
