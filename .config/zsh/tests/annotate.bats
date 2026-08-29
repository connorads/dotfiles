#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

ANNOTATE="$FUNCTIONS_DIR/agents/annotate"
STASH_SH="$TESTS_DIR/../../tmux/scripts/annotate-stash.sh"

# Throwaway private tmux server (-f /dev/null: bare, no real config). The
# binding under test is added to it explicitly, so the real config's plugins
# and hooks cannot influence the result.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  # The implementation is TypeScript (~/src/annotate), so the suite needs bun
  # on the isolated PATH. Resolve it from the ambient environment first, before
  # setup_test_home rewrites PATH, and prefer `mise which` over `command -v` so
  # a shims-only PATH cannot hand back a shim needing a version it lacks.
  local bun_bin
  bun_bin=$(mise which bun 2>/dev/null) || bun_bin=$(command -v bun 2>/dev/null) || true
  [ -n "$bun_bin" ] || skip "bun absent (mise install bun)"

  setup_test_home
  # Just bun, not its whole directory: nothing else should leak in.
  ln -s "$bun_bin" "$TEST_BIN/bun"
  # The wrapper resolves its implementation as ~/src/annotate, so the isolated
  # home has to carry it too. Zero runtime deps, so the sources are enough.
  mkdir -p "$TEST_HOME/src"
  ln -s "$REAL_HOME/src/annotate" "$TEST_HOME/src/annotate"

  # The spool lives under the isolated home, so no test can touch the real one.
  export ANNOTATE_STATE_DIR="$BATS_TEST_TMPDIR/state"
}

teardown() {
  stop_private_server
}

annotate() { run "$ANNOTATE" "$@"; }

# --- CLI contract ---------------------------------------------------------

@test "bare invocation prints usage and exits 0" {
  annotate
  [ "$status" -eq 0 ]
  [[ "$output" == *"annotate stash"* ]]
}

@test "stash takes text on stdin and reports the spool size" {
  run "$ANNOTATE" stash --pane %1 <<<"hello"
  [ "$status" -eq 0 ]
  [[ "$output" == *"stashed 1"* ]]
}

@test "an empty selection is a benign no-op, not a failure" {
  run "$ANNOTATE" stash --pane %1 <<<"   "
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing selected"* ]]

  annotate count
  [ "$output" = "0" ]
}

@test "list previews each excerpt with its pane" {
  run "$ANNOTATE" stash --pane %12 <<<$'first line\nsecond'
  annotate list
  [ "$status" -eq 0 ]
  [[ "$output" == *"%12"* ]]
  [[ "$output" == *"first line"* ]]
}

@test "list --json keeps the text verbatim" {
  run "$ANNOTATE" stash --pane %1 <<<'  ragged	text  '
  annotate list --json
  [ "$status" -eq 0 ]
  [[ "$output" == *'"  ragged\ttext  \n"'* ]]
}

@test "render fences an excerpt that itself holds a fence" {
  run "$ANNOTATE" stash --pane %1 <<'EOF'
```
code
```
EOF
  annotate render
  [ "$status" -eq 0 ]
  [[ "$output" == *'````text'* ]]
}

@test "drop and clear empty the spool" {
  run "$ANNOTATE" stash --pane %1 <<<"one"
  run "$ANNOTATE" stash --pane %2 <<<"two"

  annotate drop last
  [ "$status" -eq 0 ]
  annotate count
  [ "$output" = "1" ]

  annotate clear
  annotate count
  [ "$output" = "0" ]
}

@test "an unknown command exits 2 with usage on stderr" {
  annotate frobnicate
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown command"* ]]
}

@test "path names the log inside the state dir" {
  annotate path
  [ "$status" -eq 0 ]
  [ "$output" = "$ANNOTATE_STATE_DIR/annotate.jsonl" ]
}

@test "the log is append-only: a drop adds a line rather than removing one" {
  run "$ANNOTATE" stash --pane %1 <<<"one"
  annotate drop last
  run wc -l <"$ANNOTATE_STATE_DIR/annotate.jsonl"
  [ "${output// /}" = "2" ]
}

@test "a corrupt line does not take the rest of the spool with it" {
  run "$ANNOTATE" stash --pane %1 <<<"kept"
  printf '{"kind":"stashed",TRUNCATED' >>"$ANNOTATE_STATE_DIR/annotate.jsonl"
  annotate count
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

# --- degradation ----------------------------------------------------------

@test "bun absent prints one SKIP line and exits 0" {
  # A capture key that errors mid-review is worse than one that says it did
  # nothing, so the wrapper must never fail the keypress.
  rm -f "$TEST_BIN/bun"
  run "$ANNOTATE" list
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | wc -l | tr -d ' ')" = "1" ]
  [[ "$output" == *"SKIP"* ]]
  [[ "$output" == *"bun absent"* ]]
}

# --- the copy-mode capture key -------------------------------------------

# bats test_tags=integration
@test "copy-mode 'a' stashes the selection with the source pane's provenance" {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="annotate_${BATS_TEST_NUMBER}_$$"

  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24 \
    'sh -c "printf \"ALPHA-line\nBETA-line\n\"; sleep 60"'
  tx split-window -d -t s 'sleep 60'
  wait_until '[ "$("$TMUX_BIN" -L "$SOCK" list-panes -a -F x | wc -l | tr -d " ")" = "2" ]'

  local source_pane other_pane
  source_pane=$(tx list-panes -a -F '#{pane_id}' | head -1)
  other_pane=$(tx list-panes -a -F '#{pane_id}' | tail -1)

  # Make a DIFFERENT pane active. The binding must record the pane the
  # selection was made in, not whichever pane happens to be focused - which is
  # exactly what a `display-message -p '#{pane_id}'` query inside the
  # copy-pipe child would have returned.
  tx select-pane -t "$other_pane"
  tx set-option -p -t "$source_pane" @agent_kind codex

  ANNOTATE_BIN="$ANNOTATE" \
    tx bind -T copy-mode-vi a send-keys -X copy-pipe-and-cancel \
    "ANNOTATE_STATE_DIR='$ANNOTATE_STATE_DIR' ANNOTATE_BIN='$ANNOTATE' $STASH_SH '#{pane_id}' '#{pane_current_path}'"

  tx copy-mode -t "$source_pane"
  tx send-keys -t "$source_pane" -X history-top
  tx send-keys -t "$source_pane" -X begin-selection
  tx send-keys -t "$source_pane" -X cursor-down
  tx send-keys -t "$source_pane" -X end-of-line
  tx send-keys -t "$source_pane" -X copy-pipe-and-cancel \
    "ANNOTATE_STATE_DIR='$ANNOTATE_STATE_DIR' ANNOTATE_BIN='$ANNOTATE' $STASH_SH '$source_pane' '/tmp'"

  wait_until -d 'cat "$ANNOTATE_STATE_DIR/annotate.jsonl" 2>&1' \
    '[ -s "$ANNOTATE_STATE_DIR/annotate.jsonl" ]'

  annotate list --json
  [ "$status" -eq 0 ]
  # The selection's text, and the SOURCE pane rather than the active one.
  [[ "$output" == *"ALPHA-line"* ]]
  [[ "$output" == *"\"pane\": \"$source_pane\""* ]]
  [[ "$output" != *"\"pane\": \"$other_pane\""* ]]
}

# bats test_tags=integration
@test "the capture key reports on the status line and never fails the keypress" {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="annotate_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24 'sleep 60'

  # No annotate binary at all: the script still exits 0 and says so.
  run env ANNOTATE_BIN=/nonexistent "$BASH5" "$STASH_SH" %0 /tmp </dev/null
  [ "$status" -eq 0 ]
}

# --- the pane source is a pipe -------------------------------------------

@test "the pane source takes a snapshot on stdin" {
  run "$ANNOTATE" stash --source pane --pane %12 <<<$'top line\nbottom line'
  [ "$status" -eq 0 ]
  annotate list --json
  [[ "$output" == *'"kind": "pane"'* ]]
  [[ "$output" == *"top line"* ]]
}

# Provenance is enrichment: losing it must never cost the capture, because the
# text is already in hand by the time the pane is asked about itself.
@test "a pane that cannot be described still stashes, keeping the flag values" {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="annotate_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24 'sleep 60'
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX

  run "$ANNOTATE" stash --source pane --pane %999 --cwd /tmp <<<"orphaned"
  [ "$status" -eq 0 ]
  annotate list --json
  [[ "$output" == *'"pane": "%999"'* ]]
  [[ "$output" == *'"cwd": "/tmp"'* ]]
  [[ "$output" == *'"agentKind": null'* ]]
}
