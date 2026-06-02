# Authority Stances

What the supervisor is permitted to *do* when it intervenes. Pick
one stance as the project's baseline; individual triggers can still
declare exceptions (e.g. "for this trigger specifically, only
escalate").

Stances lie on a spectrum from hands-off to hands-on. Different
projects justifiably pick different points. A tight pentest engagement
might want escalate-only; a long-running source-port project with
trusted infra tooling might want autonomous.

## escalate-only

**The supervisor does not write anything.** It observes, reasons, and
when it sees a trigger, sends Ctrl-C to the loop pane and explains
in its final message.

- **Reads:** all state files, tmux pane, git log
- **Writes:** nothing — no files, no commits, no edits to the loop
  contract
- **Stops:** yes, Ctrl-C on any trigger that would otherwise require
  a write
- **Good for:** first-time supervision of a new loop (before you
  trust what "off the rails" means here), security-sensitive work,
  loops where any side effect could leak or pollute state

**Trade-off:** Everything becomes a human escalation. Cheap to
reason about, expensive in human attention.

## harness-only (recommended default)

**The supervisor may edit the loop's harness but never its domain.**
This is the hackmonty pattern.

- **Reads:** all state files, tmux pane, git log
- **Writes:**
  - `PROMPT.md` — one-line clarifications / rhythm bullets, never
    wholesale rewrites
  - Index files (`INDEX.md`, `frontier-state.yaml`, equivalents) —
    status transitions + one-line operator notes, never hypothesis
    bodies or task descriptions
  - Runner / Docker / hook configs — full edits; these are harness
    infrastructure
- **Commits:** yes, for harness / infra fixes only. Conventional
  commit prefix `chore(supervisor):` or project equivalent. Never
  commit research artefacts or completed task output — that's the
  loop's job.
- **Stops:** yes, on success / exhaustion / budget.
- **Forbidden:** writing probe code, implementing tasks, filling in
  hypothesis bodies, editing `run-log.md` (append-only, loop's
  territory), editing `loop-state.md` (ephemeral, loop's territory).

**Good for:** most autonomous research + task-loop setups. The
supervisor can unblock genuine infra breakage without risking the
loop's findings.

**Trade-off:** Requires a clear harness/domain boundary. If the
project doesn't separate them cleanly, the supervisor keeps needing
to ask "is this mine or the loop's?"

## autonomous

**The supervisor may touch anything.** It uses judgement to decide
whether to intervene harness-only or step into loop-domain work to
unblock progress.

- **Reads:** everything
- **Writes:** everything, including loop-domain code, task
  implementations, and hypothesis bodies if that's the pragmatic
  unblock
- **Commits:** yes, any category
- **Stops:** yes, on success / exhaustion / budget; also may pause
  the loop, do work itself, then resume
- **Guardrails the user should still declare:**
  - Secrets and credentials — never commit
  - Production configs / migrations — touch only with explicit
    annotation
  - `SUPERVISOR.md` itself — not edited mid-run (regardless of
    stance; see SKILL.md)

**Good for:** mature long-running projects where the user trusts
the supervisor's judgement and wants maximum throughput. Also good
for "just do the thing" modes when the user is away for a weekend
and wants the loop to keep progressing even through novel failures.

**Trade-off:** Highest risk. The supervisor can mask real loop bugs
by fixing symptoms itself, and can introduce scope creep that
doesn't match what the user would have done. Require post-run review
of all supervisor-authored commits.

## Mixed stances

Nothing stops a `SUPERVISOR.md` from declaring a baseline and then
listing per-trigger exceptions:

> **Baseline:** harness-only.
>
> **Exceptions:**
>
> - `mutation-corrupts-main-worktree` → escalate-only (this is
>   never safe to fix automatically)
> - `silent-runner-death` → autonomous (restart the runner with
>   any pragmatic fix, restart the loop)

Use this sparingly — it's easier to reason about a single baseline
with one or two exceptions than a menu of stances per trigger.

## Choosing

Ask the user:

1. How much do you trust the loop's harness? (Mature → autonomous;
   new → harness-only; brand-new → escalate-only)
2. How hands-on do you want to be between runs? (Reviewing every
   supervisor commit → escalate-only; happy to batch-review →
   harness-only or autonomous)
3. What's the blast radius of a bad intervention? (High → tight
   stance; low → looser)
