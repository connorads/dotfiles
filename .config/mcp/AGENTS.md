# AGENTS.md — mcpz + the MCP registry

`mcpz` picks which MCP toolset is live per agent launch and renders it into each
agent's native launch form, resolving secrets fresh at launch. It is MCP-only:
it does not select accounts/profiles, it inherits ambient env (e.g.
`CLAUDE_CONFIG_DIR` set by `ccp`).

Account + bundle are picked together via [`ccp --mcp <bundle>`](#account-aware-launch-ccp---mcp)
(the engine) and the tmux `prefix + Alt+c` launcher.

CLI: [`~/.config/zsh/functions/agents/mcpz`](../zsh/functions/agents/mcpz)
(dual-mode, on PATH as `mcpz`). Tests:
[`~/.config/zsh/tests/mcpz.bats`](../zsh/tests/mcpz.bats).

## Leak-safety invariant

The registry is the ONLY place client names/URLs live, and it is gitignored.

- `registry.local.json` (and any `*.local.json` under `~/.config/`) is ignored
  by the `/.config/**` rule in `~/.gitignore`. Only
  [`registry.example.json`](./registry.example.json) (fake bundle) and this doc
  are un-ignored and tracked.
- Secrets are never persisted and never in argv — the registry stores only a
  secret NAME and a producer that resolves it. At `run`, the value is resolved
  into the process env; renderers emit only env-var *references*
  (`${VAR}` / `bearer_token_env_var` / `{env:VAR}`).
- Isolation is strict only for Claude (`--strict-mcp-config`). Codex and
  OpenCode merge additively onto their base/global config, so the invariant is:
  client servers live only in `mcpz` bundles, never in an agent's base/global
  config. `mcpz doctor` (follow-up) asserts this.
- argv exposure: Claude's inline JSON and Codex's `-c` args put URLs and
  server names in `ps` (same-user only, no secret, no git leak) — accepted.
  OpenCode reads a runtime file instead of argv.

## Registry (`$MCPZ_REGISTRY`, default `~/.config/mcp/registry.local.json`)

Strict JSON (parsed by `jq`). To start: copy the example and edit.

```bash
cp ~/.config/mcp/registry.example.json ~/.config/mcp/registry.local.json
```

Schema v1 — `stdio` + `http` transports, `headers`, `bearer` sugar, `env`, and
named `secrets`:

```json
{
  "version": 1,
  "bundles": {
    "<bundle>": {
      "servers": {
        "<server>": {
          "transport": "http",
          "url": "http://localhost:4789/mcp/toolkits/<name>",
          "headers": { "X-Env": "prod" },
          "bearer": { "secret": "EXECUTOR_TOKEN" },
          "secrets": {
            "EXECUTOR_TOKEN": { "cmd": "jq -r .connection.auth.token ~/.executor/server-control/server.json" }
          }
        }
      }
    }
  }
}
```

- Any value (`url`, a header, an `env` entry, `bearer`) is a literal string OR
  `{ "secret": "NAME" }` referencing a `secrets` producer.
- Producers: `cmd` (shell, output = value) · `env` (var name) · `file` (path,
  contents = value) · `literal`. The env-var injected at launch is the secret
  NAME.
- `bearer` is sugar → `Authorization: Bearer <ref>` for Claude/OpenCode
  headers, `bearer_token_env_var` for Codex.
- stdio: `command` (string or array) + `args` + `env`.
- Superset fields (sse, tool filters, timeouts, `enabled`) are reserved for
  later renderers; v1 renderers ignore them.

The concrete trigger is Executor.app's local MCP gateway, whose bearer token
(`~/.executor/server-control/server.json`) rotates on daemon restart — so a
`cmd` producer that reads it fresh each launch is the whole point. Executor is
just one `cmd` resolver, not a special case.

## Commands

```bash
mcpz list [--json]                 # bundle names
mcpz show <bundle>                 # servers in a bundle, secrets redacted
mcpz render <agent> <bundle>       # exact launch form, secrets as ${VAR} refs (pure, not resolved)
mcpz run <agent> <bundle> [-- ...] # resolve secrets → env → exec agent (extra args after --)
mcpz                               # bare on a TTY: fzf-pick bundle + agent, then run
mcpz doctor                        # leak guard (follow-up; stub today)
```

`agent` ∈ `claude|cc`, `codex`, `opencode|oc`. `render` is the primary test
target (pure over the registry); `run` and the picker are smoke-only.

## How each agent is launched (validated live)

- **Claude Code**: `claude --mcp-config '<inline json>' --strict-mcp-config "$@"`.
  Inline JSON, no file. `--mcp-config` is greedy-variadic, so
  `--strict-mcp-config` must immediately follow the JSON to terminate it before
  user args. `${VAR}` in `headers`/`url`/`env` is expanded from the process env
  at launch (proven: bogus token → HTTP 401, mcpz-resolved token → HTTP 200).
- **Codex**: `codex -c 'mcp_servers.<n>.url="…"' -c 'mcp_servers.<n>.bearer_token_env_var="VAR"' "$@"`.
  Inline `-c` TOML values layered onto the base config; no strict mode. `-c` is
  a universal layer, so `codex mcp list` reflects it.
- **OpenCode**: one ephemeral config file (env-ref only, no secret at rest)
  under `${XDG_RUNTIME_DIR:-$TMPDIR}/mcpz/`, launched with
  `OPENCODE_CONFIG=<file> OPENCODE_DISABLE_PROJECT_CONFIG=1`. Merges onto
  global. `{env:VAR}` header syntax, `command` as array, `environment` (not
  `env`). Inline `OPENCODE_CONFIG_CONTENT` does not take effect — use a file.

`mcp list` reflects the launch config only for Codex; for Claude/OpenCode it
reads persisted config, so verify connection with a live session (Claude
`-d --debug-file <log>` connection logs are the reliable signal).

## Account-aware launch (`ccp --mcp`)

Each client engagement lives in its own `ccp` Claude profile, so picking a
client means picking **account + bundle together**. `mcpz` stays MCP-only; `ccp`
owns account isolation and delegates the MCP wiring to `mcpz`.

- `ccp [<acct>] --mcp <bundle>` ([`~/.config/zsh/functions/ccp`](../zsh/functions/ccp)):
  `--mcp` is accepted before or after the account name. `ccp` keeps owning
  isolation (`CLAUDE_CONFIG_DIR`, auth-scrub, materialise, `claude-launch-flags`)
  and runs `mcpz run claude <bundle> -- <inject> <args>` for the terminal exec.
  For a named account this happens inside `claude-code-profile`'s scrubbed,
  relocated `env`, so `mcpz` resolves secrets there and execs claude with the
  scrub + `CLAUDE_CONFIG_DIR` + secret vars inherited. `--strict-mcp-config`
  keeps the inline bundle authoritative, and `claude-profile-materialise` never
  writes MCP config, so there is zero conflict. An unknown bundle makes `mcpz`
  exit `2` and `ccp` propagates it.
- tmux `prefix + Alt+c` ([`~/.config/tmux/scripts/mcp-launch.sh`](../tmux/scripts/mcp-launch.sh)):
  pick account → pick bundle → launch claude in a **new window** via
  `ccp <acct> --mcp <bundle>`. A fresh window can't inherit the origin pane's
  `CLAUDE_CONFIG_DIR`, so the account is chosen explicitly - isolation intact.
- Scope: the flow is claude-account-aware. codex/opencode have no ccp-style
  profiles - the bare `mcpz` picker (bundle → agent → run) launches them from
  any shell. A multi-agent tmux launcher is an easy extension, not built.

## Verify changes

```bash
bats ~/.config/zsh/tests/mcpz.bats          # list/show/render, all 3 renderers, error paths
mcpz render claude <bundle> | sed -n 2p | jq .   # eyeball the generated config
```

## Follow-ups (not v1)

Renderers for the other MCP-capable tools (schema already covers them); a real
`mcpz doctor`; tool-filter and timeout fields; a documented Codex `-p <bundle>`
file fallback if `-c` quoting ever proves too brittle for stdio arrays/tables.
