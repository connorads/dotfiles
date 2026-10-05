# Codex recovery

The recovery engine watches one existing Codex task through the installed
`codex app-server proxy`. It accepts structured transient failures and produces
one recovery action per failed turn. Goal recovery changes only its status;
ordinary recovery submits "Continue the previous task." with a saved client ID.

The pure engine takes snapshots, notifications and an injected clock. The
protocol adapter discards prompt contents and tool output, requires full latest
turn items, and attaches without settings overrides. Interactive server requests
receive no response. Unknown errors and uncertain RPC results stop recovery.

Protocol contracts follow the [app-server documentation](https://learn.chatgpt.com/docs/app-server)
and the installed daemon schema. The proxy never starts or restarts the daemon. It relays raw bytes;
`websocket.py` implements the daemon socket's WebSocket handshake and framing
using the standard library.

## Commands

```sh
agent recover on <target>
agent recover status [<target>]
agent recover off <target>
```

Targets are agent names, pane IDs or tmux addresses. Arming requires a live
Codex pane with its SessionStart-published thread ID and an already loaded
thread. It accepts a running task or its latest eligible failed turn. Idle
completed tasks, paused goals and pending questions or approvals are rejected.
`on` returns after attachment succeeds. Repeated arming reports the same worker
without extending its deadline.

The detached worker runs for eight hours. The first failure recovers immediately;
consecutive failures wait 15, 30, 60, 120, 240 and then 300 seconds. Successful
goal turns reset the delay. Structured policy and overload failures qualify,
as do recognised connection, stream and exhausted-retry errors with absent,
408, 429 or 5xx HTTP status. Authentication, quota, budget and unknown errors stop
recovery.

Manual prompts, interruptions, interactive requests, goal changes or limits,
pane replacement, hibernation and daemon disconnect stop recovery. Native goal
continuations remain armed. `off` cancels pending recovery before acknowledging;
it does not interrupt Codex or undo a request already sent. An idle Escape has
no reliable server event. A manual action between the final checks and a
recovery request can race with recovery because the server has no conditional
mutation operation.

Private metadata and persistent per-thread locks live under
`~/.local/state/agents/codex-recover/`. Metadata contains identities, expiry,
retry counts, consumed turn and client IDs, and the final stop reason. It never
contains prompt contents or tool output. A private Unix socket under `/tmp`
controls the worker. Workers survive terminal closure, stop on reboot or daemon
disconnect, and require explicit rearming. Consumed failed turns remain consumed
across rearming. Uncertain mutation results are never resent. Stale metadata
never authorises killing a process.

## Structure

`engine.py` is the pure reducer with watching, backoff, recovering and stopped
states. `protocol.py` and `rpc.py` adapt the daemon protocol. `pane.py` verifies
tmux and foreground process identity. `worker.py` serialises events and effects;
`store.py` and `lifecycle.py` own locking, metadata and detached control.

Attachment buffers notifications across snapshots and resumes without settings
overrides. Full latest-turn items and queued prompts are checked before readiness
and recovery. Blocked goal updates are tied to turn IDs; a blocked update alone
cannot cause a recovery.

## Development

```sh
uv run --group dev pytest -c pyproject.toml
pyrefly check -c pyrefly.toml
```

Python 3.12+ and standard-library-only runtime dependencies. Pytest disables
network sockets and permits private Unix sockets for lifecycle tests.
