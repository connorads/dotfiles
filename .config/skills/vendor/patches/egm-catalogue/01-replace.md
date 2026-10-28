{{marker}}

This is a catalogue skill with its runtime bundled in `references/egm/`.
Resolve all `agents/` and `resources/` paths against that directory, using
absolute paths for delegated reads. Resolve skill-local `references/` paths
against this skill directory. Find companion EGM skills through the installed
skill inventory; read their SKILL.md files in the main context when invoked.
Do not install a plugin or assume registered reviewer types.

Use native fresh-context subagents. Inspect the actual tool schema; set
`fork_turns: "none"` or `fork_context: false` when available. Pass only the
persona, target, standards and selected reading list. Require completed reads
and actual reviewer results. If fresh contexts cannot be established, stop
Goldfish review and report the missing capability. Dispatch reviewers directly
when nesting is unavailable. Host concurrency limits always apply.

Use structured questions only when available and permitted in the current mode;
otherwise ask in chat and wait. Follow explicit user delegation and preferences
over workflow defaults. Keep reports in the working directory, or resolve an
`EGM artifact directory: <path>` instruction against it. Link deliverables with
absolute Markdown paths. Bundled personas describe read-only reviewers;
these instructions do not enforce tool or filesystem restrictions.

Upstream harness notes are reference documentation at
https://github.com/google/elephant-goldfish-model/blob/main/docs/harnesses.md.
