#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# quarantine-drift precedent: no setup_test_home. The positive case asserts the
# REAL tracked .config/tmux carries no tab-valued IFS, so it runs against the
# real $HOME; the failure cases plant fixtures in $BATS_TEST_TMPDIR.
CHECK="$HOME/.hk-hooks/tsv-separator-lint.py"

@test "every tracked .config/tmux shell file is free of tab-valued IFS today" {
  cd "$HOME"
  run bash -c 'python3 "$1" $(dotfiles ls-files .config/tmux)' _ "$CHECK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "IFS=\$'\\t' blocks and names the file, line and source" {
  cat >"$BATS_TEST_TMPDIR/probe.sh" <<'EOF'
#!/bin/sh
row=$(tmux display-message -p '#{pane_id}')
IFS=$'\t' read -r pane state <<<"$row"
EOF
  run python3 "$CHECK" "$BATS_TEST_TMPDIR/probe.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"probe.sh:3:"* ]]
  [[ "$output" == *"0x1f"* ]]
}

@test "the printf spelling blocks too" {
  cat >"$BATS_TEST_TMPDIR/probe.sh" <<'EOF'
#!/bin/sh
while IFS="$(printf '\t')" read -r a b; do :; done
EOF
  run python3 "$CHECK" "$BATS_TEST_TMPDIR/probe.sh"
  [ "$status" -eq 1 ]
}

@test "IFS read from a variable the file gave a tab blocks" {
  # The spelling a grep for the literal forms misses, and why the gate parses
  # rather than greps: tmux-resurrect's save.sh hides 13 sites behind `d=\$'\t'`.
  cat >"$BATS_TEST_TMPDIR/probe.sh" <<'EOF'
#!/usr/bin/env bash
d=$'\t'
while IFS=$d read -r a b; do :; done
EOF
  run python3 "$CHECK" "$BATS_TEST_TMPDIR/probe.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *'$d'* ]]
  [[ "$output" == *"line 2"* ]]
}

@test "the US separator passes" {
  cat >"$BATS_TEST_TMPDIR/probe.sh" <<'EOF'
#!/bin/sh
_US=$(printf '\037')
while IFS="$_US" read -r a b; do :; done
EOF
  run python3 "$CHECK" "$BATS_TEST_TMPDIR/probe.sh"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "prose about the rule is not a finding" {
  printf 'Never write `IFS=$%s read`.\n' "'\\t'" >"$BATS_TEST_TMPDIR/notes.md"
  printf '#!/bin/sh\n# Never write IFS=$%s read here.\n' "'\\t'" \
    >"$BATS_TEST_TMPDIR/probe.sh"
  run python3 "$CHECK" "$BATS_TEST_TMPDIR/notes.md" "$BATS_TEST_TMPDIR/probe.sh"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "every offending line in one file is reported, not just the first" {
  cat >"$BATS_TEST_TMPDIR/probe.sh" <<'EOF'
#!/bin/sh
IFS=$'\t' read -r a
IFS=$'\t' read -r b
EOF
  run python3 "$CHECK" "$BATS_TEST_TMPDIR/probe.sh"
  [ "$status" -eq 1 ]
  [ "$(printf '%s\n' "$output" | grep -c .)" = 2 ]
}
