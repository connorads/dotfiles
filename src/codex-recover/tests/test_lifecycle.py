import json
import os
import subprocess
import sys
from dataclasses import replace

import pytest
from codex_recover.pane import PaneFailure, PaneIdentity, capture
from codex_recover.store import Record, Store


def identity():
    return PaneIdentity("/tmp/test-tmux", 123, "%1", "thread", 456, "start-time")


def record():
    return Record(identity(), "generation", "/tmp/cr-test/s", "starting", 100, 28900)


def test_persistent_lock_cannot_be_acquired_by_a_second_process(tmp_path):
    store = Store(tmp_path / "state")
    fd = store.acquire("thread")
    assert fd is not None
    try:
        script = "import fcntl,os,sys; f=os.open(sys.argv[1],os.O_RDWR); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)"
        child = subprocess.run(
            [sys.executable, "-c", script, str(store.lock_path("thread"))], capture_output=True
        )
        assert child.returncode != 0
        assert store.acquire("thread") is None
    finally:
        os.close(fd)
    fd = store.acquire("thread")
    assert fd is not None
    os.close(fd)
    assert store.lock_path("thread").exists()


def test_atomic_private_metadata_retains_consumption_and_stop_reason(tmp_path):
    store = Store(tmp_path / "state")
    saved = replace(
        record(),
        status="stopped",
        stop_reason="rpc-timeout",
        attempted=("t1",),
        own_clients=("client1",),
    )
    store.write(saved)
    assert store.read("thread") == saved
    assert store.records() == [saved]
    assert store.root.stat().st_mode & 0o777 == 0o700
    assert store.record_path("thread").stat().st_mode & 0o777 == 0o600
    assert not list(store.root.glob("*.tmp"))


def test_stale_metadata_is_marked_lost_without_signalling_any_pid(tmp_path):
    store = Store(tmp_path / "state")
    store.write(replace(record(), status="watching", attempted=("t1",)))
    stale = store.observed("thread")
    assert stale.status == "stopped"
    assert stale.stop_reason == "worker-lost"
    assert stale.attempted == ("t1",)
    assert store.read("thread") == stale


def test_metadata_and_lock_paths_do_not_accept_thread_path_traversal(tmp_path):
    store = Store(tmp_path / "state")
    assert store.record_path("../../secret").parent == store.root
    assert store.lock_path("../../secret").parent == store.root
    target = tmp_path / "outside"
    target.write_text("untouched")
    store.record_path("thread").symlink_to(target)
    with pytest.raises(OSError, match="Too many levels"):
        store.read("thread")
    assert target.read_text() == "untouched"


def test_corrupt_metadata_fails_without_discarding_attempt_history(tmp_path):
    store = Store(tmp_path / "state")
    store.record_path("thread").write_text('{"attempted": ["t1"]}')
    with pytest.raises(ValueError, match="invalid-metadata"):
        store.read("thread")


def test_pane_capture_requires_published_identity_and_a_live_foreground_codex():
    def run(args):
        if args[0] == "tmux":
            return "\037".join(
                ("/tmp/test-tmux", "123", "%1", "thread", "thread", "0", "working", "100")
            )
        if "lstart=" in args:
            return "start-time"
        return "100 100 456 zsh\n456 456 456 /usr/bin/codex\n"

    assert capture("%1", run=run) == identity()


@pytest.mark.parametrize("change", ["unpublished", "hibernated", "dead", "shell", "unknown"])
def test_unsafe_pane_identity_is_rejected(change):
    def run(args):
        if args[0] == "tmux":
            row = ["/tmp/test-tmux", "123", "%1", "thread", "thread", "0", "working", "100"]
            if change == "unpublished":
                row[4] = ""
            if change == "hibernated":
                row[6] = "hibernated"
            if change == "dead":
                row[5] = "1"
            return "\037".join(row)
        if "lstart=" in args:
            return "start-time"
        if change == "unknown":
            raise PaneFailure("pane-probe-failed")
        return "100 100 456 zsh\n456 456 456 bash\n"

    with pytest.raises(PaneFailure, match="pane-"):
        capture("%1", run=run)


def test_record_has_no_prompt_or_tool_output_fields(tmp_path):
    store = Store(tmp_path / "state")
    store.write(record())
    raw = json.loads(store.record_path("thread").read_text())
    assert set(raw) == {
        "identity",
        "generation",
        "socket",
        "status",
        "activated",
        "expires",
        "retries",
        "stopReason",
        "attempted",
        "ownClients",
        "goalIntent",
    }
