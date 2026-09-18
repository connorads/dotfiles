{{marker}}

## Helper handoffs

The bundled helper definitions are not registered agents. For each handoff, read the matching `reference/degraded/` role file and pass its full instructions plus the required input packet to an ordinary subagent: `asset-producer.md`, `finish-reviewer.md`, `documenter.md`, or `manual-edit-applier.md`. Use the runtime's available spawning API and do not select an unregistered agent type. A fresh reviewer receives no conversation history (`fork_turns: "none"` where supported). If subagents are unavailable or prohibited, follow the matching role inline and disclose that substitution. Runtime permission and delegation policies govern every handoff.

## Design approach
