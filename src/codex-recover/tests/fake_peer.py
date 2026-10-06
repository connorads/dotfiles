"""Executable fake daemon peer for worker tests. All contents are synthetic."""

import json
import sys
import threading

from wire_peer import messages, send

mode, fifo, wire_log = sys.argv[1:]
output_lock = threading.Lock()
goal = None
if "goal" in mode:
    goal = {
        "threadId": "thread",
        "objective": "synthetic objective",
        "status": "active",
        "tokenBudget": 1000,
        "tokensUsed": 10,
        "timeUsedSeconds": 1,
        "createdAt": 1,
        "updatedAt": 1,
    }
turn = {
    "id": "t1",
    "status": "inProgress",
    "error": None,
    "itemsView": "full",
    "items": [{"type": "userMessage", "id": "u1", "clientId": None, "content": []}],
}
if mode in ("failed", "uncertain_mutation"):
    turn.update(status="failed", error={"codexErrorInfo": "cyberPolicy"})


def emit(message):
    with output_lock:
        send(message)


def notification(method, **params):
    emit({"method": method, "params": {"threadId": "thread", **params}})


def commands():
    while True:
        with open(fifo) as file:
            for line in file:
                command = json.loads(line)
                action = command["action"]
                if action == "failure":
                    turn.update(
                        status="failed",
                        error={"codexErrorInfo": command.get("error", "serverOverloaded")},
                    )
                    if goal:
                        goal["status"] = "blocked"
                        notification("thread/goal/updated", goal=goal, turnId=turn["id"])
                    notification("thread/status/changed", status={"type": "systemError"})
                    notification(
                        "turn/completed", turn={**turn, "items": [], "itemsView": "notLoaded"}
                    )
                elif action == "manual":
                    item = {
                        "type": "userMessage",
                        "id": "manual-user",
                        "clientId": "manual-client",
                        "content": [],
                    }
                    turn["items"].append(item)
                    notification("item/started", item=item, turnId=turn["id"])
                elif action == "queue":
                    notification("thread/queue/changed")
                elif action == "complete":
                    turn["status"] = "completed"
                    notification(
                        "turn/completed", turn={**turn, "items": [], "itemsView": "summary"}
                    )
                elif action == "native":
                    turn.update(
                        id=command.get("id", "native"), status="inProgress", items=[], error=None
                    )
                    notification("turn/started", turn={**turn, "itemsView": "notLoaded"})
                elif action == "approval":
                    emit(
                        {
                            "id": "approval-1",
                            "method": "item/tool/requestUserInput",
                            "params": {"threadId": "thread"},
                        }
                    )
                elif action == "goal":
                    goal.update(command["changes"])
                    notification("thread/goal/updated", goal=goal, turnId=command.get("turnId"))
                elif action == "disconnect":
                    import os

                    os._exit(0)


threading.Thread(target=commands, daemon=True).start()
for request in messages():
    with open(wire_log, "a") as file:
        file.write(json.dumps(request) + "\n")
    method = request.get("method")
    if "id" not in request:
        continue
    if method == "initialize":
        result = {}
    elif method == "thread/loaded/list":
        result = {"data": ["thread"], "nextCursor": None}
    elif method == "thread/turns/list":
        result = {"data": [turn]}
    elif method == "thread/goal/get":
        result = {"goal": goal}
    elif method == "thread/queue/list":
        result = {"data": [{"id": "queued"}] if mode == "queued" else []}
    elif method == "thread/read":
        result = {
            "thread": {
                "status": {"type": "active", "activeFlags": []}
                if turn["status"] == "inProgress"
                else {"type": "systemError" if turn["status"] == "failed" else "idle"}
            }
        }
    elif method == "thread/resume":
        if mode == "attach_manual":
            item = {"type": "userMessage", "id": "new-user", "clientId": None, "content": []}
            turn["items"].append(item)
            notification("item/started", item=item, turnId="t1")
        if mode == "attach_request":
            emit(
                {
                    "id": "pending-approval",
                    "method": "item/tool/requestUserInput",
                    "params": {"threadId": "thread"},
                }
            )
        if mode == "hang_resume":
            continue
        result = {"thread": {"id": "thread"}}
    elif method == "turn/start":
        item = {
            "type": "userMessage",
            "id": "own-user",
            "clientId": request["params"]["clientUserMessageId"],
            "content": [],
        }
        turn.update(id="recovered", status="inProgress", items=[item], error=None)
        notification("item/started", item=item, turnId="recovered")
        notification("turn/started", turn={**turn, "items": [], "itemsView": "notLoaded"})
        if mode == "uncertain_mutation":
            continue
        result = {"turn": {**turn, "items": [], "itemsView": "notLoaded"}}
    elif method == "thread/goal/set":
        goal["status"] = "active"
        notification("thread/goal/updated", goal=goal, turnId=None)
        turn.update(id="goal-recovered", status="inProgress", items=[], error=None)
        notification("turn/started", turn={**turn, "itemsView": "notLoaded"})
        result = {"goal": goal}
    else:
        emit({"id": request["id"], "error": {"code": -32601, "message": "unsupported fake method"}})
        continue
    emit({"id": request["id"], "result": result})
