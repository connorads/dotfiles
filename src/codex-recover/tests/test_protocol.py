import asyncio
import sys

import pytest
from codex_recover.engine import Stop, UserSubmitted
from codex_recover.protocol import (
    Codex,
    ProtocolFailure,
    decode_event,
    parse_error,
    parse_goal,
    parse_turn,
)
from codex_recover.rpc import Rpc, TransportFailure


@pytest.mark.parametrize("code", ["cyberPolicy", "serverOverloaded"])
def test_structured_policy_and_overload(code):
    assert parse_error({"codexErrorInfo": code}) == code


@pytest.mark.parametrize(
    "code",
    [
        "httpConnectionFailed",
        "responseStreamConnectionFailed",
        "responseStreamDisconnected",
        "responseTooManyFailedAttempts",
    ],
)
@pytest.mark.parametrize(
    ("http_status", "eligible"),
    [
        (None, True),
        (408, True),
        (429, True),
        (500, True),
        (599, True),
        (400, False),
        (401, False),
        (403, False),
        (600, False),
    ],
)
def test_connection_status_whitelist(code, http_status, eligible):
    result = parse_error({"codexErrorInfo": {code: {"httpStatusCode": http_status}}})
    assert (result == code) == eligible


@pytest.mark.parametrize(
    "info",
    [
        None,
        "other",
        "unauthorized",
        "usageLimitExceeded",
        "rateLimitExceeded",
        "sessionBudgetExceeded",
        "contextWindowExceeded",
        "internalServerError",
        {"httpConnectionFailed": {"httpStatusCode": "500"}},
    ],
)
def test_unknown_authentication_quota_and_budget_errors_stop(info):
    assert (
        parse_error({"codexErrorInfo": info, "message": "stream disconnected, retry please"})
        == "ineligible"
    )


def test_only_user_identifiers_leave_item_parser():
    turn = parse_turn(
        {
            "id": "t",
            "status": "inProgress",
            "itemsView": "full",
            "error": None,
            "items": [
                {
                    "type": "userMessage",
                    "id": "item",
                    "clientId": "client",
                    "content": [{"text": "private"}],
                }
            ],
        },
        full=True,
    )
    assert turn.users[0].item_id == "item"
    assert turn.users[0].client_id == "client"
    assert "private" not in repr(turn)
    with pytest.raises(ProtocolFailure, match="turn-items-not-full"):
        parse_turn({"id": "t", "status": "failed", "itemsView": "summary", "items": []}, full=True)


def test_goal_intent_does_not_store_objective_or_usage_as_identity():
    raw = {
        "objective": "private objective",
        "status": "active",
        "createdAt": 1,
        "tokenBudget": 100,
        "tokensUsed": 2,
    }
    first = parse_goal(raw)
    raw["tokensUsed"] = 3
    assert parse_goal(raw).intent == first.intent
    assert "private" not in repr(first)


def test_requests_are_disarming_events_without_responses():
    assert decode_event(
        {
            "id": 44,
            "method": "item/commandExecution/requestApproval",
            "params": {"threadId": "thread"},
        },
        "thread",
    ) == Stop("interactive-request")
    assert (
        decode_event(
            {"id": 45, "method": "item/tool/requestUserInput", "params": {"threadId": "other"}},
            "thread",
        )
        is None
    )
    assert (
        decode_event(
            {"method": "error", "params": {"threadId": "thread", "turnId": "t", "willRetry": True}},
            "thread",
        )
        is None
    )
    event = decode_event(
        {
            "method": "item/started",
            "params": {
                "threadId": "thread",
                "item": {"type": "userMessage", "id": "u", "clientId": "own"},
            },
        },
        "thread",
    )
    assert isinstance(event, UserSubmitted)
    assert event.user.client_id == "own"


PEER = """
import json, sys
for line in sys.stdin:
    m = json.loads(line)
    method = m.get("method")
    if "id" not in m: continue
    print(json.dumps({"method": "requestSeen", "params": {"method": method}}), flush=True)
    if method == "disconnect": sys.exit(0)
    if method == "hang": continue
    print(json.dumps({"id": 800, "method": "item/tool/requestUserInput", "params": {"threadId": "t"}}), flush=True)
    print(json.dumps({"method": "item/started", "params": {"threadId": "t", "item": {"type": "userMessage", "id": "u", "clientId": "own"}}}), flush=True)
    print(json.dumps({"id": m["id"], "result": {"method": method}}), flush=True)
"""


def test_stdio_peer_preserves_notifications_before_response_and_never_answers_requests():
    async def run():
        events = []
        rpc = await Rpc.open((sys.executable, "-u", "-c", PEER), events.append)
        try:
            result = await rpc.request("test", {})
            assert result == {"method": "test"}
            assert events[1]["id"] == 800
            assert events[2]["method"] == "item/started"
            assert sum(e["method"] == "requestSeen" for e in events) == 1
        finally:
            await rpc.close()

    asyncio.run(run())


@pytest.mark.parametrize(
    ("method", "reason"), [("hang", "rpc-timeout"), ("disconnect", "daemon-disconnected")]
)
def test_uncertain_request_stops_without_replay(method, reason):
    async def run():
        events = []
        rpc = await Rpc.open((sys.executable, "-u", "-c", PEER), events.append, rpc_deadline=0.05)
        try:
            with pytest.raises(TransportFailure, match=reason):
                await rpc.request(method, {})
            assert sum(e["method"] == "requestSeen" for e in events) == 1
        finally:
            await rpc.close()

    asyncio.run(run())


class FakeRpc:
    def __init__(self):
        self.calls = []
        self.turn = {
            "id": "turn",
            "status": "inProgress",
            "itemsView": "full",
            "items": [{"type": "userMessage", "id": "u", "clientId": None}],
            "error": None,
        }
        self.hook = lambda method: None

    async def request(self, method, params):
        self.calls.append((method, params))
        self.hook(method)
        match method:
            case "thread/loaded/list":
                return {"data": ["t"], "nextCursor": None}
            case "thread/read":
                return {"thread": {"status": {"type": "active", "activeFlags": []}}}
            case "thread/turns/list":
                return {"data": [self.turn]}
            case "thread/goal/get":
                return {"goal": None}
            case _:
                return {}


def test_attachment_omits_all_settings_and_checks_full_turn_twice():
    async def run():
        peer = FakeRpc()
        codex = Codex(peer, "t")
        before, after = await codex.attach()
        assert before == after
        assert ("thread/resume", {"threadId": "t"}) in peer.calls
        pages = [p for m, p in peer.calls if m == "thread/turns/list"]
        assert (
            pages
            == [{"threadId": "t", "limit": 1, "sortDirection": "desc", "itemsView": "full"}] * 2
        )

    asyncio.run(run())


@pytest.mark.parametrize("change", ["turn", "user"])
def test_attachment_rejects_changed_turn_or_manual_prompt(change):
    async def run():
        peer = FakeRpc()

        def hook(method):
            if method == "thread/resume":
                if change == "turn":
                    peer.turn["id"] = "new-turn"
                else:
                    peer.turn["items"] = [
                        {"type": "userMessage", "id": "new-user", "clientId": None}
                    ]

        peer.hook = hook
        with pytest.raises(ProtocolFailure, match="attachment-changed"):
            await Codex(peer, "t").attach()

    asyncio.run(run())


def test_mutation_wire_payloads_preserve_goal_settings():
    async def run():
        peer = FakeRpc()
        codex = Codex(peer, "t")
        await codex.recover_goal()
        await codex.continue_task("client-unique")
        assert peer.calls == [
            ("thread/goal/set", {"threadId": "t", "status": "active"}),
            (
                "turn/start",
                {
                    "threadId": "t",
                    "clientUserMessageId": "client-unique",
                    "input": [
                        {"type": "text", "text": "Continue the previous task.", "text_elements": []}
                    ],
                },
            ),
        ]

    asyncio.run(run())
