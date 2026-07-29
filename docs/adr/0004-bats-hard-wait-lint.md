# Fixed sleeps in the bats suite are blocked by ast-grep, not by review

Two [`ast-grep`](https://ast-grep.github.io) rules in
[`.hk-hooks/bats-lint/`](../../.hk-hooks/bats-lint/) gate
[`.config/zsh/tests/**/*.bats`](../../.config/zsh/tests) through the `bats-lint`
hk step:

- **`no-hard-wait`** - a `sleep` used to synchronise. Not flagged: a sleep in a
  loop body (a poll's own interval), a backgrounded `sleep 100 &` (a keep-alive),
  or a sleep inside a backgrounded subshell (a fixture producing the condition
  under test). Waivable one line at a time with
  `# ast-grep-ignore: no-hard-wait - <reason>`.
- **`no-embedded-script`** - multi-line shell inside a quoted string
  (`run bash -c '…'`). No waiver offered.

The invariant: **a test waits for an observable signal, or it says in writing why
it cannot.** The suite's own poll primitive is `wait_until` in
[`test_helper.bash`](../../.config/zsh/tests/test_helper.bash).

## Context

The `bats-full` pre-push gate runs the whole suite through `mise run zsh-tests`:
115 files at `-j 10` on a 10-core Mac, which is full CPU saturation. Two tests
failed there while passing serially - `status-right.bats`'s stale-cpu-cache test
and `tmux-skill-scripts.bats`'s control-tail timeout.

Neither was a resource collision. Both files isolate `$HOME`/`$PATH`, every cache
and lock path is `$HOME`-relative, and socket names carry
`${BATS_TEST_NUMBER}_$$`. Both were unsynchronised timing: the test named a
duration where it should have waited for a signal, and under `-j` the fork/exec
chains behind a render or a tmux round-trip inflate several-fold until the
duration loses.

A bigger number is not the fix, for two independent reasons. It is paid in full
on every run where the work took 10ms. And in the worst shape of the bug the
assertion *depends* on losing the race - `status-right.bats` asserted the cache
was still stale while a `sleep 1` sampler raced the rest of the render, so a
larger timeout makes it fail more often, not less.

A sweep of all 115 files found ~30 sites of this class across 12 files, including
five that **passed vacuously**: the negative assertion in
`tmux-skill-scripts.bats` proved nothing if the tail was not yet attached, and
`agent-sweep.bats` reported a daemon "exited" without ever having watched it,
because `kill -0 ""` fails and its pidfile was polled for existence rather than
content. Those are worse than the flakes. A flake is loud; a false green is
silent.

Chasing them turned up two mechanisms worth recording, both of which had been
passing by accident:

- A pty client backgrounded from bats inherits an already-drained stdin, and
  `script` exits the instant its input reaches EOF, taking the client with it.
  `session-popup.bats` survived on the cost of a `$(seq 1 25)` fork; replacing
  that fork with `{1..25}` - a few milliseconds, no behaviour change - took the
  file from 0 failures in 12 runs to 13.
- A `-T` deadline that the process exits early on match costs a passing run
  nothing, so it should be generous. A `-T` that is the thing under test is paid
  in full, so it should not be. The same flag needs opposite treatment in
  neighbouring tests.

This matters now in a way it did not before. Nothing ran the suite in parallel
routinely until `bats-full` landed, so the class was invisible. Now it can fail a
push for no real reason, which trains you to ignore the gate - the one outcome
that makes the gate worthless.

## Decision

Encode the rule, because the doctrine already existed and was unevenly applied:
`testing/references/shell-testing.md` says *"A test that sleeps a magic number to
outlast a hardcoded delay is both slow and racy"*, and `rl.bats` carried a
comment documenting this exact `-j` failure mode - while ~30 other sites did not.
Prose a reviewer has to remember is not a rule.

**Two rules, because one has a blind spot the other closes.** Multi-line shell
inside a quoted string is a string to any AST tool, so `no-hard-wait` cannot see
a sleep in there - and one of the two known failures lived in exactly such a
blob. `no-embedded-script` blocks the construct that creates the gap, so it is
not left to goodwill. That is also this record's answer to
[0001](0001-tmux-scripts-re-exec-under-bash-5.md)'s standing objection to
source-graph scoping: *"a bug in that parser is a silent gap, which is the exact
failure class this change exists to remove."* Correct - so the gap is itself a
blocked pattern. The same rule incidentally closes the route by which plain
`bash` (Apple's 3.2) smuggles itself past the `$BASH5` contract.

**Backgrounding is matched by regex on the following sibling.** Loop and heredoc
awareness come free from the grammar, which is most of why an AST tool wins here.
Backgrounding does not: tree-sitter-bash leaves `&` as an anonymous token, and
`kind: "&"` is rejected outright ("Illegal character &"), so the rule matches
`precedes: {regex: "^&$"}` on the sleep and, separately, on whichever wrapper
stands between it and that token - `redirected_statement`, `subshell`,
`compound_statement`, `pipeline`.

This is not optional polish. Without it the rule flags 40 sites, 26 of them
backgrounded keep-alives (`sleep 100 &` holding a pane or a pid) that delay
nothing. Waiving 26 non-problems teaches the reflex of waiving without reading,
which is the only way this gate fails. With it: 14 sites, every one a genuine
fixed wait.

**Annotation burden, stated plainly.** 14 waivers today: 12 are
`tmux-render-smoke.bats` render settles - overlay draws, popup teardown, resize
repaints, none of which tmux exposes a completion event for - and 2 are fzf
keystroke pacing in `skl-pick.bats`. Each is one line and each must name a
reason. That is the ratchet: deferred debt made visible rather than silent.

`BATS_TEST_RETRIES` exists and would make both failures disappear today. It is
deliberately unused; see below. `BATS_TEST_TIMEOUT` *is* used, in `rl.bats`'s
`setup_file`, as a hang backstop - a mishandled INT there blocks `wait` on a
`sleep 300`, five minutes in which the suite looks hung rather than a test that
failed.

Static analysis cannot see semantic races - `ai-usage.bats` asserted a marker
file before `wait`ing on the process that writes it, with no `sleep` anywhere.
`mise run zsh-tests-stress` covers that class by running the real gate
repeatedly and reporting anything short of 100% stable.

## Alternatives considered

- **`BATS_TEST_RETRIES`.** Rejected on the `testing` skill's rule:
  *"Retry-to-green is an anti-pattern - auto-rerunning until a pass hides a real
  defect (usually a race, shared state, or order-dependency) and lets it ship."*
  It would also have hidden the five vacuous passes indefinitely, since those
  were already green. Bounded polling sits on the other side of that line -
  *"Polling a genuinely asynchronous result until it appears, with a timeout, is
  correct"* - and every fix here is on the polling side.

- **A Python line-scanner**, matching `tmux-bind-lint.py` and the four other hk
  checkers, which is the house pattern and was the first sketch. Rejected on
  measurement: heredoc and loop awareness are ~200 lines of hand-rolled state
  (`<<-`, quoted vs unquoted delimiters, nesting) that the grammar gives for
  free, and it would need its own pytest and bats suites. It has no blind spot,
  which is its one advantage - and rule 2 removes ast-grep's.

- **A duration threshold** instead of matching backgrounding - flag `sleep` under
  ~20s, skip the long keep-alives. It separates the two populations here exactly
  (0.1-5 vs 30-100) and is far simpler. Rejected as a coincidence of the current
  values rather than a property: a genuine `sleep 60` would pass silently, and
  the number would need re-tuning every time someone picks a new keep-alive
  length.

- **Leaving it to review, with the doctrine in prose.** Rejected because that is
  the status quo that produced ~30 sites, five of them vacuous, under a rule
  already written down in two places.

- **A repo-wide `.shellcheckrc` disabling SC2016**, needed because a `wait_until`
  predicate is a single-quoted string by design and shellcheck reads that as a
  mistake. Rejected as too broad: it would silence a genuinely useful check
  everywhere. hk's shellcheck step turns out not to match `.bats` at all, so the
  waiver is three scoped `# shellcheck disable=SC2016` lines in
  `test_helper.bash`.

## Known limits

- The rules scan `.bats` only. Sleeps in the tmux scripts and shell functions
  under test are out of scope, and some are load-bearing production behaviour.
- `$BASH5` is not yet enforced against plain `bash` in tests. It is owed -
  `.config/zsh/tests/AGENTS.md` states it in prose - but there are 20+ existing
  violations across `wt-status-pr`, `caffeine-lib`, `ghfzf`, `tools-tsv-lint` and
  others. That is its own migration. `no-embedded-script` closes the multi-line
  route only.
- Other prose-only rules now cheap to encode and not yet written: `-f /dev/null`
  on test tmux servers, unique `-L` socket names, `#{pane_id}` not
  `#{pane_index}`, and the bash-3.2 `[[ ]]`-without-`|| false` trap - which the
  two existing lint bats suites themselves violate, so a rule for it would fail
  on its own gate first.
