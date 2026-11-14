---
name: bb-coordinator
description: >-
  Runs a BB thread as the coordinator for a workstream: delegates tasks to
  child threads, keeps coordination state in a file, and escalates only real
  decisions. Use when asked to be or act as the coordinator, to run several
  tasks in parallel through BB threads, to take over or replace a coordinator
  or parent thread, or to supervise worker threads while the user is away.
  Not for a single task the current thread can do itself.
---

# BB coordinator

> **Could a fresh coordinator carry on from the state file alone, and does
> each wake-up need a model turn?**

A coordinator dies of its own context: past a few hundred messages it gets slow
and confused, and anything that lived only in the chat dies with it. Every rule
below either moves state out of the chat or stops wake-ups that carry no news.

## State lives in `.coordinator/<workstream>.md`

Keep it at `.coordinator/<workstream>.md` in the coordinator's workspace root,
with a short slug for the workstream (`bb-plugins-maintenance`). Several
coordinators can share one workspace, so the slug keeps their state apart.
Create it before spawning anything, and update it in the same turn as any change it
records. Start every turn after a wake-up by reading it, not by scrolling the
thread.

Keep it out of Git without touching tracked files:

```sh
git check-ignore -q .coordinator/ \
  || echo .coordinator/ >> "$(git rev-parse --git-common-dir)/info/exclude"
```

Outside a Git repo, `git check-ignore` exits 128 and the append fails; skip it
there. (Under `~`, the dotfiles `.gitignore` already ignores new paths.)

Template:

```markdown
# <workstream> - coordinator state
Coordinator: <thread id>   Project: <project id>

## Workers
| Thread | Task | Owns (paths) | Status | Last report |
|---|---|---|---|---|

## Decided by default (user may override)
- <date> <decision> - why it is reversible

## Open calls for the user
- <question> - options, my recommendation, what waits on it

## Next
- <what happens after the current workers report>
```

## Spawn workers that report once

Under the default `auto` notifications, every finished worker turn wakes the
coordinator for a full turn. Use `stuck`: completed turns stay silent, while
failures, interruptions and approval or question blockers still wake you.

```sh
bb thread spawn --project <id> --parent-self --parent-notifications stuck \
  --title "<task>" --prompt-file - <<'EOF'
...brief...
EOF
```

Under `stuck` a worker's final reply reaches nobody, so it has to send its
report itself. End every worker brief with this contract:

> When done, or when you need a decision, send exactly one message to the
> coordinator: `bb thread tell <coordinator id> --mode queue --message-file -`.
> Include: outcome; files changed; each check run, marked passed, failed or
> skipped; decisions you took; questions, each with your recommendation.
> Never ask a question only in your final reply - it does not wake the
> coordinator.

`--mode queue` stops a report from interrupting a turn the coordinator is
already running.

## Taking over another coordinator

1. Stop the old coordinator with `bb thread stop <old>`, so two coordinators
   never steer the same workers. Do not archive it: archiving also archives
   its children, which are the workers.
2. Read its state file in `.coordinator/`. If it has none, build one from a
   bounded read: `bb thread log <old> --format minimal --limit 20` plus each
   worker's latest log. Do not page the whole history.
3. For each worker: `bb thread update <worker> --parent-thread <me>
   --parent-notifications stuck`.
4. Tell each worker the new report address with `bb thread tell <worker>
   --mode queue`, restating the report contract. Its brief names the old
   coordinator's ID.

## Spend the coordinator's context on judgement

The worker proves its own work and reports the evidence. The coordinator
spot-checks: read the diff and run one targeted check. Hand repeated runs,
full suites and log digging to a child thread; their output fills the
coordinator's context for no decision.

## Decisions

- **Reversible and low-stakes:** pick the default, tell the worker, and add it
  to "Decided by default" so the user can override it.
- **Irreversible, destructive, a security boundary, or a matter of the user's
  taste:** add it to "Open calls" with options and a recommendation. The
  worker carries on with whatever the question does not block.

When the user returns, answer from the state file: the workers table, then open
calls, then anything decided by default since they left.

## Evals

`evals/evals.json` holds the test prompts for this skill.
