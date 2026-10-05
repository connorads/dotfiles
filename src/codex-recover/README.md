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
and the installed daemon schema. The proxy never starts or restarts the daemon.

## Development

```sh
uv run --group dev pytest -c pyproject.toml
pyrefly check -c pyrefly.toml
```

Python 3.12+ and standard-library-only runtime dependencies. Pytest disables
network sockets and permits private Unix sockets for lifecycle tests.
