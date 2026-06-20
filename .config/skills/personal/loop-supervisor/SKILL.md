---
name: loop-supervisor
description: >
  Scaffold a SUPERVISOR.md runbook for watching a long-running agent
  loop in tmux. Use when asked to "supervise a loop", "watch a loop",
  "babysit a loop", "set up a supervisor", or when a task-loop / rl
  run needs someone operating the harness around it.
---

# Loop Supervisor

Scaffold a `SUPERVISOR.md` runbook that captures *how to supervise* a
specific agent loop. A fresh agent session (or a future you) reads
that file, launches or attaches to the loop in tmux, watches state
files, and intervenes sparingly per a project-specific taxonomy.

The supervisor's golden rule is always the same shape: **operate the
harness, don't do the inner loop's work.** What counts as "harness"
vs "inner work" is project-specific — that's what discovery pins down.

## When to use

Invoke when the user has (or is about to have):

- A task-loop / ralph-loop / rl-style outer runner driving fresh agent
  sessions against a `PROMPT.md` or equivalent contract
- State artefacts like `run-log.md`, `loop-state.md`, `backlog.md`, or
  a domain-specific index (hypothesis tree, frontier state, etc.)
- A tmux session (or intent to launch one) where the loop runs

The output is a single file: `TASKS/<name>/SUPERVISOR.md`, co-located
with the loop's other artefacts. Git-tracked — it's a contract that
evolves with the project between runs, not ephemeral state.

## What SUPERVISOR.md contains

Eight sections. Self-contained for taxonomy + golden rule so the file
stands alone; references-based for mechanics (trusts the consumer has
the `tmux` skill loaded rather than inlining `capture-pane` syntax).

Use [references/runbook-template.md](references/runbook-template.md)
as the skeleton when generating the file.

1. **Role + golden rule** — one line setting the frame.
2. **Mission + stop conditions** — what success looks like, what
   exhaustion looks like, when to stop.
3. **State files to watch** — paths the supervisor reads each cycle.
4. **Intervention taxonomy** — project-specific triggers + responses.
5. **Out-of-scope / don't-touch** — the inner loop's domain.
6. **Budgets** — max interventions, poll cadence.
7. **Escalation** — Ctrl-C the loop pane, explain in the final message.
   No dedicated escalation file; the supervisor's last chat turn is the
   report.
8. **Launch** — tmux session name + launch command. Consumer runs
   `tmux has-session -t <name>` first; launches if absent, attaches
   if present (safety against double-start).

## Process

### 1. Locate the loop

Find the loop this supervisor will watch:

- Glob `TASKS/*/` for `PROMPT.md` + `run-log.md` pairs (task-loop shape)
- If multiple loops exist, ask which one
- If none, ask whether to scaffold one first via `/task-loop` — don't
  try to supervise a loop that doesn't exist yet

### 2. Auto-infer silently

Before asking any questions, read what's already on disk:

- **Tmux session name** — `tmux ls` to see if a session is running
  that matches the loop's directory name; if none, derive one from
  `TASKS/<name>/` (e.g. `<name>-loop`)
- **State file paths** — anything in `TASKS/<name>/` that looks like
  state: `run-log.md`, `loop-state.md`, `backlog.md`, plus any
  `INDEX.md`, `frontier-state.*`, or similar domain-specific indices
- **Stop token** — whatever the loop's own contract declares as its
  completion signal. Grep `PROMPT.md` / `README.md` / project docs
  for file-existence markers (e.g. `FOUND_SECRET.txt`) and emit tokens
  (e.g. `__PROMISE_RL_DONE__` if the loop is task-loop / rl-shaped).
  Inherit what the loop already says rather than imposing a default.
- **Launch command** — if the loop ships a run command in its README
  or `PROMPT.md`, use it verbatim. For task-loop / rl-shaped loops
  this typically looks like `rl <N> -- cxys '<PROMPT.md path>'`.
  Iteration count defaults to 100 unless specified or mentioned.
- **Existing contract / preconditions** — read the loop's `PROMPT.md`
  (or equivalent) end-to-end. Absorb its declared preconditions
  (e.g. "build must be green before committing"), its own stop
  conditions, its scope boundaries. The supervisor should inherit
  these organically — they're not separate rules, they're
  already in the loop's contract.
- **Context priors** — read `AGENTS.md` / `CLAUDE.md` / project README
  for terminology, conventions, existing supervision patterns.

Don't bother the user with any of this if it can be inferred.

### 3. Interview (grill-me style, one question per turn)

Ask only what needs human judgement. Aim for ~5 focused questions.
Surface the catalogues from `references/` as menus — the user picks
from worked examples rather than generating from scratch.

**Q1 — Golden rule (one line).** What's the inner loop's domain, and
what's the supervisor's domain? Frame with a motivating example:
hackmonty's was "operate the harness, don't do the research"; for a
source-port project it might be "keep lanes balanced and worktrees
clean". Read [references/golden-rule-examples.md](references/golden-rule-examples.md)
for seed material.

**Q2 — Top 3–5 project-specific triggers.** Offer the catalogue from
[references/trigger-examples.md](references/trigger-examples.md) and
ask which apply, plus any bespoke ones. Each trigger is a pair:
*detection signal* (what you'd see in state files) + *response*
(what the supervisor does).

**Q3 — Authority stance.** Pick from
[references/authority-stances.md](references/authority-stances.md):
*escalate-only* (read + Ctrl-C + report), *harness-only* (edit loop
contract, commit infra fixes, mark indices — never touch loop-domain
artefacts), or *autonomous* (may commit anything, highest risk).
Different projects justifiably want different stances.

**Q4 — Intervention budget.** Default 3 before hard stop. Lower for
tight supervisors, higher for long runs where more drift is expected.

**Q5 — Out-of-scope paths.** What the supervisor must never touch.
For harness-only: probe code, task implementations, hypothesis bodies.
For autonomous: still worth listing anything sacred (secrets,
migrations, production configs).

Skip any question the auto-inference in step 2 already answered.

### 4. Write SUPERVISOR.md

Fill in [references/runbook-template.md](references/runbook-template.md)
with the interview results and inferred values. Write to
`TASKS/<name>/SUPERVISOR.md`.

The consumer (a future agent session, potentially you, potentially a
human) reads this file top-to-bottom. Make it self-contained enough
that a fresh agent with just the `tmux` skill loaded can execute it.

### 5. Present and hand off

Tell the user:

- Where the file was written
- Which triggers + authority stance got captured
- How to start supervising: open a fresh agent session (or tell the
  current one) to "read `TASKS/<name>/SUPERVISOR.md` and follow it."
  The runbook handles the rest — checks for the tmux session,
  launches if absent, attaches if present, begins supervision.

If the user wants to run it right now in the current session, just
read the runbook back in and execute it. Otherwise hand off.

## Composition

- **`tmux` skill** — the consumer loads this for session management.
  SUPERVISOR.md never inlines `capture-pane` / `send-keys` — it
  describes *what* to watch, not *how* to read a pane.
- **`task-loop` skill** — scaffolds the loop SUPERVISOR.md watches.
  If no loop exists yet, suggest `/task-loop` first.
- **`task-plan` skill** — produces the backlog that task-loop consumes.
  Upstream of this skill by two steps.
- **`grill-me` skill** — the interview flow in step 3 follows its
  one-question-per-turn discipline.

## What this skill does not do

- **No runtime execution.** This skill only scaffolds the runbook.
  Starting the loop + watching it happens when a consumer reads
  SUPERVISOR.md — not here.
- **No runtime scripts bundled.** Pure prompt + reference material.
  The consumer uses its own tool access (tmux, filesystem, git).
- **No live-update of SUPERVISOR.md mid-run.** The supervisor treats
  it as read-only during a run. New failure classes surface in the
  supervisor's final message; the human folds them in before the next
  run. Keeps the contract stable within a run.
- **No generic shipped taxonomy.** Everything in the generated
  SUPERVISOR.md is project-specific. The `references/` directory holds
  examples to pick from, not defaults to inherit.
