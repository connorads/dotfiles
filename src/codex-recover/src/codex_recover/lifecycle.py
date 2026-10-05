"""Launch and control workers using locks and generation-bound sockets."""

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, replace
from pathlib import Path

from codex_recover.engine import LIFETIME
from codex_recover.pane import PaneIdentity
from codex_recover.rpc import TransportFailure, object_map
from codex_recover.store import Record, Store


class WorkerFailure(Exception):
    pass


@dataclass(frozen=True)
class Reply:
    ready: bool
    record: Record


def control(record: Record, command: str, *, timeout: float = 5) -> Reply:
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(timeout)
            client.connect(record.socket)
            client.sendall(
                json.dumps({"generation": record.generation, "command": command}).encode() + b"\n"
            )
            with client.makefile("rb") as file:
                value: object = json.loads(file.readline())
        message = object_map(value)
        if message.get("generation") != record.generation:
            raise WorkerFailure("generation-mismatch")
        updated = Record.parse(message.get("record"))
        if (
            updated.identity.thread_id != record.identity.thread_id
            or updated.generation != record.generation
        ):
            raise WorkerFailure("generation-mismatch")
        ready = message.get("ready")
        if not isinstance(ready, bool):
            raise WorkerFailure("invalid-control-reply")
        return Reply(ready, updated)
    except (OSError, ValueError, TransportFailure) as exc:
        raise WorkerFailure("worker-unreachable") from exc


def wait_ready(store: Store, thread: str, deadline: float) -> Record:
    while time.monotonic() < deadline:
        record = store.observed(thread)
        if record is not None:
            if record.status == "stopped":
                raise WorkerFailure(record.stop_reason or "worker-stopped")
            try:
                reply = control(
                    record, "status", timeout=min(5, max(0.001, deadline - time.monotonic()))
                )
                if reply.ready and reply.record.status != "stopped":
                    return reply.record
            except WorkerFailure:
                pass
        time.sleep(0.05)
    raise WorkerFailure("startup-timeout")


def activate(identity: PaneIdentity, store: Store) -> Record:
    deadline = time.monotonic() + 10
    fd = store.acquire(identity.thread_id)
    if fd is None:
        return wait_ready(store, identity.thread_id, deadline)
    process: subprocess.Popen[bytes] | None = None
    try:
        previous = store.read(identity.thread_id)
        directory = Path(tempfile.mkdtemp(prefix="cr-", dir="/tmp"))
        activated = time.time()
        record = Record(
            identity,
            uuid.uuid4().hex,
            str(directory / "s"),
            "starting",
            activated,
            activated + LIFETIME,
            attempted=previous.attempted if previous else (),
            own_clients=previous.own_clients if previous else (),
        )
        store.write(record)
        source = str(Path(__file__).resolve().parents[1])
        environment = dict(os.environ)
        environment["PYTHONPATH"] = source + (
            os.pathsep + environment["PYTHONPATH"] if environment.get("PYTHONPATH") else ""
        )
        process = subprocess.Popen(
            (
                sys.executable,
                "-m",
                "codex_recover",
                "--worker",
                identity.thread_id,
                "--lock-fd",
                str(fd),
                "--state-dir",
                str(store.root),
            ),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
            pass_fds=(fd,),
            env=environment,
        )
        threading.Thread(target=process.wait, daemon=True).start()
        os.close(fd)
        fd = None
        return wait_ready(store, identity.thread_id, deadline)
    except Exception:
        if process is not None and process.poll() is None:
            # This is the child just launched by this call, never a metadata PID.
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        if process is not None:
            store.observed(identity.thread_id)
        raise
    finally:
        if fd is not None:
            os.close(fd)


def deactivate(store: Store, record: Record) -> Record:
    observed = store.observed(record.identity.thread_id)
    if observed is None:
        return replace(record, status="stopped", stop_reason="not-armed")
    if observed.status == "stopped":
        return observed
    reply = control(observed, "off")
    if reply.record.status != "stopped":
        raise WorkerFailure("off-not-acknowledged")
    return reply.record
