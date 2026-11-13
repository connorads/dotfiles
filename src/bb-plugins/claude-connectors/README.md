# Claude Connectors

Use a Claude profile's claude.ai connectors (Slack, Snowflake, HubSpot, ...) from any
BB thread, whichever account or agent runs it. Pick the profile per thread or per
project, or turn it off.

## Use

1. Sign in to Claude Code in the profile, for example `~/.claude-profiles/code/<name>`.
2. Set a default: `bb claude-connectors default work`, or per project with
   `bb claude-connectors use work --project`, or per thread with
   `bb claude-connectors use work`.
3. Ask the agent to use Slack. It calls `claude_connectors_list` and then
   `claude_connectors_call`.
4. Allow a write tool when you want it: `bb claude-connectors allow Slack slack_send_message`.

## Model

```mermaid
flowchart LR
  Thread[BB thread, any agent] --> Plugin[claude-connectors]
  Plugin -->|token from the profile's Keychain item| Proxy[Anthropic MCP proxy]
  Plugin -.->|claude mcp list renews the login| Claude[Claude Code binary]
  Proxy --> Connectors[Slack, Snowflake, ...]
```

- The profile resolves from the thread's choice, then the project default, then the
  global default. Choices live in plugin storage.
- The token stays on this Mac. The plugin reads Claude Code's Keychain item and never
  refreshes the token itself. When it nears expiry, the plugin runs `claude mcp list`
  in that profile so Claude Code renews it.
- Read-only tools (MCP `readOnlyHint`) are allowed by default; others stay off until
  allowed. A 401 renews the login and retries once; other failures are never retried.
- The connector list and the MCP proxy are undocumented Anthropic endpoints. They can
  change without notice. Anthropic's credential policy covers OAuth use outside Claude
  Code, so keep this personal and local.

## Claude Code artefacts

The `Claude Code Artifacts` connector exposes the available native artefact tools
through the selected profile's `claude mcp serve`. These can include `Artifact`,
`ArtifactComments` and `ArtifactData`. Some native configurations combine them in `Artifact`.
Claude Code handles authentication and account policy. No model request is made.

```sh
bb claude-connectors tools "Claude Code Artifacts"
bb claude-connectors allow "Claude Code Artifacts" Artifact
```

Each tool combines read and write actions, so each starts off.
Allow only the tools you need. The agent must confirm content before writes.
Use `claude_connectors_list` with this connector to read the native input schemas.
Publish inputs use absolute local file paths. Files must exist on the BB server's machine.

```mermaid
flowchart LR
  Agent[BB agent] --> Policy[Connector access controls]
  Policy --> Native[Claude Code MCP server]
  Native --> Profile[Selected profile]
```

Each request starts and closes its own native process. Background watches and
comment notifications do not persist between calls. Calls time out after two minutes.
The adapter allows only these artefact tool names, even when the native server lists other tools.

The adapter uses the undocumented `CLAUDE_CODE_ARTIFACT=1` switch.
Claude Code settings and account restrictions still apply. Native tool names
and schemas depend on the installed Claude Code version.
