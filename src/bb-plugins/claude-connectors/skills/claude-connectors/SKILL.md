---
name: claude-connectors
description: Choose which Claude profile's claude.ai connectors (Slack, Snowflake, HubSpot, ...) a BB thread or project uses, and allow write tools.
---

# Claude Connectors

The `claude_connectors_list` and `claude_connectors_call` tools reach one Claude
profile's claude.ai connectors. They work on any provider and account. The
profile resolves in this order: the thread's choice, the project's default,
then the global default.

| Command | Effect |
| --- | --- |
| `bb claude-connectors status` | Show the profile for this thread and where it comes from. |
| `bb claude-connectors use <profile\|off\|inherit>` | Set this thread. Add `--project` to set the project default. |
| `bb claude-connectors default <profile\|off>` | Set the global default. |
| `bb claude-connectors tools <connector>` | List tools with access: `✓` allowed, `·` off. |
| `bb claude-connectors allow <connector> <tool> [--off]` | Allow a write tool, or turn a tool off. |

Read-only tools are allowed by default. Write tools are off until the person
allows them. Do not run `allow` yourself unless the person asks.
A thread that was off gets the tools from its next turn.

The profile must be signed in with a full claude.ai login in Claude Code.
The plugin runs `claude mcp list` in that profile to renew the login. That
command makes no model request.
