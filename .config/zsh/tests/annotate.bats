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

# --- draft and send -------------------------------------------------------

# An `agent` stub recording its argv, so delivery is observable without a
# live agent pane.
write_agent_stub() {
  export ANNOTATE_AGENT_BIN="$TEST_BIN/agent"
  AGENT_LOG="$BATS_TEST_TMPDIR/agent.log"
  export AGENT_LOG
  write_stub agent <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$AGENT_LOG"
exit \${AGENT_EXIT:-0}
EOF
}

# An editor stub appending a comment, so a "review" is observable.
write_editor_stub() {
  export ANNOTATE_EDITOR="$TEST_BIN/fake-editor"
  write_stub fake-editor <<'EOF'
#!/usr/bin/env bash
printf 'THE CORRECTION\n' >> "$1"
exit ${EDITOR_EXIT:-0}
EOF
}

@test "send edits the draft and delivers exactly what was saved" {
  write_agent_stub
  write_editor_stub
  run "$ANNOTATE" stash --pane %12 <<<"the offending output"

  annotate send
  [ "$status" -eq 0 ]
  [[ "$output" == *"sent to agent:%12"* ]]

  run cat "$AGENT_LOG"
  [[ "$output" == *"THE CORRECTION"* ]]
  [[ "$output" == *"the offending output"* ]]
  # The editing preamble addresses the reader, not the agent.
  [[ "$output" != *"Delete a section to drop it"* ]]

  annotate count
  [ "$output" = "0" ]
}

@test "send never passes --force: a pane at an approval prompt must refuse" {
  write_agent_stub
  run "$ANNOTATE" stash --pane %1 <<<"x"
  annotate send --no-edit
  run cat "$AGENT_LOG"
  [[ "$output" != *"--force"* ]]
}

@test "a refused delivery is exit 4 with spool and draft intact" {
  write_agent_stub
  write_editor_stub
  run "$ANNOTATE" stash --pane %1 <<<"x"

  AGENT_EXIT=4 run "$ANNOTATE" send
  [ "$status" -eq 4 ]
  [[ "$output" == *"waiting on you"* ]]

  annotate count
  [ "$output" = "1" ]
  annotate draft
  [[ "$output" == *"THE CORRECTION"* ]]
}

@test "an editor that exits non-zero keeps the comments and sends nothing" {
  write_agent_stub
  write_editor_stub
  run "$ANNOTATE" stash --pane %1 <<<"x"

  EDITOR_EXIT=1 run "$ANNOTATE" send
  [ "$status" -eq 0 ]
  [[ "$output" == *"draft kept, nothing sent"* ]]
  [ ! -e "$AGENT_LOG" ]

  annotate draft
  [[ "$output" == *"THE CORRECTION"* ]]
}

@test "undo restores the delivered draft, ready to re-aim" {
  write_agent_stub
  write_editor_stub
  run "$ANNOTATE" stash --pane %1 <<<"x"
  annotate send

  annotate undo
  [ "$status" -eq 0 ]

  annotate send --no-edit --to %19
  [ "$status" -eq 0 ]
  run cat "$AGENT_LOG"
  [[ "$output" == *"%19"* ]]
  [[ "$output" == *"THE CORRECTION"* ]]
}

# --- the transcript picker ------------------------------------------------

PICK_SH="$TESTS_DIR/../../tmux/scripts/annotate-pick.sh"

@test "the picker needs a pane id" {
  run "$BASH5" "$PICK_SH" </dev/null
  [ "$status" -eq 2 ]
  [[ "$output" == *"needs a pane id"* ]]
}

@test "the picker surfaces why a pane has no transcript, without failing" {
  # A pane that resolves to no Claude session: the picker reports and exits 0
  # rather than leaving an error dialog over the review.
  write_stub annotate <<'EOF'
#!/usr/bin/env bash
echo "annotate: no Claude session for %1 (transcript capture is Claude-only)" >&2
exit 3
EOF
  ANNOTATE_BIN="$TEST_BIN/annotate" run "$BASH5" "$PICK_SH" %1 </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"no Claude session"* ]]
}

@test "the picker says so when the transcript has no messages" {
  write_stub annotate <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  ANNOTATE_BIN="$TEST_BIN/annotate" run "$BASH5" "$PICK_SH" %1 </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"No transcript messages"* ]]
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
