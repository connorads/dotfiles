# Workflow agents inherit active tools

Status: accepted

Workflow agents inherit the parent Pi session's active tools captured at launch or resume, with the `workflow` tool excluded. This matches Claude's configured-tool-allowlist model more closely than enabling every registered Pi tool, keeps custom web tools portable by name, and avoids a separate workflow-only profile system that would be harder to understand and easier to drift from the user's actual Pi session.

## Considered Options

- **Inherit active tools minus `workflow` (chosen)** - respects the user's Pi tool configuration and prevents recursive workflow launches.
- **Enable all registered tools minus `workflow`** - convenient but surprising, because disabled or sensitive extension tools become available to subagents.
- **Workflow tool profiles** - flexible but adds configuration and UX weight before there is evidence that per-workflow profiles are needed.
- **Coding-only tools** - stable but makes research/code agents worse when the parent session already has web or MCP tools available.
