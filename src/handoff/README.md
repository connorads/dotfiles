# handoff

`handoff` translates interactive session history between Codex and Claude Code.

> **Tested compatibility (2026-07-20):** Codex CLI `0.144.6` and Claude Code
> `2.1.215`, in both directions. If either installed CLI is newer, its private session
> format is not yet verified against this version of `handoff`.

The default workflow is direct native-to-native conversion by session id:

```bash
handoff --from claude --to codex <SESSION_ID>
handoff --from codex --to claude <SESSION_ID>
```

By default, `handoff`:

- resolves the source session id from the local Claude or Codex store
- creates a fresh target session id automatically
- writes the translated session into the target tool's storage
- immediately opens the translated session in the target agent

If you only want the translation and do not want to start the target agent yet:

```bash
handoff --from claude --to codex <SESSION_ID> --no-open
handoff --from codex --to claude <SESSION_ID> --no-open
```

## Session lookup

For Codex and Claude inputs, `handoff` accepts either a native session id or a
direct session file path. By default it searches:

- Codex: `HANDOFF_CODEX_HOME`, then `CODEX_HOME`, then `~/.codex`
- Claude: `HANDOFF_CLAUDE_HOME`, then `CLAUDE_CONFIG_DIR`, then `CLAUDE_HOME`, then `~/.claude`

So you can usually use the same id you would pass to `codex resume` or `claude -r`.

## Opening the target with extra flags

`handoff` opens the target agent with a bare `claude -r <id>` / `codex resume <id>`.
Two environment variables append flags to that launch:

- `HANDOFF_CLAUDE_OPEN_ARGS`
- `HANDOFF_CODEX_OPEN_ARGS`

```bash
HANDOFF_CLAUDE_OPEN_ARGS='--dangerously-skip-permissions' \
  handoff --from codex --to claude <SESSION_ID>
# runs: claude --dangerously-skip-permissions -r <NEW_ID>
```

Rules:

- Only the **target** tool's variable is read; the other is ignored.
- The flags go **before** the resume token, because `codex` takes root-level args
  ahead of its `resume` subcommand.
- The value is split POSIX-style with **no shell**: a quoted path containing spaces
  stays one token, and `$HOME` is *not* expanded (write the path out in full).
- The tokens are forwarded verbatim. `handoff` never invents or rewrites a flag, so
  the caller decides what authority the opened session gets. An unbalanced quote is
  a normal `handoff` error.
- The printed `resume with:` hint shows the same argv that is launched.

## Advanced usage

A portable intermediate representation (IR) is available for debugging and advanced
workflows, but it is intentionally not the main interface:

```bash
handoff inspect <SESSION_ID> --from claude
handoff import <SESSION_ID> ./session.json --from codex
handoff export ./session.json ./out/codex-home --to codex --new-session-id
handoff convert <SESSION_ID> ./out/claude-home --from codex --to claude --new-session-id
```

## Development

This project uses [uv](https://docs.astral.sh/uv/). Run the tests with:

```bash
uv run --group dev pytest
```

Design notes and known behavioural caveats live in [PORTING.md](./PORTING.md).
