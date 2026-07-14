# AGENTS.md - zsh BATS tests

Tests for shell functions (`../functions/**`) and tmux scripts (`../../tmux/scripts/**`).

## Running

```bash
mise run zsh-tests        # full parallel suite (-j, across files)
mise run zsh-tests-fast   # non-integration tests, also -j (--filter-tags '!integration')
bats .config/zsh/tests/<file>.bats   # one file - use this for scoped changes
bats --timing <file>.bats            # per-test durations (profiling)
```

**Timing.** Both suites take ~2min wall-clock, so an agent's default 2min command
timeout blows on them - run with a raised timeout or in the background, and use a single
file (or `--filter-tags`) for scoped iteration. `-j` roughly halves the fast suite
(serial ~230s, parallel ~122s) but no further because `--no-parallelize-within-files`
serialises each file's own tests: ~7 CPU-bound files dominate the critical path
(`status-right` ~31s, `up` ~22s, `cleanup` ~21s, `shotpath`+`shotpath-copy` ~28s,
`killport-pclose` ~13s, `mem-lib` ~11s, measured serially). Cutting real waits in those,
or opting the non-tmux ones into within-file parallelism, is the only lever left; adding
cores or `-j` is not. Beware measuring per-test cost with `-T` under `-j` - contention
inflates each figure several-fold; time files individually for true cost. A couple of
timing-sensitive tests (e.g. `shotpath-copy.bats` streaming assertions) can flake under
`-j` while passing serially.

Conventions: isolate `$HOME`/`$PATH` via `setup_test_home` (`test_helper.bash`); assert
observable behaviour (args, exit status, stdout, fs/option effects) not internals; prefer
real infrastructure or fakes over mocks. The wider testing rules live in `~/CLAUDE.md`.

## tmux tests: bare servers (`-f /dev/null`), never the real config

Tests that need a real tmux server (`agent-state`, `agent-sweep`, `*-agent-hooks`,
`*-agent-plugin`, `*-agent-extension`, `agent-popup`, `agent-glyphs`, `tmux-agent-tabs`)
start a throwaway private server on a unique socket and **must pass `-f /dev/null`** so it
loads no real config:

```sh
SOCK="<name>_${BATS_TEST_NUMBER}_$$"
"$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }   # later commands; -f only matters at server start
```

Two reasons, both load-bearing:

- **Correctness (the real one).** `../../tmux/tmux.conf` registers focus hooks
  (`set-hook -ga after-select-pane` / `session-window-changed`) that fire
  `agent-state.sh seen` as a side-effect. Tests do `split-window` / `new-window` /
  `select-pane`, so with the real config loaded those hooks can mutate the very
  `@agent_state` a test then asserts on - hidden, ordering-dependent flakiness. A bare
  server has no such hooks: the test's own explicit calls are the only thing that writes
  state.
- **Speed.** Parsing the full interactive config costs ~2.8s per server *start*. With one
  server per test that dominated wall-clock: `agent-state.bats` was ~88s, now ~2.8s (~31x).
  It is the suite's single biggest cost, not the visible `sleep`s.

This is safe because these scripts read only the `@agent_state` option they manage
themselves plus runtime values (`#{pane_id}`, `#{session_name}`, ...) - nothing the config
sets. The earlier `agent-popup.bats` / `agent-glyphs.bats` already did this; the rest were
brought into line.

**Deliberate exception:** `tmux-render-smoke.bats` loads the REAL config on its private
socket - its purpose is to drive the actual `tmux.conf` + local nix render patches through
the tty redraw path. It pays the config parse once via a shared `setup_file` server and
silences the config's journal side-effects with `AGENT_JOURNAL_DISABLE=1`; see its header
comment before copying the pattern.

### The discipline

- **A test sets/sources every tmux option its script-under-test depends on, explicitly.**
  Never rely on the dev's interactive `tmux.conf` being loaded. Tests run against tmux
  defaults. If a test genuinely needs config lines, extract just those onto the bare server
  - see `tmux-agent-tabs.bats`, which `grep`s the `@agent_dotfmt` mapping and the seen hooks
  out of the real `tmux.conf` into a curated `agent.conf` and `source-file`s only that. This
  keeps it testing the real wiring while staying isolated from everything else.
- **Assert via stable IDs, not indices.** Use `#{pane_id}` / `#{window_id}` (the `%N`/`@N`
  unique IDs), never `#{pane_index}` / `#{window_index}`, so `base-index` / `pane-base-index`
  config can never change a result.

## See also

- `../../tmux/AGENTS.md` - tmux subsystem docs (status bar, agent-state, sweep daemon).
- `~/CLAUDE.md` (project) and `~/.claude/CLAUDE.md` (Testing/Verification) - global rules.
