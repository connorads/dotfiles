#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# Sourced for wait_until only - this file deliberately does not call
# setup_test_home (see below).
source "$BATS_TEST_DIRNAME/test_helper.bash"

# Behavioural regression for the skl picker's Tab-marks-not-installs fix.
#
# Drives the REAL ~/.config/skl/bin/pick through fzf in a pane on a throwaway
# `tmux -L` server (never the real server, per the tmux-safety rule), with a
# PATH-stubbed `skl` that logs its invocations + stdin. Sends Tab Tab Enter and
# asserts pick routed to `skl load --stdin` with the two marked refs, NOT to
# `skl install` - the exact regression fixed by moving the install key off the
# Tab-aliased ctrl-i. fzf's own key routing is untested by skl's Bun suite
# (ADR-0004), so this is net-new shell coverage.
#
# Not setup_test_home: pick is invoked by its real absolute path and only reads
# $HOME/.local/bin (where the stub is planted) + tmux, so HOME is overridden for
# the pane alone via `tmux new-session -e`.

REAL_PICK="$HOME/.config/skl/bin/pick"

setup() {
  T="$BATS_TEST_TMPDIR"
  SOCK="skltest_${BATS_TEST_NUMBER}_$$"
  LOG="$T/skl.log"

  # Stub skl: fixed `list`, trivial `preview`, and load/install that log their
  # args + stdin so the test can see exactly which path pick took.
  mkdir -p "$T/.local/bin"
  cat >"$T/.local/bin/skl" <<'STUB'
#!/usr/bin/env bash
cmd=$1; shift
case "$cmd" in
  list)
    printf '%s\n' \
      'ref-alpha  Alpha skill' \
      'ref-bravo  Bravo skill' \
      'ref-charlie  Charlie skill'
    ;;
  preview) printf 'preview of %s\n' "${1:-}" ;;
  load|install)
    { printf 'CMD %s' "$cmd"
      for a in "$@"; do printf ' %s' "$a"; done
      printf '\nSTDIN:\n'
      cat
      printf '\n'
    } >>"$SKL_LOG"
    ;;
esac
STUB
  chmod +x "$T/.local/bin/skl"
}

teardown() {
  tmux -L "$SOCK" kill-server 2>/dev/null || true
}

# Poll until the predicate succeeds; on timeout dump the pane as context.
_wait_for() {
  local what=$1
  shift
  wait_until -i 0.1 -d "echo 'waiting for: $what'; tmux -L '$SOCK' capture-pane -t s -p 2>&1" "$*"
}

_pane_shows_list() { tmux -L "$SOCK" capture-pane -t s -p 2>/dev/null | grep -q 'ref-alpha'; }
_run_done() { [ -f "$T/done" ]; }

@test "Tab marks rows and Enter loads them (does not install)" {
  local cmd="zsh '$REAL_PICK' >'$T/pick.out' 2>&1; echo done >'$T/done'"
  tmux -L "$SOCK" -f /dev/null new-session -d -s s -x 200 -y 50 \
    -e HOME="$T" -e SKL_LOG="$LOG" -e PATH="$T/.local/bin:$PATH" \
    "$cmd"

  _wait_for "fzf list to render" _pane_shows_list

  # tab:toggle+down marks the current row then advances: two Tabs mark
  # ref-alpha + ref-bravo; Enter accepts (not an --expect key -> load path).
  tmux -L "$SOCK" send-keys -t s Tab
  # ast-grep-ignore: no-hard-wait - fzf keystroke pacing: Tab's mark has no observable the pane exposes
  sleep 0.1
  tmux -L "$SOCK" send-keys -t s Tab
  # ast-grep-ignore: no-hard-wait - fzf keystroke pacing: Tab's mark has no observable the pane exposes
  sleep 0.1
  tmux -L "$SOCK" send-keys -t s Enter

  _wait_for "pick to exit" _run_done

  run cat "$LOG"
  [ "$status" -eq 0 ]
  # Routed to load --stdin, targeting the origin pane.
  [[ "$output" == *"CMD load"* ]]
  [[ "$output" == *"--stdin"* ]]
  [[ "$output" == *"--target"* ]]
  # Both marked refs reached load's stdin; the unmarked one did not.
  [[ "$output" == *"ref-alpha"* ]]
  [[ "$output" == *"ref-bravo"* ]]
  [[ "$output" != *"ref-charlie"* ]]
  # The bug: Tab must NOT trigger the install path.
  [[ "$output" != *"CMD install"* ]]
}
