import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
from codex_recover.lifecycle import control, deactivate
from codex_recover.store import Store

OWNER = """
import json
from codex_recover.lifecycle import activate
from codex_recover.pane import capture
from codex_recover.store import Store
print(json.dumps(activate(capture('%1'), Store()).document()), flush=True)
"""


def wait_until(predicate):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("external worker condition timed out")


@pytest.fixture
def detached(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    binaries = tmp_path / "bin"
    binaries.mkdir()
    events = tmp_path / "events"
    os.mkfifo(events)
    log = tmp_path / "wire"
    scenario = tmp_path / "scenario"
    scenario.write_text("running")
    peer = Path(__file__).with_name("fake_peer.py")
    scripts = {
        "tmux": "import sys\nprint('/tmp/test-tmux\\0371\\037%1\\037thread\\037thread\\0370\\037working\\037100' if '@codex_thread_id' in sys.argv[-1] else '/tmp/test-tmux\\0371\\037%1')\n",
        "ps": "import sys\nprint('started' if 'lstart=' in sys.argv else '100 100 456 zsh\\n456 456 456 codex')\n",
        "codex": f"import os,sys\nfrom pathlib import Path\nos.execv(sys.executable, [sys.executable, '-u', {str(peer)!r}, Path({str(scenario)!r}).read_text(), {str(events)!r}, {str(log)!r}])\n",
    }
    for name, content in scripts.items():
        path = binaries / name
        path.write_text(f"#!{sys.executable}\n" + content)
        path.chmod(0o700)
    environment = dict(os.environ)
    environment.update(
        HOME=str(home),
        PATH=str(binaries) + os.pathsep + os.environ["PATH"],
        PYTHONPATH=str(peer.parent.parent / "src"),
    )
    store = Store(home / ".local/state/agents/codex-recover")
    fixture = {
        "env": environment,
        "store": store,
        "events": events,
        "log": log,
        "scenario": scenario,
    }
    yield fixture
    for record in store.records():
        deactivate(store, record)

    def released():
        fd = store.acquire("thread")
        if fd is None:
            return False
        os.close(fd)
        return True

    wait_until(released)


def start_owner(fixture):
    return subprocess.Popen(
        (sys.executable, "-c", OWNER),
        env=fixture["env"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def owner_result(process):
    stdout, stderr = process.communicate(timeout=12)
    assert process.returncode == 0, stderr.decode()
    return json.loads(stdout)


def requests(fixture, method):
    log = fixture["log"]
    return [
        json.loads(line)
        for line in log.read_text().splitlines()
        if json.loads(line).get("method") == method
    ]


def test_concurrent_and_repeated_on_share_worker_generation_and_deadline(detached):
    first = start_owner(detached)
    second = start_owner(detached)
    a, b = owner_result(first), owner_result(second)
    c = owner_result(start_owner(detached))
    assert a["generation"] == b["generation"] == c["generation"]
    assert a["expires"] == b["expires"] == c["expires"]
    assert len(requests(detached, "thread/resume")) == 1
    record = detached["store"].read("thread")
    assert control(record, "status").ready


def live_worker_pid(fixture):
    lsof = shutil.which("lsof") or "/usr/sbin/lsof"
    if not Path(lsof).exists():
        pytest.skip("lsof required to observe the fixture's live lock holder")
    result = subprocess.run(
        (lsof, "-t", str(fixture["store"].lock_path("thread"))),
        capture_output=True,
        text=True,
        check=True,
    )
    pids = result.stdout.splitlines()
    assert len(pids) == 1
    return int(pids[0])


def test_launching_process_exit_leaves_a_new_session_and_live_control_socket(detached):
    owner = start_owner(detached)
    owner_result(owner)
    assert owner.poll() == 0
    pid = live_worker_pid(detached)
    assert os.getsid(pid) == pid
    record = detached["store"].read("thread")
    assert control(record, "status").record.status == "watching"
    result = deactivate(detached["store"], record)
    assert result.status == "stopped"
    assert result.stop_reason == "off"


def test_crash_releases_lock_and_rearming_cannot_replay_consumed_failure(detached):
    owner_result(start_owner(detached))
    with detached["events"].open("w") as file:
        file.write(json.dumps({"action": "failure"}) + "\n")
    wait_until(lambda: len(requests(detached, "turn/start")) == 1)
    pid = live_worker_pid(detached)
    os.kill(pid, signal.SIGKILL)
    wait_until(lambda: detached["store"].observed("thread").status == "stopped")
    assert detached["store"].read("thread").stop_reason == "worker-lost"
    detached["scenario"].write_text("failed")
    owner = start_owner(detached)
    _, _ = owner.communicate(timeout=12)
    assert owner.returncode != 0
    assert detached["store"].read("thread").stop_reason == "already-attempted"
    assert len(requests(detached, "turn/start")) == 1
