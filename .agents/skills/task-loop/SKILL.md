---
name: task-loop
description: >
  Scaffold a loop directory for automated agent task execution.
  Use when asked to "create a task loop", "set up a loop", "scaffold
  a loop directory", "prepare tasks for rl", or "set up automated
  execution" for a backlog. Takes an existing backlog and generates
  PROMPT.md (loop contract), run-log.md (execution history), and
  .gitignore for ephemeral loop-state.md.
---

# Task Loop

Scaffold a self-contained loop directory from an existing backlog.
The directory contains everything a fresh agent session needs to pick
up a task, execute it, and hand off to the next iteration — with no
session memory between runs.

## When to use

Invoke when the user has a backlog (from `/task-plan`, hand-written, or
any structured task list) and wants to run it through an automated
agent loop. The output is a directory with PROMPT.md, run-log.md, and
a shared .gitignore.

## Process

### 1. Locate the backlog

Accept a backlog file path. If not provided, look for:

- A file the user recently created or discussed
- Files matching `TASKS/*/backlog.md` or `*TASKS*.md`
- Any markdown file with checkbox tasks

Ask if unclear.

### 2. Read and understand the backlog

Read the backlog to understand:

- Task shape (what fields each task has)
- Verification patterns (global rules, per-task criteria, referenced docs)
- Dependencies between tasks
- Any reference material mentioned in the backlog header

This understanding drives how PROMPT.md is adapted.

### 3. Ask about execution context

Ask the user:

- "Are there docs or skills that will help execute these tasks?"
  (e.g. Figma workflow, testing guide, API docs)
- "Any project-specific verification rules beyond what's in the backlog?"
- "What timeout per iteration makes sense?" (helps with the suggested
  run command)

### 4. Generate the loop directory

If the backlog is already in a `TASKS/<name>/` directory, generate
files alongside it. If not, ask where to create the directory or
suggest `TASKS/<name>/` based on the backlog content.

Generate these files:

#### PROMPT.md

The loop contract. Self-contained — the agent reads this one file and
has the complete protocol. Built from the core protocol template
(read [references/loop-protocol.md](references/loop-protocol.md)) plus task-specific adaptations:

- **File paths** — point to this directory's loop-state.md, run-log.md,
  and backlog.md
- **Loop completion token** — emit `__PROMISE_RL_DONE__` as a standalone
  final line when no unchecked tasks remain so the default `rl`
  promise-token handling can stop cleanly. This is the Ralph-loop
  “completion promise” expressed as a plain token.
- **Verification rules** — extracted from the backlog's global and
  per-task verification patterns. Reference external docs if the backlog
  mentions them
- **Dependency handling** — if the backlog has a dependency graph, add
  instructions to respect it when picking the next task
- **Reference docs** — if the user mentioned helpful docs or skills,
  add them to the prompt so the agent knows where to look

The prompt must start with a level-1 heading (markdown linter requirement).

#### run-log.md

Empty file with `# Run Log` header. Entries are appended by the agent
during execution — one entry per completed or blocked task.

Entry format:

```markdown
## <ISO-timestamp> | <task-id> | <done|blocked>
- **Commit:** <sha>
- **Verification:** <what was run>
- **Surprises:** <anything unexpected, or "none">
```

#### TASKS/.gitignore

If a `TASKS/.gitignore` doesn't already exist in the parent directory,
create one containing `loop-state.md`. This keeps ephemeral state out
of version control while allowing clean deletion of the entire task
directory.

### 5. Present the output

Show the user:

- The generated directory structure
- The PROMPT.md content (or a summary if long)
- How to run it, e.g.:
  `rl <n> -t 30m -- claude -p "Read and follow TASKS/<name>/PROMPT.md"`

## PROMPT.md anatomy

Every generated PROMPT.md has these sections:

1. **Heading** — `# Prompt`
2. **Preamble** — "You are running in an automated loop. Read these
   files before doing anything else:" followed by the three file paths
3. **Protocol** — the state machine:
   - No state file or status `done` → append run-log entry, pick next task
   - No unchecked tasks remain → emit `__PROMISE_RL_DONE__` and exit
   - Status `in_progress` or `verifying` → resume from checklist
   - Status `blocked` → log blocker, skip to next task
4. **Verification** — rules adapted from the backlog, referencing
   external docs where appropriate
5. **Completion rule** — the four conditions that must all be true
   before marking a task done
6. **Surprises** — instructions to capture unexpected findings

Read [references/loop-protocol.md](references/loop-protocol.md) for the core template.
Adapt it — don't copy it verbatim. Each backlog has different
verification needs and reference material.

## loop-state.md

Created at runtime by the agent, not pre-created by this skill.
The agent creates it when claiming a task. Format:

```markdown
---
current_task: <task-id>
status: in_progress | verifying | done | blocked
last_commit: ""
next_task: <task-id>
blockers: ""
---

## Checklist

- [ ] Code changes made
- [ ] Verification passed
- [ ] Backlog checkbox updated
- [ ] Commit created

## Surprises

- (none yet)
```

Gitignored via `TASKS/.gitignore` — changes every iteration, noisy in
version control. Clean deletion of the task directory removes it too.
