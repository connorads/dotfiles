#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

WRAPPER="$FUNCTIONS_DIR/agents/handoff"
APPEND_FLAGS="--append-system-prompt-file"

setup() {
  setup_test_home
  # The real single owner of the launch flag set, reachable as a PATH command the
  # way ~/.local/bin exposes it - so the assertions bind to it, not a copy.
  ln -sf "$FUNCTIONS_DIR/claude-launch-flags" "$TEST_BIN/claude-launch-flags"
  # python3 stub: records the launch env instead of running handoff.
  write_stub python3 <<'EOF'
#!/usr/bin/env bash
printf 'ARGS=%s\n' "$*" >>"$TEST_LOG"
printf 'HANDOFF_CLAUDE_OPEN_ARGS=%s\n' "${HANDOFF_CLAUDE_OPEN_ARGS-<unset>}" >>"$TEST_LOG"
printf 'HANDOFF_CODEX_OPEN_ARGS=%s\n' "${HANDOFF_CODEX_OPEN_ARGS-<unset>}" >>"$TEST_LOG"
EOF
}

open_args() {
  sed -n 's/^HANDOFF_CLAUDE_OPEN_ARGS=//p' "$TEST_LOG"
}

@test "a run that opens Claude carries the launch baseline" {
  run_zsh_function "$WRAPPER" --from codex --to claude some-session-id

  [ "$status" -eq 0 ]
  [ "$(open_args)" = "$APPEND_FLAGS $HOME/.claude/system-append.md" ]
}

@test "the --to=claude spelling is recognised too" {
  run_zsh_function "$WRAPPER" --from codex --to=claude some-session-id

  [ "$status" -eq 0 ]
  [ "$(open_args)" = "$APPEND_FLAGS $HOME/.claude/system-append.md" ]
}

@test "posture is the caller's: the baseline adds no skip-permissions" {
  run_zsh_function "$WRAPPER" --from codex --to claude some-session-id

  [ "$status" -eq 0 ]
  [[ "$(open_args)" != *"dangerously-skip-permissions"* ]]
}

@test "a caller-set value is extended, not replaced" {
  HANDOFF_CLAUDE_OPEN_ARGS="--dangerously-skip-permissions" \
    run_zsh_function "$WRAPPER" --from codex --to claude some-session-id

  [ "$status" -eq 0 ]
  [ "$(open_args)" = "--dangerously-skip-permissions $APPEND_FLAGS $HOME/.claude/system-append.md" ]
}

@test "a Codex target is left untouched - there is no Codex baseline" {
  run_zsh_function "$WRAPPER" --from claude --to codex some-session-id

  [ "$status" -eq 0 ]
  [ -z "$(open_args)" ]
  grep -q "^HANDOFF_CODEX_OPEN_ARGS=<unset>$" "$TEST_LOG"
}

@test "a caller-set Codex posture survives a Codex-target run" {
  HANDOFF_CODEX_OPEN_ARGS="--dangerously-bypass-approvals-and-sandbox" \
    run_zsh_function "$WRAPPER" --from claude --to codex some-session-id

  [ "$status" -eq 0 ]
  grep -q "^HANDOFF_CODEX_OPEN_ARGS=--dangerously-bypass-approvals-and-sandbox$" "$TEST_LOG"
}

@test "--no-open has no launch to dress, so no baseline is applied" {
  run_zsh_function "$WRAPPER" --from codex --to claude some-session-id --no-open

  [ "$status" -eq 0 ]
  [ -z "$(open_args)" ]
}

@test "a subcommand never opens the target, so no baseline is applied" {
  run_zsh_function "$WRAPPER" convert some-session-id ./out --from codex --to claude

  [ "$status" -eq 0 ]
  [ -z "$(open_args)" ]
}

@test "the wrapper forwards its argv to the handoff module unchanged" {
  run_zsh_function "$WRAPPER" --from codex --to claude some-session-id

  [ "$status" -eq 0 ]
  grep -q "^ARGS=-m handoff --from codex --to claude some-session-id$" "$TEST_LOG"
}
