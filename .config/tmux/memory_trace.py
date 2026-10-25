"""Private browser and graphics memory history. Never signal applications."""

import argparse
import datetime
import fcntl
import hashlib
import json
import os
import re
import socket
import stat
import subprocess
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from types import TracebackType
from typing import IO, TypedDict


class Process(TypedDict):
    pid: int
    ppid: int
    rss_kib: int
    started_at: str
    executable: str


class Reading(Process):
    footprint_bytes: int | None
    footprint_status: str


class Probe(TypedDict):
    status: str
    started_at: str
    finished_at: str
    duration_ms: float
    value: object
    error: str | None


BROWSER = re.compile(r"chrome|chromium|webkit|safari|electron", re.IGNORECASE)
GRAPHICS = re.compile(r"WindowServer|kernel_task|Wallpaper|VTDecoder")
PS_ARGS = ("/bin/ps", "-axo", "pid=,ppid=,rss=,lstart=,comm=")
INTERVAL = 15
SEGMENT_BYTES = 16 * 1024 * 1024
BACKUPS = 7
SYSCTL_KEYS = (
    "kern.boottime",
    "hw.memsize",
    "kern.memorystatus_vm_pressure_level",
    "vm.compressor.pages_compressed",
    "vm.compressor.pages_compressed_limit",
    "vm.compressor.segment.total",
    "vm.compressor.segment.limit",
    "vm.swapusage",
)
MAX_RECORD_BYTES = 1024 * 1024


def utc_now() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")


def processes(output: str) -> dict[int, Process]:
    result: dict[int, Process] = {}
    for line in output.splitlines():
        fields = line.strip().split(None, 8)
        if len(fields) != 9 or not all(value.isdigit() for value in fields[:3]):
            continue
        try:
            started = datetime.datetime.strptime(
                " ".join(fields[3:8]), "%a %b %d %H:%M:%S %Y"
            ).replace(tzinfo=datetime.UTC)
        except ValueError:
            continue
        pid, ppid, rss = map(int, fields[:3])
        result[pid] = Process(
            pid=pid,
            ppid=ppid,
            rss_kib=rss,
            started_at=started.replace(tzinfo=datetime.UTC).isoformat().replace("+00:00", "Z"),
            executable=Path(fields[8]).name,
        )
    if not result:
        raise ValueError("no valid process rows")
    return result


def browser_tree(rows: dict[int, Process]) -> list[Process]:
    selected = {pid for pid, row in rows.items() if BROWSER.search(row["executable"])}
    while True:
        children = {pid for pid, row in rows.items() if row["ppid"] in selected}
        expanded = selected | children
        if expanded == selected:
            return [rows[pid] for pid in sorted(selected)]
        selected = expanded


def footprints(output: str) -> dict[int, int]:
    if not re.search(r"^PID\s+MEM\s*$", output, re.MULTILINE):
        raise ValueError("missing top header")
    result: dict[int, int] = {}
    for line in output.splitlines():
        match = re.fullmatch(r"\s*(\d+)\s+(\d+(?:\.\d+)?)([BKMGTP])[+-]?\s*", line)
        if match:
            pid, value, unit = match.groups()
            result[int(pid)] = int(float(value) * 1024 ** "BKMGTP".index(unit))
    return result


def vm_reading(output: str) -> dict[str, int]:
    page = re.search(r"page size of (\d+) bytes", output)
    wired = re.search(r"^Pages wired down:\s+(\d+)\.\s*$", output, re.MULTILINE)
    if not page or not wired or int(page[1]) == 0:
        raise ValueError("missing vm counters")
    return {"page_size_bytes": int(page[1]), "wired_bytes": int(page[1]) * int(wired[1])}


def sysctl_reading(output: str) -> dict[str, int | str | None]:
    result: dict[str, int | str | None] = dict.fromkeys(SYSCTL_KEYS)
    for line in output.splitlines():
        key, separator, value = line.partition(": ")
        if separator and key in result:
            result[key] = int(value) if value.isdigit() else value
    if all(value is None for value in result.values()):
        raise ValueError("no sysctl readings")
    return result


def command(*args: str) -> str:
    with subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C", "TZ": "UTC"},
    ) as child:
        try:
            output, _ = child.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            child.kill()
            child.communicate()
            raise
        if child.returncode:
            raise subprocess.CalledProcessError(child.returncode, args)
    if len(output) > 4 * 1024 * 1024:
        raise ValueError("probe output too large")
    return output.decode("utf-8", errors="replace")


def probe(run: Callable[..., str], args: tuple[str, ...], parse: Callable[[str], object]) -> Probe:
    started_at, started = utc_now(), time.monotonic()
    value: object = None
    error: str | None = None
    try:
        value = parse(run(*args))
    except (OSError, subprocess.SubprocessError, ValueError) as failure:
        error = type(failure).__name__
    return Probe(
        status="ok" if error is None else "unavailable",
        started_at=started_at,
        finished_at=utc_now(),
        duration_ms=round((time.monotonic() - started) * 1000, 3),
        value=value,
        error=error,
    )


def process_readings(
    before: dict[int, Process],
    after: dict[int, Process],
    memory: dict[int, int],
) -> list[Reading]:
    selected = {row["pid"] for row in browser_tree(before)}
    selected.update(pid for pid, row in before.items() if GRAPHICS.search(row["executable"]))
    result: list[Reading] = []
    for pid in sorted(selected):
        row = before[pid]
        current = after.get(pid)
        same = current is not None and (row["started_at"], row["executable"]) == (
            current["started_at"],
            current["executable"],
        )
        available = same and pid in memory
        result.append(
            Reading(
                pid=row["pid"],
                ppid=row["ppid"],
                rss_kib=row["rss_kib"],
                started_at=row["started_at"],
                executable=row["executable"],
                footprint_bytes=memory[pid] if available else None,
                footprint_status="ok"
                if available
                else "unavailable"
                if same
                else "identity_changed",
            )
        )
    return result


def sample(run: Callable[..., str] = command) -> dict[str, object]:
    # Identity brackets the footprint probe; numeric PIDs alone cannot join samples.
    before: dict[int, Process] = {}
    after: dict[int, Process] = {}
    memory: dict[int, int] = {}

    def read_before(text: str) -> object:
        before.update(processes(text))
        return {"count": len(before)}

    def read_after(text: str) -> object:
        after.update(processes(text))
        return {"count": len(after)}

    def read_memory(text: str) -> object:
        memory.update(footprints(text))
        return {"count": len(memory)}

    started = time.monotonic()
    probes = {
        "processes": probe(run, PS_ARGS, read_before),
        "footprints": probe(run, ("/usr/bin/top", "-l", "1", "-stats", "pid,mem"), read_memory),
        "identity_check": probe(run, PS_ARGS, read_after),
        "vm_stat": probe(run, ("/usr/bin/vm_stat",), vm_reading),
        "sysctl": probe(
            run,
            ("/usr/sbin/sysctl", "-i", *SYSCTL_KEYS),
            sysctl_reading,
        ),
    }
    return {
        "schema_version": 2,
        "timestamp": utc_now(),
        "hostname": socket.gethostname(),
        "duration_ms": round((time.monotonic() - started) * 1000, 3),
        "probes": probes,
        "processes": process_readings(before, after, memory),
        "accounting": "phys_footprint_bytes; sums can count shared pages more than once",
    }


class History:
    """Single-writer private ring. The v1 directory is never opened."""

    def __init__(self, directory: Path, segment_bytes: int = SEGMENT_BYTES, backups: int = BACKUPS):
        self.directory = directory
        self.segment_bytes = segment_bytes
        self.backups = backups
        self.lock: IO[bytes] | None = None

    def path(self, suffix: str = "") -> Path:
        return self.directory / ("samples.jsonl" + suffix)

    def __enter__(self) -> "History":
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        metadata = self.directory.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid():
            raise OSError("unsafe history directory")
        if metadata.st_mode & 0o077:
            raise OSError("history directory must be private")
        try:
            self.lock = self.open_private(self.directory / "logger.lock")
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for path in [self.path(), *(self.path(f".{n}") for n in range(1, self.backups + 1))]:
                if path.is_symlink():
                    raise OSError("symlink in history")
                if path.exists():
                    metadata = path.stat()
                    if (
                        not stat.S_ISREG(metadata.st_mode)
                        or metadata.st_uid != os.getuid()
                        or metadata.st_mode & 0o077
                    ):
                        raise OSError("unsafe history file")
            with self.open_private(self.path()) as stream:
                stream.seek(0, os.SEEK_END)
                size = stream.tell()
                if size:
                    stream.seek(max(0, size - MAX_RECORD_BYTES))
                    tail = stream.read()
                    if not tail.endswith(b"\n"):
                        boundary = tail.rfind(b"\n")
                        if boundary < 0 and size > MAX_RECORD_BYTES:
                            raise OSError("invalid history tail")
                        stream.truncate(max(0, size - len(tail) + boundary + 1))
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    @staticmethod
    def open_private(path: Path) -> IO[bytes]:
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or metadata.st_mode & 0o077
        ):
            os.close(descriptor)
            raise OSError("unsafe history file")
        return os.fdopen(descriptor, "r+b")

    def append(self, record: dict[str, object]) -> None:
        encoded = (json.dumps(record, separators=(",", ":"), allow_nan=False) + "\n").encode()
        if len(encoded) > min(self.segment_bytes, MAX_RECORD_BYTES):
            raise ValueError("record exceeds byte budget")
        if self.path().stat().st_size + len(encoded) > self.segment_bytes:
            for n in range(self.backups, 0, -1):
                source = self.path() if n == 1 else self.path(f".{n - 1}")
                if source.exists():
                    os.replace(source, self.path(f".{n}"))
        with self.open_private(self.path()) as stream:
            stream.seek(0, os.SEEK_END)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())

    def __exit__(
        self,
        kind: type[BaseException] | None,
        error: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self.lock is not None:
            self.lock.close()
            self.lock = None


class Growth(TypedDict):
    executable: str
    pid: int
    started_at: str
    hostname: str
    first_bytes: int
    last_bytes: int
    peak_bytes: int
    change_bytes: int
    samples: int


def summary(directory: Path) -> dict[str, object]:
    series: dict[tuple[str, int, str, str], Growth] = {}
    records = invalid = unavailable = delayed = 0
    first: str | None = None
    last: str | None = None
    runs: set[str] = set()
    for suffix in [*(f".{n}" for n in range(BACKUPS, 0, -1)), ""]:
        path = directory / ("samples.jsonl" + suffix)
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            continue
        with os.fdopen(descriptor, "rb") as stream:
            while line := stream.readline(MAX_RECORD_BYTES + 1):
                if len(line) > MAX_RECORD_BYTES:
                    raise ValueError("history line exceeds byte budget")
                try:
                    record = json.loads(line)
                    if not line.endswith(b"\n") or record.get("schema_version") != 2:
                        raise ValueError("invalid record")
                    timestamp = record["timestamp"]
                    datetime.datetime.fromisoformat(timestamp)
                except (ValueError, KeyError, TypeError, AttributeError):
                    invalid += 1
                    continue
                records += 1
                first = first or timestamp
                last = timestamp
                runs.add(record.get("run_id", "unknown"))
                gap = record.get("start_gap_seconds")
                delayed += int(isinstance(gap, (int, float)) and gap > INTERVAL * 2)
                unavailable += sum(
                    p.get("status") != "ok" for p in record.get("probes", {}).values()
                )
                for row in record.get("processes", []):
                    value = row.get("footprint_bytes")
                    if not isinstance(value, int) or value < 0:
                        continue
                    host = record.get("hostname", "unknown")
                    key = (host, row["pid"], row["started_at"], row["executable"])
                    if key not in series:
                        series[key] = Growth(
                            executable=row["executable"],
                            pid=row["pid"],
                            started_at=row["started_at"],
                            hostname=host,
                            first_bytes=value,
                            last_bytes=value,
                            peak_bytes=value,
                            change_bytes=0,
                            samples=0,
                        )
                    reading = series[key]
                    reading["last_bytes"] = value
                    reading["peak_bytes"] = max(reading["peak_bytes"], value)
                    reading["change_bytes"] = value - reading["first_bytes"]
                    reading["samples"] += 1
    return {
        "records": records,
        "first_timestamp": first,
        "last_timestamp": last,
        "collector_runs": len(runs),
        "incomplete_or_invalid_lines": invalid,
        "unavailable_probes": unavailable,
        "delayed_samples": delayed,
        "processes": sorted(series.values(), key=lambda row: row["peak_bytes"], reverse=True),
        "interpretation": "Accounting growth within process identities; not allocation ownership or a cause.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Print one read-only sample")
    parser.add_argument("--summary", action="store_true", help="Summarise retained v2 history")
    args = parser.parse_args()
    directory = Path.home() / "Library/Logs/memory-trace-v2"
    if args.summary:
        print(json.dumps(summary(directory), indent=2))
        return
    if args.once:
        print(json.dumps(sample()))
        return
    os.umask(0o077)
    revision = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    run_id, sequence, previous, previous_wall = str(uuid.uuid4()), 0, None, None
    with History(directory) as history:
        while True:
            started, wall_started = time.monotonic(), time.time()
            record = sample()
            record.update(
                collector_revision=revision,
                run_id=run_id,
                sequence=sequence,
                interval_seconds=INTERVAL,
                start_gap_seconds=None if previous is None else round(started - previous, 3),
                wall_start_gap_seconds=None
                if previous_wall is None
                else round(wall_started - previous_wall, 3),
            )
            history.append(record)
            previous, previous_wall = started, wall_started
            sequence += 1
            time.sleep(max(1, INTERVAL - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
