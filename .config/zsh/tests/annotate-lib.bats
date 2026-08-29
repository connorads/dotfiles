#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

LIB="$TESTS_DIR/../../tmux/scripts/annotate-lib.sh"

setup() {
  setup_test_home
  # The lib answers IDLE without spawning when the event log is absent or
  # empty, so every test that wants the CLI reached needs a non-empty one.
  export ANNOTATE_LOG="$BATS_TEST_TMPDIR/annotate.jsonl"
  printf '{"kind":"stashed"}\n' >"$ANNOTATE_LOG"
}

# The lib is sourced, never executed, so every test drives it through `sh -c`
# with a stubbed CLI rather than a real spool.
lib() {
  run sh -c ". '$LIB'; $1"
}

# A stub standing in for `annotate count --json`.
stub_cli() {
  write_stub annotate-stub <<EOF
#!/usr/bin/env bash
printf '%s' '$1'
EOF
  export ANNOTATE_BIN="$TEST_BIN/annotate-stub"
}

# --- the state table is pure ---------------------------------------------

@test "annotate_state_of: DRAFTING outranks SPOOLED, which outranks IDLE" {
  # An unsent draft holds writing you did; a spooled excerpt is only a passage
  # you pointed at, so the draft wins even when both are true.
  lib 'annotate_state_of 3 true'
  [ "$output" = "DRAFTING" ]

  lib 'annotate_state_of 0 true'
  [ "$output" = "DRAFTING" ]

  lib 'annotate_state_of 3 false'
  [ "$output" = "SPOOLED" ]

  lib 'annotate_state_of 0 false'
  [ "$output" = "IDLE" ]
}

@test "annotate_state_of: a non-numeric count reads IDLE rather than erroring" {
  lib 'annotate_state_of "" false'
  [ "$output" = "IDLE" ]
  lib 'annotate_state_of banana false'
  [ "$output" = "IDLE" ]
}

# --- reading the store ----------------------------------------------------

@test "annotate_pill: excerpts waiting and no draft is SPOOLED" {
  stub_cli '{"spool":3,"draft":false}'
  lib 'annotate_pill'
  [ "$output" = "SPOOLED 3" ]
}

@test "annotate_pill: a draft with writing in it is DRAFTING" {
  stub_cli '{"spool":2,"draft":true}'
  lib 'annotate_pill'
  [ "$output" = "DRAFTING 2" ]
}

@test "annotate_pill: an empty spool self-hides" {
  stub_cli '{"spool":0,"draft":false}'
  lib 'annotate_pill'
  [ "$output" = "IDLE 0" ]
}

# The cheap base case: a machine that has never used annotate must not pay a
# bun spawn on every status repaint, forever.
@test "annotate_pill: an absent or empty log answers IDLE without spawning" {
  write_stub annotate-stub <<'EOF'
#!/usr/bin/env bash
echo "SPAWNED" >>"$SPAWN_LOG"
printf '{"spool":9,"draft":true}'
EOF
  export ANNOTATE_BIN="$TEST_BIN/annotate-stub"
  SPAWN_LOG="$BATS_TEST_TMPDIR/spawns"
  export SPAWN_LOG

  rm -f "$ANNOTATE_LOG"
  lib 'annotate_pill'
  [ "$output" = "IDLE 0" ]

  : >"$ANNOTATE_LOG"
  lib 'annotate_pill'
  [ "$output" = "IDLE 0" ]

  [ ! -e "$SPAWN_LOG" ]
}

# The pill runs on every status repaint. A broken CLI must cost the pill, never
# the status line.
@test "annotate_pill: a missing binary reads IDLE rather than printing an error" {
  export ANNOTATE_BIN=/nonexistent
  lib 'annotate_pill'
  [ "$status" -eq 0 ]
  [ "$output" = "IDLE 0" ]
}

@test "annotate_pill: a CLI that fails or answers with junk reads IDLE" {
  write_stub annotate-stub <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  ANNOTATE_BIN="$TEST_BIN/annotate-stub" lib 'annotate_pill'
  [ "$output" = "IDLE 0" ]

  stub_cli 'not json at all'
  lib 'annotate_pill'
  [ "$output" = "IDLE 0" ]

  stub_cli ''
  lib 'annotate_pill'
  [ "$output" = "IDLE 0" ]
}

@test "annotate_pill: a malformed count falls back to zero rather than rendering junk" {
  stub_cli '{"spool":"lots","draft":false}'
  lib 'annotate_pill'
  [ "$output" = "IDLE 0" ]
}

# --- the rendering vocabulary --------------------------------------------

@test "colours: DRAFTING takes the unread blue, SPOOLED the muted data shade" {
  lib 'annotate_state_colour DRAFTING'
  [ "$output" = "89b4fa" ]
  lib 'annotate_state_colour SPOOLED'
  [ "$output" = "a6adc8" ]
}

@test "glyphs: the two states are distinguishable without colour" {
  lib 'annotate_state_glyph SPOOLED'
  local spooled="$output"
  lib 'annotate_state_glyph DRAFTING'
  [ "$output" != "$spooled" ]
}

# A wide glyph shifts every pill to its right; ☕ is the one this config already
# rejected for that reason.
@test "glyphs: neither is East Asian Wide or Ambiguous" {
  lib 'annotate_state_glyph SPOOLED; printf " "; annotate_state_glyph DRAFTING'
  run python3 -c "
import sys, unicodedata
for ch in sys.argv[1].replace(' ', ''):
    assert unicodedata.east_asian_width(ch) == 'N', (ch, unicodedata.east_asian_width(ch))
print('ok')
" "$output"
  [ "$status" -eq 0 ]
  [ "$output" = "ok" ]
}

@test "annotate_token: the figure slot is the excerpt count" {
  stub_cli '{"spool":7,"draft":true}'
  lib 'annotate_token'
  [ "$output" = "7" ]
}

# --- the segment renders --------------------------------------------------

STATUS_RIGHT="$TESTS_DIR/../../tmux/scripts/status-right.sh"

# The real render, driven the way status-right.bats drives it: width first,
# then pane path and host fields.
render() {
  run "$BASH5" "$STATUS_RIGHT" "$1" "$BATS_TEST_TMPDIR" "host" "host.local" ""
}

# bats test_tags=integration
@test "the status rail carries a clickable pill while excerpts are waiting" {
  stub_cli '{"spool":3,"draft":false}'
  render 90
  [ "$status" -eq 0 ]
  [[ "$output" == *"range=user|annotate"* ]]
  [[ "$output" == *"a6adc8"* ]]
}

# bats test_tags=integration
@test "the pill self-hides when there is nothing unfinished" {
  stub_cli '{"spool":0,"draft":false}'
  render 90
  [ "$status" -eq 0 ]
  [[ "$output" != *"annotate"* ]]
}

# bats test_tags=integration
@test "the pill is width-gated with the rest of print_full" {
  stub_cli '{"spool":3,"draft":false}'
  render 45
  [ "$status" -eq 0 ]
  [[ "$output" != *"annotate"* ]]
}
