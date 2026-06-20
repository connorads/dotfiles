# Stop Conditions

When the supervisor ends the run. Every `SUPERVISOR.md` needs at
least one stop condition per category: *success*, *exhaustion*, and
*failure*. Otherwise the supervisor has no reason to ever stop
watching.

Pick from the patterns below, combine, or write project-specific ones.

## Success patterns

### File-existence marker

The loop writes a specific file at the repo root (or agreed path)
when it achieves its goal. Supervisor polls for the file each cycle.

- **Examples:** `FOUND_SECRET.txt` (hackmonty bounty), `BUILD_PASSED.md`
  (build-green milestone), `RELEASE_READY.txt` (deploy gate)
- **Detection:** `[ -f path/to/marker ] && stop`
- **Why it works:** Atomic (the loop writes it last), durable
  (survives crashes), un-ambiguous
- **Caveat:** Make sure the loop contract says *what* goes in the
  file (e.g. the secret + exploit path for hackmonty) so the
  supervisor's final message can report it

### Emit-token

The loop prints a sentinel string on its own final line when done.
`rl` picks this up and exits the outer runner; the supervisor sees
the tmux pane return to a shell prompt.

- **Default:** `__PROMISE_RL_DONE__` (task-loop's built-in)
- **Custom:** `__WEEKEND_BUILD_DONE__`, project-specific tokens
- **Detection:** grep the tmux pane for the token, *or* watch for
  the shell prompt returning without a re-launch
- **Why it works:** No extra file state; cleanly integrates with
  `rl`'s promise-token handling

### All-work-exhausted

All tracked work items reach a terminal state.

- **Backlog loops:** no `[ ]` checkboxes remain in `backlog.md`
- **Hypothesis loops:** all hypotheses confirmed / refuted / pruned
  in `INDEX.md`
- **Multi-lane loops:** every lane's frontier state is `closed`
- **Detection:** grep/parse the relevant index file each cycle
- **Why it works:** Aligns with the loop's own definition of done

## Exhaustion patterns

### Iteration budget spent

The outer runner's iteration count is complete.

- **Detection:** `rl N` runs the loop N times then exits; the tmux
  pane returns to a shell prompt. Or: count `run-log.md` entries
  and compare to N.
- **Why it works:** Guarantees bounded wall-clock; forces periodic
  human review
- **Caveat:** The loop might not have finished useful work — the
  final message should make "what's left" obvious

### Wall-clock cap

Cap the total run time.

- **Detection:** Capture start time at launch; each cycle, compare
  now vs start + budget. Default: 12h for overnight runs, 48h for
  weekend runs.
- **Why it works:** Bounds real-world cost (compute, your
  attention). Good layered with iteration budget
- **Caveat:** Needs a persistent start-time record if the supervisor
  session might restart mid-run

### Intervention budget spent

The supervisor has hit its maximum allowed interventions (default 3
from the skill's convention).

- **Detection:** Supervisor counts its own interventions in its
  reasoning; stops on the N+1th.
- **Why it works:** Forces escalation when the loop needs more than
  surface fixes. Prevents the supervisor becoming the inner loop by
  accident.
- **Caveat:** Needs a sharp definition of what counts as "an
  intervention" (one commit? one trigger firing? one
  PROMPT.md edit?). Document it in `SUPERVISOR.md` §6.

## Failure patterns

### Hard-stop triggers

Some triggers are D-class — they stop the run immediately regardless
of budget. See `trigger-examples.md`.

- **Examples:** mutation corrupting main worktree, secrets leaking to
  commit messages, the loop somehow modifying `SUPERVISOR.md` or
  other supervisor-owned files
- **Response:** Ctrl-C the pane, explain, stop. Don't try to fix.

### Repeated runner failure after fix

Supervisor fixes a runner error; next iteration errors again the
same way.

- **Detection:** `run-log.md` shows two `error` verdicts with the
  same class, with a supervisor commit between them that should
  have fixed it
- **Response:** Stop. The fix didn't work; escalate to the human.

### Novel failure outside the taxonomy

Something happened that isn't in the current `SUPERVISOR.md`
taxonomy, and the supervisor can't classify it.

- **Detection:** supervisor's own judgement — a state that doesn't
  match any trigger pattern
- **Response:** Stop. Final message explains the novel state. Human
  folds it into the taxonomy before the next run (live-update is
  explicitly disallowed mid-run).

## Minimum viable set

At absolute minimum, every `SUPERVISOR.md` needs:

- **One success condition** — so the supervisor knows what winning
  looks like
- **One exhaustion condition** — so the supervisor doesn't watch
  forever on an unwinnable run
- **The generic failure escalation** — Ctrl-C + final message on
  anything novel

Three lines of YAML-or-markdown covers this; more is fine.
