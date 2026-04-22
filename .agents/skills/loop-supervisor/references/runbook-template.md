# Runbook Template

Skeleton for `TASKS/<name>/SUPERVISOR.md`. Fill in the bracketed bits
from the discovery interview + auto-inferred values. Leave the overall
section order unchanged — the consumer reads this file top-to-bottom
and the order matters (launch before watch, watch before intervene).

## Template

```markdown
# Supervisor — <project / loop name>

You are the supervisor for an autonomous loop running in this repo.
You have the `tmux` skill loaded and can read the filesystem + run git.
Follow this runbook in order.

## 1. Role + golden rule

<One-line role definition. Load-bearing.>

Example: "Operate the harness around the <name> research loop. Fixing
a broken runner or freeing a stuck hypothesis is your job. Writing
probes, forming hypotheses, interpreting results is the inner loop's
job."

## 2. Mission + stop conditions

**Mission:** <what the loop is trying to achieve, one or two sentences>

**Stop immediately on any of:**

- <success condition — e.g. `FOUND_SECRET.txt` exists at repo root>
- <exhaustion condition — e.g. all items in `backlog.md` checked, or
  all hypotheses in terminal state in `INDEX.md`>
- <budget condition — e.g. `rl 100` complete, intervention budget
  (3) spent, or wall-clock cap (12h) reached>
- <hard-failure condition — e.g. novel failure class, runner fix
  didn't hold, anything outside the taxonomy below>

On stop: send Ctrl-C to the tmux pane (see §8), wait for the current
iteration to finish cleanly, then summarise what happened in your
final message. No dedicated escalation file.

## 3. State files to watch

Read these each supervision cycle:

- `<path to run-log.md>` — append-only execution history; tail the
  last N entries
- `<path to loop-state.md>` — ephemeral per-iteration state (may be
  gitignored); look for status transitions
- `<path to backlog.md or index>` — work items + statuses
- <any domain-specific index: `hypotheses/INDEX.md`,
  `frontier-state.yaml`, etc.>
- `git log --oneline -n 20` — recent commits (catches scope creep)

Poll cadence: every 60–120 seconds is usually enough. Between polls,
capture the tmux pane once to catch crashes / harness errors the
state files won't show.

## 4. Intervention taxonomy

Each trigger has a detection signal, a response, and an authority
cap. Fire a response when you see a detection; stop (Ctrl-C + report)
if the authority cap says so.

<3–5 triggers, each formatted like:>

### <trigger-name>

- **Detect:** <what to read / grep / check>
- **Respond:** <concrete action, bounded by the authority stance>
- **Stops the run?** <yes / no>

<Example triggers:>

### stuck-hypothesis

- **Detect:** Same hypothesis ID in last 3+ `run-log.md` entries with
  barely-changing "probes planned"
- **Respond:** Flip status to `pruned` in `hypotheses/INDEX.md` with
  one-line operator note. Do not touch the hypothesis body.
- **Stops the run?** No

### runner-errors-twice

- **Detect:** Two consecutive `run-log.md` entries with verdict
  `error`
- **Respond:** Root-cause the runner / Dockerfile / hook; fix and
  commit. Never bypass checks.
- **Stops the run?** No

### mutation-in-main-worktree

- **Detect:** `git status` shows mutation markers in tracked source
  files
- **Respond:** Stop. This is never safe to auto-fix.
- **Stops the run?** Yes

## 5. Out-of-scope / don't-touch

You must not:

- <list of paths / categories the supervisor must not edit>

Examples:

- Probe / task implementation code under `<path>/`
- Hypothesis bodies (status field + one-line operator note only)
- `run-log.md` (append-only, inner loop's territory)
- `loop-state.md` (ephemeral, inner loop's territory)
- `SUPERVISOR.md` itself (no live-update; surface new failure classes
  in your final message for the human to fold in)

## 6. Budgets

- **Max interventions before hard stop:** <N, default 3>
- **Poll cadence:** 60–120 seconds between full state-file reads
- **What counts as one intervention:** <project-specific; e.g. "one
  commit OR one PROMPT.md edit OR one index-status flip">

When you hit the intervention cap, stop regardless of whether triggers
are still firing. The loop may need more than surface fixes and that
belongs with the human.

## 7. Escalation

There is no dedicated escalation file or notification channel.

When you need to stop (success, exhaustion, budget, hard failure, or
anything you can't classify):

1. Send Ctrl-C to the tmux pane (see §8 for pane coordinates). First
   Ctrl-C interrupts the current iteration cleanly; second Ctrl-C
   exits the `rl` outer loop if you need to end immediately.
2. Capture the pane tail into your message.
3. Summarise in your final chat turn:
   - What you supervised (wall-clock, iterations run)
   - What stopped the run (which condition fired)
   - What interventions you made, in order, with commit SHAs
   - Anything outside the current taxonomy that's worth folding in
     next time (the human edits `SUPERVISOR.md` between runs; you
     do not edit it mid-run)
4. Leave the tmux session alive unless the user said otherwise —
   they may want to inspect the pane.

## 8. Launch

**Tmux session:** `<session-name>`

**Launch command (only if the session doesn't already exist):**

```bash
<launch command, e.g. rl 100 -- cxys 'TASKS/<name>/PROMPT.md'>
```

**Startup sequence:**

1. `tmux has-session -t <session-name>` — check for an existing session
2. If the session does not exist:
   - Create it and run the launch command
   - Wait for the first `run-log.md` entry to appear (confirms the
     loop is actually making progress, not stuck at a harness error)
3. If the session already exists:
   - Attach by capturing the pane, confirm it looks healthy
   - Do not re-launch — re-launching a running loop will corrupt
     state
4. Begin §3–§4 supervision cycle.
```

## Adaptation notes

- **Keep each section short.** The consumer reads this top-to-bottom
  every session. Bloated sections waste tokens and dilute the
  actually-important triggers.
- **Inline the golden rule (§1).** Don't offload it to a reference.
  It's the single most load-bearing line in the file.
- **Don't inline tmux syntax.** The consumer has the `tmux` skill.
  Describe *what* to watch; let the skill handle *how*.
- **Keep §4 triggers copy-pasteable.** A future human reading the
  file should be able to fold a new trigger in without cross-referencing
  this template.
- **Name the tmux session deterministically.** Something derived from
  the loop directory (e.g. `<name>-loop`) so re-invocations find the
  same session. Ad-hoc names break the has-session check.
