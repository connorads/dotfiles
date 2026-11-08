"""Disposable BB rehearsal. This command has no live activation operation."""

import argparse
import contextlib
import fcntl
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from functools import lru_cache
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener

from bb_patch import canonical, durable_json
from lab_candidate import prepare_verified, verify_receipt

SCRIPT = Path(__file__).resolve()
ACTIVE = {"preparing", "rehearsing"}
HTTP = build_opener(ProxyHandler({}))


@lru_cache(maxsize=1)
def temporary_root():
    if sys.platform == "darwin":
        return Path(
            subprocess.check_output(["/usr/bin/getconf", "DARWIN_USER_TEMP_DIR"], text=True).strip()
        ).resolve(strict=True)
    return Path("/tmp").resolve(strict=True)


def safe_root(root):
    root = Path(root)
    temporary = temporary_root()
    if (
        root.is_symlink()
        or root.resolve() != root
        or root.parent != temporary
        or not root.name.startswith("bb-patch-lab-")
    ):
        raise ValueError("Only a canonical temporary rehearsal directory is admitted")
    if root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
        raise ValueError("Rehearsal directory ownership or permissions are unsafe")
    marker = root / "lab.json"
    if marker.is_symlink():
        raise ValueError("Symlinked rehearsal record refused")
    record = json.loads(marker.read_bytes())
    if record["schema"] != 1 or record["scope"] != "disposable-only" or record["id"] != root.name:
        raise ValueError("Invalid rehearsal identity")
    return record


def save(root, record):
    record["revision"] += 1
    record["updatedAt"] = time.time()
    durable_json(root / "lab.json", record)
    (root / "lab.json").chmod(0o600)


def phase(root, record, value, message):
    record["phase"] = value
    record["events"].append(message)
    record["events"] = record["events"][-30:]
    save(root, record)


def signature(pid):
    result = subprocess.run(
        ["/bin/ps", "-p", str(pid), "-o", "lstart=", "-o", "args="],
        capture_output=True,
        text=True,
        timeout=5,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def owned_process(process, root):
    if not process:
        return False
    actual = signature(process["pid"])
    if not actual:
        return False
    if actual != process["signature"] or str(root) not in actual:
        raise ValueError("Recorded process identity differs; refusing to signal it")
    return True


def stop_process(process, root):
    if not owned_process(process, root):
        return
    os.kill(process["pid"], signal.SIGTERM)
    for _ in range(50):
        if not signature(process["pid"]):
            return
        time.sleep(0.1)
    # A stubborn or reused PID is never escalated automatically.
    raise ValueError("Rehearsal process did not stop; inspect its recorded identity")


@contextlib.contextmanager
def lock(root, blocking=False):
    with (root / "operation.lock").open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            raise ValueError("A rehearsal operation is already running") from None
        yield


def create(package, node):
    root = Path(tempfile.mkdtemp(prefix="bb-patch-lab-", dir=temporary_root())).resolve()
    root.chmod(0o700)
    record = {
        "schema": 1,
        "scope": "disposable-only",
        "id": root.name,
        "phase": "created",
        "revision": 0,
        "source": str(package.resolve(strict=True)),
        "node": str(node.resolve(strict=True)),
        "events": [],
        "worker": None,
        "server": None,
        "receipt": None,
        "checks": {},
        "liveActivation": False,
    }
    for directory in ("home", "data", "cache", "config", "workspace", "tmp"):
        (root / directory).mkdir(mode=0o700)
    save(root, record)
    return root


def environment(root, port):
    if port < 1024 or port > 65535 or port == 38886:
        raise ValueError("Live or privileged server port refused")
    return {
        "HOME": str(root / "home"),
        "PATH": "/usr/bin:/bin",
        "TMPDIR": str(root / "tmp"),
        "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_CACHE_HOME": str(root / "cache"),
        "XDG_DATA_HOME": str(root / "data"),
        "BB_DATA_DIR": str(root / "data"),
        "BB_SERVER_BIND_HOST": "127.0.0.1",
        "BB_SERVER_PORT": str(port),
        "BB_TELEMETRY": "false",
        "BB_SKIP_ONBOARDING": "true",
        "BB_SERVER_LAUNCH_ID": root.name,
        "BB_HOST_DAEMON_PORT": str(port),
        "LC_ALL": "C",
    }


def free_port():
    with socket.socket() as stream:
        stream.bind(("127.0.0.1", 0))
        port = stream.getsockname()[1]
    if port == 38886:
        return free_port()
    return port


def get(port, path):
    if port == 38886:
        raise ValueError("Live server access is not admitted")
    with HTTP.open(f"http://127.0.0.1:{port}{path}", timeout=2) as response:
        return json.load(response)


def listener_owned(pid, port):
    result = subprocess.run(
        [
            "/usr/sbin/lsof",
            "-nP",
            "-a",
            "-p",
            str(pid),
            "-iTCP:" + str(port),
            "-sTCP:LISTEN",
            "-Fp",
        ],
        capture_output=True,
        text=True,
        timeout=5,
    )
    return "p" + str(pid) in result.stdout.splitlines()


def launch(root, record, package, port, expect_empty=True):
    package = package.resolve(strict=True)
    if not package.is_relative_to(root) or package.is_symlink():
        raise ValueError("Server code must be inside the disposable rehearsal")
    entry = package / "server/dist/index.js"
    if not entry.resolve(strict=True).is_relative_to(root):
        raise ValueError("Server entry escapes rehearsal")
    with (root / "server.log").open("ab") as log:
        child = subprocess.Popen(
            [record["node"], str(entry)],
            cwd=root / "workspace",
            env=environment(root, port),
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    # Record the owned process immediately; even failed startup remains recoverable.
    process = {"pid": child.pid, "signature": signature(child.pid), "port": port}
    record["server"] = process
    save(root, record)
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise ValueError("Disposable server exited; inspect server.log")
        try:
            if listener_owned(child.pid, port) and get(port, "/health").get("ok"):
                threads = get(port, "/api/v1/threads")
                if not isinstance(threads, list) or (expect_empty and threads):
                    raise ValueError("Unexpected disposable thread state")
                return child
        except (OSError, URLError, ValueError):
            pass
        time.sleep(0.2)
    raise ValueError("Disposable server health check timed out")


def stop_owned_server(root, record, child=None):
    # Reap direct children before checking PID liveness, avoiding zombie ambiguity.
    process = record.get("server")
    if child is not None and child.poll() is not None:
        record["server"] = None
        save(root, record)
        return
    if process and owned_process(process, root):
        os.kill(process["pid"], signal.SIGTERM)
        if child is not None:
            child.wait(timeout=10)
        else:
            stop_process(process, root)
    record["server"] = None
    save(root, record)


def activity_query_check(root, record):
    """Exercise the actual HTTP aggregation over synthetic persisted states."""
    process = record["server"]
    if not owned_process(process, root) or not listener_owned(process["pid"], process["port"]):
        raise ValueError("Disposable listener ownership is not established")
    port = process["port"]
    request = Request(
        f"http://127.0.0.1:{port}/api/v1/plugins/workflows/enable",
        method="POST",
        data=b"{}",
        headers={"Content-Type": "application/json"},
    )
    with HTTP.open(request, timeout=10) as response:
        response.read()
    deadline = time.monotonic() + 10
    workflow_db = None
    while time.monotonic() < deadline:
        for path in (root / "data").rglob("*"):
            if path.is_symlink() or path.suffix not in {".db", ".sqlite"}:
                continue
            with sqlite3.connect(path) as database:
                if database.execute(
                    "SELECT 1 FROM sqlite_master WHERE name='workflow_runs'"
                ).fetchone():
                    workflow_db = path
                    break
        if workflow_db:
            break
        time.sleep(0.1)
    if not workflow_db:
        raise ValueError("Disposable workflow database unavailable")
    time.sleep(1)
    now = int(time.time() * 1000)
    with sqlite3.connect(root / "data/bb.db") as database:
        database.execute(
            "INSERT INTO hosts(id,name,type,created_at,updated_at) VALUES('hst_patchlab','Patch lab','local',?,?)",
            (now, now),
        )
        database.execute(
            "INSERT INTO projects(id,name,created_at,updated_at) VALUES('prj_patchlab','Patch lab',?,?)",
            (now, now),
        )
        database.execute(
            "INSERT INTO environments(id,project_id,host_id,path,status,created_at,updated_at) VALUES('env_patchlab','prj_patchlab','hst_patchlab',?,'ready',?,?)",
            (str(root / "workspace"), now, now),
        )
        database.execute(
            "INSERT INTO threads(id,project_id,environment_id,provider_id,title,status,latest_attention_at,created_at,updated_at) VALUES('thr_patchlab','prj_patchlab','env_patchlab','codex','Patch lab','idle',?,?,?)",
            (now, now, now),
        )
    with sqlite3.connect(workflow_db) as database:
        database.execute(
            "INSERT INTO workflow_runs(id,project_id,origin_thread_id,environment_id,origin_provider,origin_model,origin_reasoning_level,origin_permission_mode,name,source,source_hash,args_json,status,created_at,started_at,notification_sent,notification_outcome) VALUES('wfr_patchlab','prj_patchlab','thr_patchlab','env_patchlab','codex','synthetic','medium','full','Patch lab','export const meta={name: \"Patch lab\", description: \"Synthetic\", phases: []};','synthetic','{}','running',?,?,1,'delivered')",
            (now, now),
        )
    try:
        assert_activity(port, 1)
    finally:
        # Never leave running fixtures for startup reconciliation to queue and execute.
        with sqlite3.connect(workflow_db) as database:
            database.execute(
                "UPDATE workflow_runs SET status='succeeded',finished_at=? WHERE id='wfr_patchlab'",
                (int(time.time() * 1000),),
            )
    assert_activity(port, 0)


def assert_activity(port, expected):
    deadline = time.monotonic() + 10
    last = None
    while time.monotonic() < deadline:
        rows = get(port, "/api/v1/threads")
        row = next((entry for entry in rows if entry["id"] == "thr_patchlab"), None)
        last = row.get("activity", {}).get("activeWorkflowCount") if row else None
        running = get(port, "/api/v1/threads/running")
        if running:
            raise ValueError("Unexpected provider work in disposable fixture")
        if last == expected:
            return
        time.sleep(0.2)
    raise ValueError(f"Disposable activity aggregation expected {expected}, observed {last}")


def worker(root, action):
    with lock(root, blocking=True):
        record = safe_root(root)
        record["worker"] = {"pid": os.getpid(), "signature": signature(os.getpid())}
        save(root, record)
        child = None
        try:
            if action == "prepare":
                phase(
                    root,
                    record,
                    "preparing",
                    "Preparing an isolated candidate; live deployment unchanged",
                )
                receipt = prepare_verified(
                    Path(record["source"]), root / "releases", Path(record["node"])
                )
                record["receipt"] = str(receipt)
                record["checks"]["offline"] = "passed"
                phase(
                    root,
                    record,
                    "ready",
                    "Both required patches passed offline checks; receipt saved",
                )
            elif action == "run":
                phase(
                    root,
                    record,
                    "rehearsing",
                    "Revalidating candidate, runtime, dependencies and recipe",
                )
                receipt = verify_receipt(Path(record["receipt"]))
                candidate = Path(receipt["report"]["package"])
                if not candidate.resolve().is_relative_to(root):
                    raise ValueError("Candidate escapes disposable rehearsal")
                baseline = root / "baseline/package"
                if baseline.exists():
                    raise ValueError("Rehearsal already ran; create a fresh rehearsal")
                baseline.parent.mkdir()
                shutil.copytree(record["source"], baseline, symlinks=False)
                (baseline.parent / "node_modules").symlink_to(
                    Path(record["source"]).parent, target_is_directory=True
                )
                port = free_port()
                environment(root, port)
                phase(
                    root,
                    record,
                    "rehearsing",
                    "Starting disposable stock server on a separate loopback port",
                )
                child = launch(root, record, baseline, port)
                record["checks"]["stockHealth"] = "passed"
                phase(
                    root,
                    record,
                    "rehearsing",
                    "Stock server health passed; recording restart intent",
                )
                stop_owned_server(root, record, child)
                child = None
                verify_receipt(Path(record["receipt"]))
                phase(
                    root,
                    record,
                    "rehearsing",
                    "Starting verified candidate against the disposable data directory",
                )
                child = launch(root, record, candidate, port)
                record["checks"]["candidateHealth"] = "passed"
                record["checks"]["restart"] = "passed"
                phase(
                    root,
                    record,
                    "rehearsing",
                    "Checking live activity-count API over synthetic disposable records",
                )
                activity_query_check(root, record)
                record["checks"]["activityAggregation"] = "passed"
                stop_owned_server(root, record, child)
                child = None
                phase(
                    root,
                    record,
                    "rehearsing",
                    "Checking terminal workflow records after a cold restart",
                )
                child = launch(root, record, candidate, port, expect_empty=False)
                assert_activity(port, 0)
                record["checks"]["terminalPersistence"] = "passed"
                record["checks"]["liveFeatures"] = "not-checked"
                phase(
                    root,
                    record,
                    "checks-pending",
                    "Disposable restart passed. Live feature acceptance remains separate",
                )
            else:
                raise ValueError("Unknown rehearsal action")
        except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
            phase(root, record, "blocked", str(error)[:500])
        finally:
            if record.get("server"):
                try:
                    stop_owned_server(root, record, child)
                except (OSError, ValueError, subprocess.SubprocessError) as error:
                    phase(root, record, "interrupted", str(error)[:500])
            record["worker"] = None
            save(root, record)


def start(root, action, expected_revision):
    with lock(root):
        record = safe_root(root)
        if record["revision"] != expected_revision:
            raise ValueError("Rehearsal changed; refresh before starting an action")
        if (action == "prepare" and record["phase"] != "created") or (
            action == "run" and record["phase"] != "ready"
        ):
            raise ValueError("This action is not admitted in the current phase")
        phase(
            root,
            record,
            "preparing" if action == "prepare" else "rehearsing",
            "Host worker requested",
        )
        with (root / "worker.log").open("ab") as log:
            launched = subprocess.Popen(
                [sys.executable, "-B", str(SCRIPT), "worker", str(root), action],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                env={"PATH": "/usr/bin:/bin", "HOME": str(root / "home"), "LC_ALL": "C"},
                cwd=root,
                start_new_session=True,
            )
        record["worker"] = {"pid": launched.pid, "signature": signature(launched.pid)}
        save(root, record)
    return summary(record)


def public_status(root):
    record = safe_root(root)
    phase_value = record["phase"]
    if phase_value in ACTIVE and record.get("worker") and not owned_process(record["worker"], root):
        phase_value = "interrupted"
    return summary(record, phase_value)


def summary(record, phase_value=None):
    return {
        "id": record["id"],
        "phase": phase_value or record["phase"],
        "revision": record["revision"],
        "events": record["events"],
        "checks": record["checks"],
        "liveActivation": False,
        "root": str(temporary_root() / record["id"]),
    }


def reconcile(root):
    with lock(root):
        record = safe_root(root)
        if record.get("worker") and owned_process(record["worker"], root):
            raise ValueError("The worker is still running")
        stop_owned_server(root, record)
        record["worker"] = None
        phase(
            root,
            record,
            "stopped",
            "Owned disposable process inspected and stopped; no automatic restart",
        )
    return public_status(root)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    new = commands.add_parser("create")
    new.add_argument("--package", required=True, type=Path)
    new.add_argument("--node", required=True, type=Path)
    for name in ("status", "reconcile"):
        commands.add_parser(name).add_argument("root", type=Path)
    run = commands.add_parser("start")
    run.add_argument("root", type=Path)
    run.add_argument("action", choices=["prepare", "run"])
    run.add_argument("revision", type=int)
    background = commands.add_parser("worker")
    background.add_argument("root", type=Path)
    background.add_argument("action", choices=["prepare", "run"])
    args = parser.parse_args()
    try:
        if args.command == "create":
            result = public_status(create(args.package, args.node))
        elif args.command == "status":
            result = public_status(args.root)
        elif args.command == "start":
            result = start(args.root, args.action, args.revision)
        elif args.command == "reconcile":
            result = reconcile(args.root)
        else:
            worker(args.root, args.action)
            return 0
        print(canonical(result).decode())
        return 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error)[:500]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
