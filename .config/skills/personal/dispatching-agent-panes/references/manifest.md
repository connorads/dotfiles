# Dispatch Manifest

The manifest is the approved launch contract and the resumable state for later
waves. The launcher updates it atomically after each assignment.

## Shape

```json
{
  "run_id": "wedding-audit",
  "source_cwd": "/absolute/path/to/repository",
  "base_sha": "0123456789abcdef0123456789abcdef01234567",
  "max_concurrency": 6,
  "assignments": [
    {
      "id": "migration-safety",
      "title": "Prevent destructive migrations",
      "provider": "codex",
      "mode": "plan",
      "permission": "normal",
      "dependencies": [],
      "prompt": "Read the supplied handoff and produce a plan...",
      "window_name": "audit-migration",
      "agent_name": "audit_migration",
      "state": "pending"
    }
  ]
}
```

## Fields

- `run_id` identifies the temporary run and generated implementation branches.
- `source_cwd` is the absolute checkout from which the run was approved.
- `base_sha` pins one 40-character commit for drift checks and worktrees.
- `max_concurrency` is an integer from 1 to 6.
- `provider` is `claude` or `codex`.
- `mode` is `plan` or `implement`.
- `permission` is `normal` or `bypass`; bypass must be explicit in the approved
  table.
- `dependencies` contains assignment IDs from this manifest.
- `agent_name` matches `[a-z][a-z0-9_-]{0,31}` and is globally unique among
  live agents.

Window names and agent names are unique within the manifest. The launcher
refuses collisions with the target tmux session or live agent roster.

## Lifecycle

```text
pending -> launched -> complete
       \-> failed -> launched
```

- `pending` has not started.
- `launched` has a verified submitted prompt and a stable post-start agent name;
  it still occupies concurrency.
- `complete` means `agent state` reported `done` or `idle` when a later launch
  was requested.
- `failed` records `error` and, when created, `pane_id`.

The launcher also records `cwd`, `pane_id`, `agent_named`, and implementation
`branch`/`worktree` fields. Dependencies require `complete`, not merely
`launched`. A later `launch` refreshes completion once; it does not monitor.

## Prompt contract

Each stored prompt is self-contained because child sessions do not inherit the
dispatcher's conversation. Include:

1. Source paths or URLs and the task IDs assigned.
2. The observable outcome and current evidence.
3. Explicit in-scope and out-of-scope boundaries.
4. Global and task-specific skills or process instructions.
5. Expected deliverable, verification, and whether committing is authorised.

Do not tell an implementation agent to choose an unresolved product or
compatibility decision. Dispatch that question as a planning assignment first.
