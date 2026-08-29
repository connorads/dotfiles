#!/usr/bin/env bats

# The menu behind a click on the annotate pill. Its whole point is that its rows
# match the state, so that is what these assert - via a tmux stub capturing the
# display-menu argv, which is also the only way to see a menu without a client.
#
# Not integration-tagged: nothing here starts a server or spends real time.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

MENU="$HOME/.config/tmux/scripts/annotate-menu.sh"

setup() {
  setup_test_home
  # The lib answers IDLE without spawning when the event log is absent or empty,
  # so every state here needs a non-empty one for the CLI to be reached at all.
  export ANNOTATE_LOG="$BATS_TEST_TMPDIR/annotate.jsonl"
  printf '{"kind":"stashed"}\n' >"$ANNOTATE_LOG"
  export FLT="$TEST_BIN/flt"
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
EOF
}

# A stub standing in for `annotate count --json`, which is the only thing the
# menu reads the store through.
stub_cli() {
  write_stub annotate <<EOF
#!/usr/bin/env bash
printf '%s' '$1'
EOF
  export ANNOTATE_BIN="$TEST_BIN/annotate"
}

spooled() { stub_cli '{"spool":3,"draft":false}'; }
drafting() { stub_cli '{"spool":2,"draft":true}'; }
idle() { stub_cli '{"spool":0,"draft":false}'; }

menu() {
  run env ANNOTATE_LOG="$ANNOTATE_LOG" ANNOTATE_BIN="$ANNOTATE_BIN" \
    FLT="$FLT" TEST_LOG="$TEST_LOG" \
    "$MENU" "${1:-client0}" "${2:-10}" "${3:-S}" "${4-/tmp/work}"
}

@test "a spool with no draft is offered draft-and-send, drop, clear and stash" {
  spooled

  menu

  [ "$status" -eq 0 ]
  rows=$(cat "$TEST_LOG")
  [[ "$rows" == *"Draft and send…"* ]] || false
  [[ "$rows" == *"Drop the newest excerpt"* ]] || false
  [[ "$rows" == *"Clear the spool"* ]] || false
  [[ "$rows" == *"Stash from transcript…"* ]] || false
  # There is no draft to discard yet.
  [[ "$rows" != *"Discard the draft"* ]]
}

@test "an open draft is offered edit, discard, clear and stash" {
  drafting

  menu

  rows=$(cat "$TEST_LOG")
  [[ "$rows" == *"Edit the draft…"* ]] || false
  [[ "$rows" == *"Discard the draft"* ]] || false
  [[ "$rows" == *"Clear the spool"* ]] || false
  [[ "$rows" == *"Stash from transcript…"* ]] || false
  # Once a draft exists the excerpts are rendered into it, so dropping one
  # behind its back reads as a no-op.
  [[ "$rows" != *"Drop the newest excerpt"* ]]
}

@test "idle offers only the picker" {
  idle

  menu

  rows=$(cat "$TEST_LOG")
  # A Clear row with nothing to clear is the drift the one-lib rule exists to
  # prevent.
  [[ "$rows" == *"Stash from transcript…"* ]] || false
  [[ "$rows" != *"Clear the spool"* ]] || false
  [[ "$rows" != *"Draft and send…"* ]] || false
  [[ "$rows" != *"Drop the newest excerpt"* ]]
}

@test "clearing and discarding ask first, sending does not" {
  drafting

  menu

  rows=$(cat "$TEST_LOG")
  # These two are the only rows that lose writing: `undo` restores a draft a
  # SEND delivered, so it cannot bring back a discarded one.
  [[ "$rows" == *"confirm-before"*"draft --discard"* ]] || false
  [[ "$rows" == *"confirm-before"*"clear"* ]] || false
  [[ "$rows" != *"confirm-before"*"Edit the draft"* ]]
}

@test "dropping the newest excerpt does not ask" {
  spooled

  menu

  rows=$(cat "$TEST_LOG")
  # It loses a passage you pointed at, not writing you did.
  [[ "$rows" == *"drop last"* ]] || false
  [[ "$rows" != *"confirm-before"*"drop last"* ]]
}

@test "the clear row names how many excerpts are waiting" {
  spooled

  menu

  [[ "$(cat "$TEST_LOG")" == *"Clear the spool (3)"* ]]
}

@test "the menu names the state it is offering rows for" {
  drafting

  menu

  [[ "$(cat "$TEST_LOG")" == *"annotate: drafting"* ]]
}

@test "the menu opens where it was clicked, on the clicking client" {
  spooled

  menu client7 42 S

  rows=$(cat "$TEST_LOG")
  [[ "$rows" == *"-c client7"* ]] || false
  [[ "$rows" == *"-x 42"* ]] || false
  [[ "$rows" == *"-y S"* ]]
}

@test "the draft row opens a float in the directory it was passed" {
  spooled

  menu client0 10 S /tmp/somewhere

  rows=$(cat "$TEST_LOG")
  # A float, not a popup: writing comments is dwelling, and an agent may go
  # blocked meanwhile.
  [[ "$rows" == *"flt"* ]] || false
  [[ "$rows" == *"/tmp/somewhere"* ]]
}

@test "an unpassed directory falls back to a live query, never to nothing" {
  spooled

  # The stub answers display-message with nothing, which is what a query
  # outside a client does - the row must still name a real directory.
  menu client0 10 S ""

  [[ "$(cat "$TEST_LOG")" == *"-c \"$HOME\""* ]]
}

@test "the picker is passed no pane, so it resolves the origin itself" {
  spooled

  menu

  rows=$(cat "$TEST_LOG")
  # A display-popup -E command string reaches the shell verbatim, so a format
  # here would arrive unexpanded - the same reason the M-E binding passes none.
  [[ "$rows" == *"annotate-pick.sh"* ]] || false
  [[ "$rows" != *"annotate-pick.sh' %"* ]]
}
