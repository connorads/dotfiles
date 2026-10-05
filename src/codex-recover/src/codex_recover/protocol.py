"""Translate the daemon protocol into content-free recovery values."""

import hashlib
from collections.abc import Mapping

from codex_recover.engine import Event, GoalChanged, Stop, Stopped, TurnChanged, UserSubmitted, arm
from codex_recover.model import RECOVERABLE, Goal, GoalIntent, Snapshot, Turn, UserMessage
from codex_recover.rpc import Peer, TransportFailure, object_map


class ProtocolFailure(TransportFailure):
    pass


def text(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise ProtocolFailure("invalid-protocol-string")
    return value


def number(value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ProtocolFailure("invalid-protocol-number")
    return value


def array(value: object) -> tuple[object, ...]:
    if not isinstance(value, list):
        raise ProtocolFailure("invalid-protocol-array")
    return tuple(value)


def parse_user(item: Mapping[str, object]) -> UserMessage:
    client = item.get("clientId")
    return UserMessage(text(item.get("id")), None if client is None else text(client))


def parse_error(value: object) -> str | None:
    if value is None:
        return None
    info = object_map(value).get("codexErrorInfo")
    if info in ("cyberPolicy", "serverOverloaded"):
        return str(info)
    if not isinstance(info, dict) or len(info) != 1:
        return "ineligible"
    variant = object_map(info)
    code = next(iter(variant))
    if code not in RECOVERABLE or code in ("cyberPolicy", "serverOverloaded"):
        return "ineligible"
    status = object_map(variant[code]).get("httpStatusCode")
    if status is None or (
        isinstance(status, int)
        and not isinstance(status, bool)
        and (status in (408, 429) or 500 <= status <= 599)
    ):
        return code
    return "ineligible"


def parse_turn(value: object, *, full: bool = False) -> Turn:
    raw = object_map(value)
    if full and raw.get("itemsView") != "full":
        raise ProtocolFailure("turn-items-not-full")
    status = raw.get("status")
    if status not in ("inProgress", "completed", "failed", "interrupted"):
        raise ProtocolFailure("invalid-turn-status")
    users: list[UserMessage] = []
    for value in array(raw.get("items", [])):
        item = object_map(value)
        if item.get("type") == "userMessage":
            users.append(parse_user(item))
    match status:
        case "inProgress" | "completed" | "failed" | "interrupted":
            return Turn(text(raw.get("id")), status, parse_error(raw.get("error")), tuple(users))
        case _:
            raise ProtocolFailure("invalid-turn-status")


def parse_goal(value: object) -> Goal:
    raw = object_map(value)
    budget = raw.get("tokenBudget")
    intent = GoalIntent(
        hashlib.sha256(text(raw.get("objective")).encode()).hexdigest(),
        None if budget is None else number(budget),
        number(raw.get("createdAt")),
    )
    match raw.get("status"):
        case (
            "active"
            | "paused"
            | "blocked"
            | "complete"
            | "usageLimited"
            | "budgetLimited" as status
        ):
            return Goal(intent, status, number(raw.get("tokensUsed")))
        case _:
            raise ProtocolFailure("invalid-goal-status")


def decode_event(message: Mapping[str, object], thread_id: str) -> Event | None:
    method = message.get("method")
    params = object_map(message.get("params", {}))
    target = params.get("threadId")
    if target is not None and target != thread_id:
        return None
    if "id" in message:
        return Stop("interactive-request")
    if method == "recover/transportStopped":
        return Stop(text(params.get("reason")))
    if target != thread_id:
        return None
    if method == "thread/queue/changed":
        return Stop("manual-prompt")
    if method in ("thread/closed", "thread/archived", "thread/deleted", "thread/reverted"):
        return Stop("thread-unavailable")
    if method == "thread/goal/cleared":
        return GoalChanged(None, None)
    if method == "thread/goal/updated":
        turn_id = params.get("turnId")
        return GoalChanged(
            parse_goal(params.get("goal")), None if turn_id is None else text(turn_id)
        )
    if method in ("turn/started", "turn/completed"):
        return TurnChanged(parse_turn(params.get("turn")))
    if method in ("item/started", "item/completed"):
        item = object_map(params.get("item"))
        if item.get("type") == "userMessage":
            return UserSubmitted(parse_user(item))
        if item.get("type") == "agentMessage" and item.get("questions"):
            return Stop("interactive-request")
    if method == "thread/status/changed":
        status = object_map(params.get("status"))
        if status.get("activeFlags"):
            return Stop("interactive-request")
        if status.get("type") in ("notLoaded", "systemError"):
            return Stop("thread-unavailable")
    return None


class Codex:
    def __init__(self, peer: Peer, thread_id: str) -> None:
        self.peer = peer
        self.thread_id = thread_id

    async def snapshot(self) -> Snapshot:
        turns = await self.peer.request(
            "thread/turns/list",
            {
                "threadId": self.thread_id,
                "limit": 1,
                "sortDirection": "desc",
                "itemsView": "full",
            },
        )
        goal_result = await self.peer.request("thread/goal/get", {"threadId": self.thread_id})
        queued = await self.peer.request(
            "thread/queue/list", {"threadId": self.thread_id, "limit": 1}
        )
        thread_result = await self.peer.request(
            "thread/read", {"threadId": self.thread_id, "includeTurns": False}
        )
        raw_status = object_map(object_map(thread_result.get("thread")).get("status"))
        match raw_status.get("type"):
            case "idle" | "active" | "notLoaded" | "systemError" as status:
                pass
            case _:
                raise ProtocolFailure("invalid-thread-status")
        flags = array(raw_status.get("activeFlags", []))
        page = array(turns.get("data"))
        raw_goal = goal_result.get("goal")
        return Snapshot(
            status,
            bool(flags),
            parse_turn(page[0], full=True) if page else None,
            parse_goal(raw_goal) if raw_goal is not None else None,
            bool(array(queued.get("data"))),
        )

    async def attach(
        self,
        *,
        attempted: frozenset[str] = frozenset(),
        own_clients: frozenset[str] = frozenset(),
    ) -> tuple[Snapshot, Snapshot]:
        cursor: str | None = None
        while True:
            params: dict[str, object] = {}
            if cursor is not None:
                params["cursor"] = cursor
            loaded = await self.peer.request("thread/loaded/list", params)
            if self.thread_id in array(loaded.get("data")):
                break
            next_cursor = loaded.get("nextCursor")
            if next_cursor is None:
                raise ProtocolFailure("thread-not-loaded")
            cursor = text(next_cursor)
        before = await self.snapshot()
        eligible = arm(before, 0, attempted=attempted, own_clients=own_clients)
        if isinstance(eligible, Stopped):
            raise ProtocolFailure(eligible.reason)
        await self.peer.request("thread/resume", {"threadId": self.thread_id})
        after = await self.snapshot()
        before_turn = (before.turn.turn_id, before.turn.users) if before.turn else None
        after_turn = (after.turn.turn_id, after.turn.users) if after.turn else None
        before_goal = before.goal.intent if before.goal else None
        after_goal = after.goal.intent if after.goal else None
        if before_turn != after_turn or before_goal != after_goal:
            raise ProtocolFailure("attachment-changed")
        return before, after

    async def recover_goal(self) -> dict[str, object]:
        return await self.peer.request(
            "thread/goal/set", {"threadId": self.thread_id, "status": "active"}
        )

    async def continue_task(self, client_id: str) -> dict[str, object]:
        return await self.peer.request(
            "turn/start",
            {
                "threadId": self.thread_id,
                "clientUserMessageId": client_id,
                "input": [
                    {"type": "text", "text": "Continue the previous task.", "text_elements": []}
                ],
            },
        )
