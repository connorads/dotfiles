"""One serial decision loop with cancellable transport and identity effects."""

import asyncio
import contextlib
import json
import signal
import time
import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, replace
from pathlib import Path

from codex_recover.engine import (
    Backoff,
    Effect,
    Event,
    GoalChanged,
    Mutation,
    Recheck,
    Rechecked,
    Recovering,
    State,
    Stop,
    Stopped,
    Tick,
    TurnChanged,
    arm,
    step,
)
from codex_recover.model import Snapshot
from codex_recover.protocol import Codex, ProtocolFailure, decode_event, parse_goal, parse_turn
from codex_recover.rpc import Rpc, TransportFailure, object_map
from codex_recover.store import Record, Store


class Clock:
    def __init__(self, activation: float) -> None:
        self.activation = activation
        self.started = time.monotonic()

    def now(self) -> float:
        return max(time.time(), self.activation + time.monotonic() - self.started)


@dataclass(frozen=True)
class Attached:
    before: Snapshot
    after: Snapshot


@dataclass(frozen=True)
class Send:
    mutation: Mutation


@dataclass(frozen=True)
class Control:
    command: str
    reply: asyncio.Future[Record]


type Input = Event | Attached | Send | Control


class Worker:
    def __init__(
        self,
        store: Store,
        record: Record,
        *,
        command: tuple[str, ...] = ("codex", "app-server", "proxy"),
        now: Callable[[], float] | None = None,
        verify: Callable[[], bool] | None = None,
    ) -> None:
        self.store = store
        self.record = record
        self.command = command
        self.now = now or Clock(record.activated).now
        self.verify = verify or record.identity.matches
        self.queue: asyncio.Queue[Input] = asyncio.Queue()
        self.state: State | None = None
        self.buffered: list[Event] = []
        self.ready = False
        self.stopping = False
        self.tasks: set[asyncio.Task[None]] = set()
        self.rpc: Rpc | None = None
        self.codex: Codex | None = None
        self.controls: set[asyncio.Task[object]] = set()

    def on_message(self, message: dict[str, object]) -> None:
        try:
            event = decode_event(message, self.record.identity.thread_id)
        except TransportFailure:
            event = Stop("invalid-protocol")
        if event is not None:
            self.queue.put_nowait(event)

    def spawn(self, operation: Coroutine[object, object, None]) -> None:
        task = asyncio.create_task(operation)
        self.tasks.add(task)
        task.add_done_callback(self.completed)

    def completed(self, task: asyncio.Task[None]) -> None:
        self.tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            self.queue.put_nowait(Stop("worker-crashed"))

    async def attach(self) -> None:
        try:
            self.rpc = await Rpc.open(self.command, self.on_message)
            await self.rpc.initialise()
            self.codex = Codex(self.rpc, self.record.identity.thread_id)
            before, after = await self.codex.attach(
                attempted=frozenset(self.record.attempted),
                own_clients=frozenset(self.record.own_clients),
            )
            if not await asyncio.to_thread(self.verify):
                raise ProtocolFailure("pane-changed")
            self.queue.put_nowait(Attached(before, after))
        except TransportFailure as exc:
            self.queue.put_nowait(Stop(str(exc)))
        except OSError:
            self.queue.put_nowait(Stop("proxy-unavailable"))

    def persist(self) -> None:
        if self.state is not None:
            data = self.state.data
            intent = data.intent
            self.record = replace(
                self.record,
                status=type(self.state).__name__.lower(),
                expires=data.expires,
                retries=data.retries,
                stop_reason=self.state.reason if isinstance(self.state, Stopped) else None,
                attempted=tuple(sorted(data.attempted)),
                own_clients=tuple(sorted(data.own_clients)),
                goal_intent=f"{intent.created_at}:{intent.token_budget}:{intent.objective_hash}"
                if intent
                else None,
            )
        self.store.write(self.record)

    def stop(self, reason: str) -> None:
        if self.stopping:
            return
        self.stopping = True
        if self.state is not None:
            self.state = Stopped(self.state.data, reason)
        else:
            self.record = replace(self.record, status="stopped", stop_reason=reason)
        self.persist()
        for task in self.tasks:
            task.cancel()
        while not self.queue.empty():
            pending = self.queue.get_nowait()
            if isinstance(pending, Control) and not pending.reply.done():
                pending.reply.set_result(self.record)

    def apply(self, event: Event) -> None:
        if self.state is None:
            if isinstance(event, Stop):
                self.stop(event.reason)
            else:
                self.buffered.append(event)
            return
        previous = self.state
        self.state, effects = step(self.state, event, self.now())
        if isinstance(self.state, Stopped):
            self.stop(self.state.reason)
            return
        if self.state != previous:
            self.persist()
        for effect in effects:
            self.effect(effect)

    def effect(self, effect: Effect) -> None:
        if isinstance(effect, Recheck):
            self.spawn(self.recheck(effect.failed_turn))
        else:
            self.queue.put_nowait(Send(effect))

    async def recheck(self, failed_turn: str) -> None:
        assert self.codex is not None
        try:
            snapshot = await self.codex.snapshot()
            valid = await asyncio.to_thread(self.verify)
            self.queue.put_nowait(Rechecked(snapshot, valid, str(uuid.uuid4()), failed_turn))
        except TransportFailure as exc:
            self.queue.put_nowait(Stop(str(exc)))
        except OSError:
            self.queue.put_nowait(Stop("pane-probe-failed"))

    async def mutate(self, mutation: Mutation) -> None:
        assert self.codex is not None
        try:
            if mutation.goal:
                result = await self.codex.recover_goal()
                event: Event = GoalChanged(parse_goal(result.get("goal")), None)
            else:
                assert mutation.client_id is not None
                result = await self.codex.continue_task(mutation.client_id)
                event = TurnChanged(parse_turn(result.get("turn")))
            self.queue.put_nowait(event)
        except TransportFailure as exc:
            self.queue.put_nowait(Stop(str(exc)))

    async def check_pane(self) -> None:
        if not await asyncio.to_thread(self.verify):
            self.queue.put_nowait(Stop("pane-changed"))

    def attached(self, attachment: Attached) -> None:
        self.state = arm(
            attachment.before,
            self.record.activated,
            attempted=frozenset(self.record.attempted),
            own_clients=frozenset(self.record.own_clients),
        )
        for event in self.buffered:
            # Warm resume emits a snapshot with a null turn ID. Initial terminal
            # failure evidence, rather than that snapshot, authorises recovery.
            if (
                isinstance(event, GoalChanged)
                and event.turn_id is None
                and event.goal == attachment.before.goal
            ):
                continue
            self.apply(event)
            if self.stopping:
                return
        self.buffered.clear()
        current = self.state.data.turn
        latest = attachment.after.turn
        if (current.turn_id if current else None) != (latest.turn_id if latest else None):
            self.stop("attachment-changed")
            return
        if attachment.after.interactive or attachment.after.queued:
            self.stop("manual-prompt" if attachment.after.queued else "interactive-request")
            return
        goal = attachment.after.goal
        if goal != self.state.data.goal:
            correlation = latest.turn_id if goal and goal.status == "blocked" and latest else None
            self.apply(GoalChanged(goal, correlation))
        if latest is not None:
            self.apply(TurnChanged(latest))
        if isinstance(self.state, Stopped):
            self.stop(self.state.reason)
            return
        if attachment.after.thread_status == "notLoaded":
            self.stop("thread-unavailable")
            return
        self.ready = True
        self.persist()

    async def control(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.current_task()
        if task is not None:
            self.controls.add(task)
        try:
            value: object = json.loads(await asyncio.wait_for(reader.readline(), 5))
            message = object_map(value)
            if message.get("generation") != self.record.generation:
                return
            command = message.get("command")
            if command not in ("status", "off"):
                return
            if self.stopping:
                record = self.record
            else:
                reply: asyncio.Future[Record] = asyncio.get_running_loop().create_future()
                self.queue.put_nowait(Control(str(command), reply))
                record = await asyncio.wait_for(reply, 5)
            writer.write(
                json.dumps(
                    {
                        "generation": record.generation,
                        "ready": self.ready,
                        "record": record.document(),
                    }
                ).encode()
                + b"\n"
            )
            await writer.drain()
        except (ValueError, TransportFailure, OSError, TimeoutError):
            pass
        finally:
            if task is not None:
                self.controls.discard(task)
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()

    async def run(self) -> Record:
        server: asyncio.Server | None = None
        startup_limit = time.monotonic() + 10
        next_pane = self.now() + 5
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, self.queue.put_nowait, Stop("worker-terminated"))
        try:
            server = await asyncio.start_unix_server(self.control, path=self.record.socket)
            await asyncio.to_thread(Path(self.record.socket).chmod, 0o600)
            self.spawn(self.attach())
            while not self.stopping:
                if not self.ready and time.monotonic() >= startup_limit:
                    self.stop("startup-timeout")
                    break
                if self.now() >= self.record.expires:
                    self.stop("expired")
                    break
                if self.now() >= next_pane:
                    next_pane = self.now() + 5
                    self.spawn(self.check_pane())
                budget = min(1.0, max(0.001, self.record.expires - self.now()))
                if isinstance(self.state, Backoff):
                    budget = min(budget, max(0.001, self.state.until - self.now()))
                try:
                    event = await asyncio.wait_for(self.queue.get(), budget)
                except TimeoutError:
                    event = Tick()
                if isinstance(event, Control):
                    if event.command == "off":
                        self.stop("off")
                    if not event.reply.done():
                        event.reply.set_result(self.record)
                elif isinstance(event, Attached):
                    self.attached(event)
                elif isinstance(event, Send):
                    if not self.queue.empty():
                        self.queue.put_nowait(event)
                    elif (
                        isinstance(self.state, Recovering)
                        and self.state.sent
                        and self.state.failed_turn == event.mutation.failed_turn
                    ):
                        self.spawn(self.mutate(event.mutation))
                else:
                    self.apply(event)
                if self.ready and not self.stopping and self.queue.empty():
                    self.apply(Tick())
        except Exception:
            self.stop("worker-crashed")
        finally:
            for task in self.tasks:
                task.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)
            if self.rpc is not None:
                await self.rpc.close()
            if server is not None:
                server.close()
                await server.wait_closed()
            await asyncio.gather(*self.controls, return_exceptions=True)
            for sig in (signal.SIGINT, signal.SIGTERM):
                loop.remove_signal_handler(sig)
            await asyncio.to_thread(Path(self.record.socket).unlink, missing_ok=True)
            with contextlib.suppress(OSError):
                await asyncio.to_thread(Path(self.record.socket).parent.rmdir)
        return self.record
