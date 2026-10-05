"""Private atomic records and persistent, inherited per-thread locks."""

from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
import tempfile
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from codex_recover.pane import PaneIdentity
from codex_recover.rpc import TransportFailure, object_map


def string(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("invalid-metadata")
    return value


def integer(value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError("invalid-metadata")
    return value


def timestamp(value: object) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise ValueError("invalid-metadata")
    return float(value)


def identifiers(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise ValueError("invalid-metadata")
    return tuple(string(item) for item in value)


@dataclass(frozen=True)
class Record:
    identity: PaneIdentity
    generation: str
    socket: str
    status: str
    activated: float
    expires: float
    retries: int = 0
    stop_reason: str | None = None
    attempted: tuple[str, ...] = ()
    own_clients: tuple[str, ...] = ()
    goal_intent: str | None = None

    def document(self) -> dict[str, object]:
        return {
            "identity": asdict(self.identity),
            "generation": self.generation,
            "socket": self.socket,
            "status": self.status,
            "activated": self.activated,
            "expires": self.expires,
            "retries": self.retries,
            "stopReason": self.stop_reason,
            "attempted": list(self.attempted),
            "ownClients": list(self.own_clients),
            "goalIntent": self.goal_intent,
        }

    @classmethod
    def parse(cls, value: object) -> Record:
        try:
            raw = object_map(value)
            identity = object_map(raw.get("identity"))
            pane = PaneIdentity(
                string(identity.get("server_socket")),
                integer(identity.get("server_pid")),
                string(identity.get("pane_id")),
                string(identity.get("thread_id")),
                integer(identity.get("codex_pid")),
                string(identity.get("codex_started")),
            )
            reason = raw.get("stopReason")
            goal = raw.get("goalIntent")
            return cls(
                pane,
                string(raw.get("generation")),
                string(raw.get("socket")),
                string(raw.get("status")),
                timestamp(raw.get("activated")),
                timestamp(raw.get("expires")),
                integer(raw.get("retries")),
                None if reason is None else string(reason),
                identifiers(raw.get("attempted")),
                identifiers(raw.get("ownClients")),
                None if goal is None else string(goal),
            )
        except (TransportFailure, ValueError) as exc:
            raise ValueError("invalid-metadata") from exc


class Store:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path.home() / ".local/state/agents/codex-recover"
        if self.root.is_symlink():
            raise ValueError("invalid-state-directory")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.root.chmod(0o700)

    def record_path(self, thread: str) -> Path:
        return self.root / (hashlib.sha256(thread.encode()).hexdigest() + ".json")

    def lock_path(self, thread: str) -> Path:
        return self.record_path(thread).with_suffix(".lock")

    def acquire(self, thread: str) -> int | None:
        fd = os.open(self.lock_path(thread), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        os.fchmod(fd, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            return None
        return fd

    def read(self, thread: str) -> Record | None:
        return self._read_path(self.record_path(thread))

    def _read_path(self, path: Path) -> Record | None:
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            return None
        with os.fdopen(fd) as file:
            value: object = json.load(file)
        return Record.parse(value)

    def write(self, record: Record) -> None:
        fd, temporary = tempfile.mkstemp(dir=self.root, suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as file:
                json.dump(record.document(), file, allow_nan=False)
                file.write("\n")
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, self.record_path(record.identity.thread_id))
            directory = os.open(self.root, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def records(self) -> list[Record]:
        records: list[Record] = []
        for path in sorted(self.root.glob("*.json")):
            record = self._read_path(path)
            if record is not None:
                records.append(record)
        return records

    def observed(self, thread: str) -> Record | None:
        fd = self.acquire(thread)
        try:
            record = self.read(thread)
            if fd is not None and record is not None and record.status != "stopped":
                record = replace(record, status="stopped", stop_reason="worker-lost")
                self.write(record)
            return record
        finally:
            if fd is not None:
                os.close(fd)
