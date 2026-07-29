#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# tmux-bind-lint precedent: no setup_test_home. The positive case asserts the
# REAL tracked suite is clean, so it runs against the real $HOME; the failure
# cases scan a fixture under $BATS_TEST_TMPDIR.
#
# The rules are what keep the de-flaked suite de-flaked, so they need the same
# treatment as any other gate: a test that the real tree passes today, and tests
# that each rule actually fires. A rule that silently matches nothing is worse
# than no rule, because the green looks like coverage.
SGCONFIG="$HOME/.hk-hooks/bats-lint.sgconfig.yml"

setup() {
  command -v ast-grep >/dev/null 2>&1 || skip "ast-grep not installed"
  FIXTURE="$BATS_TEST_TMPDIR/fixture.bats"
}

scan() {
  cd "$HOME"
  run ast-grep scan -c "$SGCONFIG" "$@"
}

@test "the real bats suite is clean today" {
  scan .config/zsh/tests
  [ "$status" -eq 0 ]
}

# The rules only look at .bats because that is the step's glob; prove the
# language mapping actually holds, or every rule below is vacuous on the files
# it is meant to police.
@test "bats files are parsed as bash, so the rules can see them" {
  cat >"$FIXTURE" <<'EOF'
@test "x" {
  sleep 0.4
}
EOF
  scan "$FIXTURE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no-hard-wait"* ]]
}

@test "a bare fixed sleep is blocked" {
  cat >"$FIXTURE" <<'EOF'
@test "x" {
  do_thing
  sleep 0.4
  [ -e ready ]
}
EOF
  scan "$FIXTURE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"poll with wait_until"* ]]
}

@test "an annotated sleep passes, and the annotation must name the rule" {
  cat >"$FIXTURE" <<'EOF'
@test "x" {
  # ast-grep-ignore: no-hard-wait - the overlay has no completion event
  sleep 0.4
}
EOF
  scan "$FIXTURE"
  [ "$status" -eq 0 ]

  # A bare `# ast-grep-ignore` would suppress everything on the line; requiring
  # the rule id is what keeps one waiver from silently covering a second defect.
  cat >"$FIXTURE" <<'EOF'
@test "x" {
  # ast-grep-ignore: no-embedded-script - wrong rule
  sleep 0.4
}
EOF
  scan "$FIXTURE"
  [ "$status" -eq 1 ]
}

@test "a poll loop's own interval is not a hard wait" {
  cat >"$FIXTURE" <<'EOF'
@test "x" {
  while [ ! -e ready ]; do sleep 0.05; done
  for _ in 1 2 3; do
    [ -e ready ] && break
    sleep 0.1
  done
}
EOF
  scan "$FIXTURE"
  [ "$status" -eq 0 ]
}

@test "a backgrounded sleep is a keep-alive, not a wait" {
  cat >"$FIXTURE" <<'EOF'
@test "x" {
  sleep 100 &
  sleep 100 >/dev/null 2>&1 &
  ( sleep 0.6; release_the_lock ) &
  { sleep 0.7; release_the_lock; } &
}
EOF
  scan "$FIXTURE"
  [ "$status" -eq 0 ]
}

@test "a sleep in a heredoc stub body is not this file's sleep" {
  cat >"$FIXTURE" <<'BATS'
@test "x" {
  write_stub slow <<'EOF'
#!/usr/bin/env bash
sleep 1
EOF
}
BATS
  scan "$FIXTURE"
  [ "$status" -eq 0 ]
}

@test "a multi-line quoted shell blob is blocked" {
  cat >"$FIXTURE" <<'EOF'
@test "x" {
  run bash -c '
    start_thing &
    wait $!
  '
}
EOF
  scan "$FIXTURE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no-embedded-script"* ]]
}

# The blind spot the second rule exists to close: a sleep inside a quoted blob is
# a string to the grammar, so no-hard-wait cannot see it. no-embedded-script must
# be the thing that catches this file.
@test "a sleep hidden inside a quoted blob is caught by the second rule" {
  cat >"$FIXTURE" <<'EOF'
@test "x" {
  run sh -c '
    start_thing &
    sleep 0.2
    signal_it
  '
}
EOF
  scan "$FIXTURE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no-embedded-script"* ]]
}

@test "a single-line sh -c is left alone" {
  cat >"$FIXTURE" <<'EOF'
@test "x" {
  tmux split-window -- sh -c 'exec sleep 300'
  run bash -c 'ls "$HOME"/.cache/*.tmp.* 2>/dev/null'
}
EOF
  scan "$FIXTURE"
  [ "$status" -eq 0 ]
}
