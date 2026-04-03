# Loop Protocol Template

Core protocol for PROMPT.md generation. Adapt this template to the
specific backlog — don't copy verbatim. Each backlog has different
verification needs, reference material, and dependency structures.

## Template

```markdown
# Prompt

You are running in an automated loop. Read these files before doing anything else:

1. `TASKS/<name>/loop-state.md` — current task and progress
2. `TASKS/<name>/run-log.md` — what previous iterations completed
3. `TASKS/<name>/backlog.md` — the full task list

## Protocol

**If loop-state.md doesn't exist or status is `done`:**

- Append a run-log entry for the completed task (if any)
- If no unchecked `[ ]` tasks remain in backlog.md, print `__PROMISE_RL_DONE__`
  on its own final line and exit
- Pick the next unchecked `[ ]` task from backlog.md
- Create/update loop-state.md with `status: in_progress`

**If status is `in_progress` or `verifying`:**

- Resume from the checklist — don't restart the task

**If status is `blocked`:**

- Append to run-log.md with the blocker
- Move to `next_task`, update loop-state.md

## Verification

<Adapt this section based on the backlog's verification patterns.
Include global rules and reference external docs where appropriate.>

## Completion rule

Only set `status: done` when ALL are true:

- Code changes committed
- Verification passed (per rules above)
- Backlog checkbox updated to `[x]`
- loop-state.md updated with commit SHA

## Surprises

Record in loop-state.md. If durable, update code comments or docs.
```

Run the outer loop with `rl -- ...` so the default promise-token
handling stops the shell runner once the backlog is exhausted. In
Ralph-loop terms this token is the completion promise. Use
`--promise-token` to override the token or `--no-promise-token` to
disable this behaviour for a specific run.

## Adaptation Points

When generating PROMPT.md from this template, adapt these sections:

### File paths

Replace `<name>` with the actual directory name.

### Protocol — dependency handling

If the backlog has a dependency graph, add to the "pick next task" step:

```markdown
- If no unchecked `[ ]` tasks remain after applying the dependency rules,
  print `__PROMISE_RL_DONE__` on its own final line and exit
- Pick the next unchecked `[ ]` task from backlog.md, respecting the
  dependency graph — skip tasks whose dependencies aren't complete
```

### Verification

Extract verification rules from the backlog. Sources:

1. **Global "How to Use" section** — if the backlog has a global
   verification workflow, summarise it here
2. **Per-task verification** — if tasks have different verification
   needs, add a "minimum per change type" table
3. **Referenced docs** — if the backlog references external docs
   (e.g. `docs/figma-workflow.md`), add them here

Example adaptation for a Figma-based backlog:

```markdown
## Verification

Follow `docs/figma-workflow.md` for visual validation (steps 3-5).

Minimum per change type:

- Seed/content: `pnpm test` + `pnpm typecheck` + visual check
- Block schema: `pnpm generate:types` + `pnpm test` + `pnpm typecheck`
- Component/layout: `pnpm test` + `pnpm typecheck` + Storybook screenshots at 1440px and 375px
```

Example adaptation for a PRD-based backlog:

```markdown
## Verification

Run the project's test suite after every change. Minimum per task type:

- Schema/model changes: generate types + run tests + run migrations
- API changes: run tests + verify endpoint manually
- UI changes: run tests + screenshot at key breakpoints
- Config changes: run build to verify no errors
```

### Reference material

If the user mentioned helpful docs or skills, add a section:

```markdown
## Reference

These docs and skills are relevant to executing tasks in this backlog:

- `docs/figma-workflow.md` — visual validation workflow
- `docs/testing.md` — test architecture and patterns
```
