# Trigger Examples

Catalogue of "off the rails" patterns seen in autonomous loops. Each
entry is a trigger the user can lift wholesale, adapt, or ignore.
Don't copy the whole list into `SUPERVISOR.md` — pick the 3–5 that
match the project.

Each trigger has three parts:

- **Detection** — what the supervisor reads to notice it (file
  content, git state, tmux pane scan, commit streak)
- **Response** — what the supervisor does. Bounded by the project's
  authority stance (see `authority-stances.md`)
- **Provenance** — where the pattern came from, so the user can
  judge whether it transfers

## Research / hypothesis-driven loops

### Same hypothesis/task N iterations, no narrowing

- **Detection:** The same task ID or hypothesis ID appears in the last
  N `run-log.md` entries (default N=3), and its "next step" / "probes
  planned" / "checklist" barely changes between entries.
- **Response:** Mark the item as exhausted in its index file (e.g.
  flip status to `pruned` with a one-line operator note explaining
  *why* — "cycled 3× without narrowing scope"). Do *not* rewrite the
  hypothesis or task body. Let the loop pick the next item naturally.
- **Provenance:** hackmonty H007 — 11 probes cycled through variants
  of "go colder / longer delay" without info-gain; one intervention
  marked it pruned, loop resumed and terminated cleanly.

### Inner loop locked onto one branch, ignoring breadth

- **Detection:** Recent `run-log.md` entries all touch the same
  task/hypothesis while other high-promise unchecked items sit idle
  for N+ iterations, violating the loop's own selection rules.
- **Response:** Add *one* terse clarification bullet to the loop
  contract (`PROMPT.md`) nudging toward the selection rule the agent
  is drifting from. Don't rewrite the prompt. Commit if the change
  was to harness files.
- **Provenance:** hackmonty iter 12–82 — agent bisected H001 for 8+
  probes ignoring untouched H003/H004/H011 with higher info-gain
  priority. One-bullet nudge to PROMPT.md §5 flipped behaviour on
  the next iteration.

## Infrastructure / runner failures

### Runner errors twice in a row

- **Detection:** Two consecutive `run-log.md` entries with verdict
  `error` / `runner_failed` / Docker / permission / harness fault.
- **Response:** Root-cause the runner / Dockerfile / hook / template.
  Fix and commit (if harness files). Never bypass checks (no
  `--no-verify`, no `chmod 0777` shortcuts). Resume with remaining
  iterations.
- **Provenance:** hackmonty `docker/run-probe.sh` had transient
  permission races; expected failure mode.

### Loop silently stopped

- **Detection:** tmux pane shows shell prompt (not an `rl`
  iteration), `run-log.md` hasn't grown in > threshold wall-clock,
  and no completion token was emitted.
- **Response:** Capture the pane tail into the supervisor's notes,
  inspect for crash cause (OOM, segfault, network), fix if trivial,
  otherwise escalate.
- **Provenance:** general pattern — runners die silently more often
  than expected.

## Scope creep / contract violations

### Inner loop editing files outside its domain

- **Detection:** `git diff HEAD~<N>..HEAD --name-only` shows files
  outside the paths the loop contract lists as its domain (e.g. loop
  touched `PROMPT.md`, `SUPERVISOR.md`, or repo-level configs).
- **Response:** Depends on authority stance. Harness-only supervisor:
  revert the out-of-scope hunks with explanation, add a clarifying
  bullet to `PROMPT.md` §out-of-scope. Escalate-only: stop and
  report. Autonomous: judge case-by-case — sometimes the loop
  correctly noticed a harness bug and fixed it.
- **Provenance:** hackmonty out-of-scope list explicitly forbade the
  loop from committing research state; a stray commit would trigger
  this.

### Loop rewriting its own contract

- **Detection:** `PROMPT.md` shows modifications in git log attributed
  to loop iterations (not operator interventions).
- **Response:** Revert. The loop contract is the supervisor's
  (or human's) domain — the loop can surface complaints but not
  edit. Add a `don't-touch` bullet if missing.
- **Provenance:** hackmonty classified this as intervention-C
  ("bad loop rhythm") — a symptom the agent was burning tokens on
  meta rather than probes.

## Source-port / long-running multi-lane loops

### Mutation / stress testing corrupting main worktree

- **Detection:** `git status` in the main worktree shows modifications
  to source files that weren't part of any commit — tool-injected
  mutation markers, test fixtures left in place.
- **Response:** Stop immediately. This is a D-class trigger (hard
  stop, not fix-and-resume) — background agents must run in isolated
  worktrees. Document the fix requirement in the final message.
- **Provenance:** KC — `cargo mutants --in-place` running against
  the main worktree repeatedly corrupted `enemies.rs`, `blocks.rs`,
  `physics.rs`. Root cause: missing worktree isolation in the
  autonomy spawner.

### Strategy lane thrashing

- **Detection:** Recent commits or run-log entries cycle across
  multiple strategy lanes (coverage-drive → mutation-testing →
  enemy-audit → …) without completing any one, or the loop selects
  the same strategy N+ times consecutively without varying.
- **Response:** Pin the loop to a single lane for M iterations (edit
  the strategy-selector config if the harness exposes one). Surface
  in the supervisor's final notes if the root cause is a broken
  prioritiser in the loop contract.
- **Provenance:** KC autonomy — "loc-coverage-drive" had no throttle
  and produced busywork; selector was blind to ledgers.

### Ignored handoff / ledger

- **Detection:** Loop produces a handoff doc (`next-agent.md`) or
  rejected-hypothesis ledger, but subsequent iterations don't read
  it — visible in run-log entries that repeat prior dead-ends.
- **Response:** Add a read step to the loop contract's preamble
  pointing at the handoff file. If the loop already has one and is
  skipping it, escalate — the loop has a reading-order bug, not a
  rhythm bug.
- **Provenance:** KC — rejected-hypothesis ledger was written but
  never consumed, leading to repeated dead ends.

## Rhythm / meta drift

### Agent burning tokens on meta

- **Detection:** tmux pane shows long think blocks, reads the same
  files repeatedly, minimal tool calls relative to iteration wall-clock.
  `run-log.md` entries show high token counts with no code changes.
- **Response:** Add a terse bullet to `PROMPT.md` preamble reminding
  the agent of its scope and the one-read-per-file convention. Don't
  rewrite the prompt.

### Skipping required steps

- **Detection:** `run-log.md` entries missing fields the contract
  declares mandatory (e.g. no commit SHA, no verification output).
- **Response:** Bullet in `PROMPT.md` enforcing the field. If the
  agent keeps skipping, it's a D-class escalation — something deeper
  is wrong.

## Stop conditions (not triggers, but live in the same section)

### Success signal

- **Detection:** The project's success file exists (e.g.
  `FOUND_SECRET.txt`, `BUILD_PASSED.md`) or the loop emitted its
  stop token (`__PROMISE_RL_DONE__`).
- **Response:** Stop immediately. Don't run "just one more iteration".
  Report in final message.

### All work exhausted

- **Detection:** No unchecked `[ ]` items in `backlog.md`; all
  hypotheses in terminal state (confirmed / refuted / pruned); all
  lanes closed.
- **Response:** Stop. Loop is done.

### Budget exhausted

- **Detection:** Iteration count (`rl N`) complete, wall-clock cap
  reached, or intervention budget spent.
- **Response:** Stop. Report what was achieved vs planned.
