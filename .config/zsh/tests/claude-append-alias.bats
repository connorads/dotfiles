#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

ALIASES="$ZSH_DIR/aliases/claude.zsh"
APPEND_REL=".claude/system-append.md"

setup() {
  setup_test_home
  mkdir -p "$HOME/.claude"
  : >"$HOME/$APPEND_REL"
  # The aliases word-split $(claude-launch-flags); install the real owner so the
  # substitution resolves on the isolated PATH.
  install -m 0755 "$FUNCTIONS_DIR/claude-launch-flags" "$TEST_BIN/claude-launch-flags"
  write_stub claude <<'EOF'
#!/usr/bin/env bash
printf 'ARGS:%s\n' "$*"
printf 'DISABLE_TELEMETRY:%s\n' "${DISABLE_TELEMETRY-unset}"
printf 'DO_NOT_TRACK:%s\n' "${DO_NOT_TRACK-unset}"
exit 0
EOF
}

run_alias_script() {
  local body=$1
  local script="$BATS_TEST_TMPDIR/alias-script.zsh"
  {
    printf 'source %q\n' "$ALIASES"
    printf '%s\n' "$body"
  } >"$script"
  run zsh --no-rcs "$script"
}

@test "c appends the system prompt file" {
  run_alias_script 'c -p hello'

  [ "$status" -eq 0 ]
  [[ "$output" == *"ARGS:--append-system-prompt-file $HOME/$APPEND_REL -p hello"* ]]
}

@test "cy preserves skip-permissions after the append flag" {
  run_alias_script 'cy'

  [ "$status" -eq 0 ]
  [[ "$output" == *"ARGS:--append-system-prompt-file $HOME/$APPEND_REL --dangerously-skip-permissions"* ]]
}

@test "cyc preserves skip-permissions and channel flags after the append flag" {
  run_alias_script 'cyc'

  [ "$status" -eq 0 ]
  [[ "$output" == *"ARGS:--append-system-prompt-file $HOME/$APPEND_REL --dangerously-skip-permissions --channels plugin:telegram@claude-plugins-official"* ]]
}

@test "cspy appends the prompt and clears telemetry env vars" {
  export DISABLE_TELEMETRY=1
  export DO_NOT_TRACK=1

  run_alias_script 'cspy -p hello'

  [ "$status" -eq 0 ]
  [[ "$output" == *"ARGS:--append-system-prompt-file $HOME/$APPEND_REL -p hello"* ]]
  [[ "$output" == *"DISABLE_TELEMETRY:unset"* ]]
  [[ "$output" == *"DO_NOT_TRACK:unset"* ]]
}

@test "bare claude subcommands stay untouched" {
  run_alias_script 'claude update --flag'

  [ "$status" -eq 0 ]
  [[ "$output" == *"ARGS:update --flag"* ]]
}

@test "aliases propagate the real claude exit status" {
  write_stub claude <<'EOF'
#!/usr/bin/env bash
exit 37
EOF

  run_alias_script 'c -p hi'

  [ "$status" -eq 37 ]
}
