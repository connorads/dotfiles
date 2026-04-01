---
name: task-plan
description: >
  Decompose input into a structured task backlog for automated agent loops.
  Use when asked to "create a task plan", "break this into tasks",
  "decompose this PRD", "turn this into a backlog", or "plan tasks from"
  any input source (PRD, Figma feedback, GitHub issues, user requirements).
  Also use when the user provides a PRD, design doc, or requirements and
  wants executable tasks, even if they don't mention "task plan" explicitly.
---

# Task Plan

Turn any input source into a structured backlog that an agent can execute
one task at a time in an automated loop. Each task is self-contained,
verifiable, and completable in a single iteration.

## When to use

Invoke when the user has an input source (PRD, design feedback, issue list,
requirements doc, or verbal description) and wants it decomposed into
executable tasks. The output is a `backlog.md` file — a flat task list
with dependency graph and priority ordering.

## Process

### 1. Understand the input

Accept input as a file path, URL, pasted text, or verbal description.
If none provided, interview the user:

- What are you trying to build or change?
- What does the end state look like?
- What exists today?
- What constraints matter (timeline, tech stack, compatibility)?

Interview deeply — understand intent, not just surface requirements.
The quality of the backlog depends on understanding the why.

### 2. Explore the codebase

Before decomposing, explore the codebase to understand:

- Existing patterns and conventions
- Architecture and integration layers
- What already exists that tasks can build on
- Testing patterns and verification infrastructure

Tasks that ignore existing code lead to rework. An agent executing a
task should extend the codebase, not fight it.

### 3. Surface durable decisions

Identify decisions that span multiple tasks and are unlikely to change:

- Route structures / URL patterns
- Schema shapes and data models
- Key architectural boundaries
- Third-party service interfaces
- Shared component patterns

These go in a `## Decisions` section at the top of the backlog so every
task can reference them without repeating context.

### 4. Ask about reference material

Ask the user: "Are there docs, skills, or reference material that will
help an agent execute these tasks?"

Examples:

- A Figma workflow doc for design tasks
- API documentation for integration tasks
- A testing guide for the project
- An existing skill relevant to the tech stack

These go in the backlog's reference table so the executing agent knows
where to look.

### 5. Decompose into vertical slices

Break the input into tasks. Each task is a thin vertical slice through
all relevant layers (model, logic, API, UI, tests), not a horizontal
layer.

Apply these heuristics — read [references/task-quality.md](references/task-quality.md) for details:

**The one-iteration test:** Can a fresh agent session complete this task
in one loop iteration (~30 min)? If not, split it.

**The one-commit test:** Does this task produce exactly one coherent
commit? If it would need multiple commits, split. If it's too small to
commit alone, merge with a sibling.

**The cold-start test:** Does the task contain enough context (file paths,
current state, what to change, how to verify) that an agent with no
session memory can execute it? If not, add more detail.

**The revert test:** Could this commit be reverted cleanly, removing
exactly one meaningful thing? If reverting would orphan code or break
something unrelated, the task isn't self-contained.

### 6. Structure each task

Each task needs all of these fields:

- **ID** — short prefix + number (e.g. AU-1, DB-3). Prefix groups
  related tasks (CC = cross-cutting, AU = auth, UI = interface, etc.)
- **Title** — what changes, not how
- **Size** — XS (< 10 min), S (10-20 min), M (20-40 min), L (40+ min).
  If L, strongly consider splitting
- **Deps** — task IDs this depends on, or "none"
- **Problem** — what's wrong or missing (the why)
- **What to do** — concrete steps with file paths and current state
- **Acceptance criteria** — observable outcomes, not implementation details
- **Verification** — exact commands to run and what to check. Can
  reference global verification rules or be task-specific
- **Files** — paths that will be touched

Read [references/backlog-format.md](references/backlog-format.md) for the full template.

### 7. Add dependency graph and priority order

Draw the dependency graph as a text diagram showing which tasks unblock
others. Group tasks into phases where tasks within a phase can be
executed in parallel (no mutual dependencies).

Priority order should generally be:

1. Cross-cutting / foundation tasks (unblock many others)
2. Quick wins (XS tasks, batch together)
3. Feature phases (grouped by domain area)
4. Polish and documentation

### 8. Quiz the user

Present the proposed breakdown as a summary. Ask:

- Does the granularity feel right? (too coarse / too fine)
- Should any tasks be merged or split?
- Are the dependencies correct?
- Is the priority order right?
- Anything missing?

Iterate until approved, then write the file.

### 9. Write the backlog

Write to the path specified by the user (default: `TASKS/<name>/backlog.md`).
Create the directory if needed.

If the user plans to use `/task-loop` next, mention that the backlog is
ready for loop scaffolding.
