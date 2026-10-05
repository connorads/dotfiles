import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest
from codex_recover.engine import Stop
from codex_recover.lifecycle import control
from codex_recover.pane import PaneIdentity
from codex_recover.store import Record, Store
from codex_recover.worker import Worker


async def until(predicate):
    async with asyncio.timeout(8):
        while not predicate():  # noqa: ASYNC110 - Poll external metadata and peer logs.
            await asyncio.sleep(0.01)


class Harness:
    def __init__(self, tmp_path, mode, *, verify=lambda: True, clock=None):
        self.fifo = tmp_path / "events"
        os.mkfifo(self.fifo)
        self.log = tmp_path / "wire"
        self.store = Store(tmp_path / "state")
        self.identity = PaneIdentity("/tmp/test-tmux", 1, "%1", "thread", 2, "started")
        activated = clock() if clock else time.time()
        directory = Path(tempfile.mkdtemp(prefix="cr-test-", dir="/tmp"))
        self.record = Record(
            self.identity,
            "generation",
            str(directory / "s"),
            "starting",
            activated,
            activated + 28800,
        )
        self.store.write(self.record)
        self.worker = Worker(
            self.store,
            self.record,
            command=(
                sys.executable,
                "-u",
                str(Path(__file__).with_name("fake_peer.py")),
                mode,
                str(self.fifo),
                str(self.log),
            ),
            verify=verify,
            now=clock,
        )
        self.task = asyncio.create_task(self.worker.run())

    def calls(self, method=None):
        rows = (
            [json.loads(line) for line in self.log.read_text().splitlines()]
            if self.log.exists()
            else []
        )
        return [row for row in rows if method is None or row.get("method") == method]

    async def ready(self):
        await until(lambda: self.worker.ready or self.task.done())
        assert self.worker.ready, self.store.read("thread")

    async def send(self, action, **fields):
        def write():
            with self.fifo.open("w") as file:
                file.write(json.dumps({"action": action, **fields}) + "\n")

        await asyncio.to_thread(write)

    async def close(self):
        if not self.task.done():
            self.worker.apply(Stop("test-stop"))
        return await self.task


def test_real_proxy_connection_recovers_once_and_recognises_own_item_before_response(tmp_path):
    async def run():
        h = Harness(tmp_path, "running")
        try:
            await h.ready()
            await h.send("failure")
            await until(lambda: len(h.calls("turn/start")) == 1)
            await h.send("complete")
            result = await h.task
            assert result.stop_reason == "task-complete"
            assert result.attempted == ("t1",)
            assert len(result.own_clients) == 1
            assert len(h.calls("turn/start")) == 1
            params = h.calls("turn/start")[0]["params"]
            assert params["clientUserMessageId"] == result.own_clients[0]
        finally:
            await h.close()

    asyncio.run(run())


def test_goal_failure_before_completion_recovers_and_native_success_stays_armed(tmp_path):
    async def run():
        h = Harness(tmp_path, "running_goal")
        try:
            await h.ready()
            await h.send("failure", error="cyberPolicy")
            await until(lambda: len(h.calls("thread/goal/set")) == 1)
            assert h.calls("thread/goal/set")[0]["params"] == {
                "threadId": "thread",
                "status": "active",
            }
            await h.send("complete")
            await h.send("native")
            await h.send("goal", changes={"status": "blocked"}, turnId="native")
            await h.send("complete")
            assert (await h.task).stop_reason == "goal-blocked"
            assert not h.calls("turn/start")
        finally:
            await h.close()

    asyncio.run(run())


@pytest.mark.parametrize(
    ("mode", "reason"),
    [
        ("attach_manual", "manual-prompt"),
        ("attach_request", "interactive-request"),
        ("queued", "manual-prompt"),
    ],
)
def test_attachment_rejects_prompts_queued_input_and_replayed_requests(tmp_path, mode, reason):
    async def run():
        h = Harness(tmp_path, mode)
        try:
            result = await h.task
            assert result.stop_reason in (reason, "attachment-changed")
            assert not h.calls("turn/start")
            assert not h.calls("thread/goal/set")
            assert all("method" in message for message in h.calls())
        finally:
            await h.close()

    asyncio.run(run())


@pytest.mark.parametrize(
    ("action", "reason"),
    [
        ("manual", "manual-prompt"),
        ("queue", "manual-prompt"),
        ("approval", "interactive-request"),
        ("disconnect", "daemon-disconnected"),
    ],
)
def test_manual_input_and_requests_stop_without_a_response(tmp_path, action, reason):
    async def run():
        h = Harness(tmp_path, "running")
        try:
            await h.ready()
            await h.send(action)
            assert (await h.task).stop_reason == reason
            assert not h.calls("turn/start")
            assert all("method" in message for message in h.calls())
        finally:
            await h.close()

    asyncio.run(run())


def test_immediate_off_cancels_attachment_before_acknowledgement(tmp_path):
    async def run():
        h = Harness(tmp_path, "hang_resume")
        try:
            await until(lambda: h.calls("thread/resume"))
            reply = await asyncio.to_thread(control, h.record, "off")
            assert reply.record.status == "stopped"
            assert reply.record.stop_reason == "off"
            assert (await h.task).stop_reason == "off"
            assert not h.calls("turn/start")
        finally:
            await h.close()

    asyncio.run(run())


def test_uncertain_mutation_is_saved_and_never_replayed(tmp_path):
    async def run():
        h = Harness(tmp_path, "uncertain_mutation")
        try:
            result = await h.task
            assert result.stop_reason == "rpc-timeout"
            assert result.attempted == ("t1",)
            assert len(h.calls("turn/start")) == 1
            assert h.store.read("thread").attempted == ("t1",)
        finally:
            await h.close()

    asyncio.run(run())


def test_deadline_cannot_extend_with_success_or_native_turns(tmp_path):
    async def run():
        time_now = [100.0]
        h = Harness(tmp_path, "running_goal", clock=lambda: time_now[0])
        try:
            await h.ready()
            await h.send("complete")
            await h.send("native")
            time_now[0] = 28900
            await asyncio.to_thread(control, h.record, "status")
            result = await h.task
            assert result.stop_reason == "expired"
            assert result.expires == 28900
        finally:
            await h.close()

    asyncio.run(run())


def test_pane_change_prevents_recovery(tmp_path):
    async def run():
        valid = [True]
        h = Harness(tmp_path, "running", verify=lambda: valid[0])
        try:
            await h.ready()
            valid[0] = False
            await h.send("failure")
            assert (await h.task).stop_reason == "pane-changed"
            assert not h.calls("turn/start")
        finally:
            await h.close()

    asyncio.run(run())


def test_manual_prompt_cancels_a_consecutive_failure_backoff(tmp_path):
    async def run():
        h = Harness(tmp_path, "running")
        try:
            await h.ready()
            await h.send("failure")
            await until(lambda: len(h.calls("turn/start")) == 1)
            await h.send("failure")
            await until(lambda: h.store.read("thread").status == "backoff")
            await h.send("manual")
            result = await h.task
            assert result.stop_reason == "manual-prompt"
            assert len(h.calls("turn/start")) == 1
        finally:
            await h.close()

    asyncio.run(run())
