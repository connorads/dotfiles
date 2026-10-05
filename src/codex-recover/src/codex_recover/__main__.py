"""Internal Python entry point used by the agent dispatcher and its worker."""

import argparse
import asyncio
import fcntl
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from codex_recover.lifecycle import WorkerFailure, activate, deactivate
from codex_recover.pane import PaneFailure, capture, pane_address
from codex_recover.store import Record, Store
from codex_recover.worker import Worker


def describe(record: Record) -> str:
    expiry = datetime.fromtimestamp(record.expires, UTC).isoformat(timespec="seconds")
    reason = f" reason={record.stop_reason}" if record.stop_reason else ""
    return f"{record.identity.thread_id} {record.identity.pane_id} {record.status} expires={expiry} retries={record.retries}{reason}"


def main() -> int:
    parser = argparse.ArgumentParser(prog="agent recover")
    parser.add_argument("command", nargs="?", choices=("on", "off", "status"))
    parser.add_argument("--pane")
    parser.add_argument("--worker", help=argparse.SUPPRESS)
    parser.add_argument("--lock-fd", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--state-dir", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        store = Store(args.state_dir)
        if args.worker is not None:
            if args.lock_fd is None:
                raise WorkerFailure("worker-lock-required")
            record = store.read(args.worker)
            if record is None:
                raise WorkerFailure("worker-record-required")
            actual = os.fstat(args.lock_fd)
            expected = store.lock_path(args.worker).stat()
            if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
                raise WorkerFailure("worker-lock-mismatch")
            fcntl.flock(args.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.set_inheritable(args.lock_fd, False)
            try:
                asyncio.run(Worker(store, record).run())
            finally:
                os.close(args.lock_fd)
            return 0
        if args.command in ("on", "off") and args.pane is None:
            parser.error("on and off require a target")
        if args.command == "on":
            print(describe(activate(capture(args.pane), store)))
            return 0
        if args.command not in ("status", "off"):
            parser.error("a command is required")
        records = store.records()
        if args.pane is not None:
            socket, server_pid, pane = pane_address(args.pane)
            records = [
                r
                for r in records
                if (r.identity.server_socket, r.identity.server_pid, r.identity.pane_id)
                == (socket, server_pid, pane)
            ]
        for record in records:
            observed = (
                deactivate(store, record)
                if args.command == "off"
                else store.observed(record.identity.thread_id)
            )
            if observed is not None:
                print(describe(observed))
        if not records:
            print("not armed" if args.pane else "no recovery records")
        return 0
    except (PaneFailure, WorkerFailure) as exc:
        print(f"agent recover: {exc}", file=sys.stderr)
        return 1
    except (ValueError, OSError):
        print("agent recover: invalid or inaccessible recovery metadata", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
