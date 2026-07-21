#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

DESKTOP_PROFILE="$FUNCTIONS_DIR/claude-desktop-profile"
CODE_PROFILE="$FUNCTIONS_DIR/claude-code-profile"
MATERIALISE="$FUNCTIONS_DIR/claude-profile-materialise"

# Make a real tool discoverable on the test PATH via a TEST_BIN symlink.
link_real() {
  local name=$1 real
  real="$(command -v "$name" 2>/dev/null)" || return 0
  ln -sf "$real" "$TEST_BIN/$name"
}

setup() {
  setup_test_home
}

@test "claude-desktop-profile launches Claude.app with a per-profile user-data-dir" {
  write_stub open <<'EOF'
#!/usr/bin/env bash
printf '<%s>\n' "$@"
EOF

  run_zsh_function "$DESKTOP_PROFILE" work --foo bar

  [ "$status" -eq 0 ]
  [[ "$output" == *"<-n>"* ]]
  [[ "$output" == *"<-a>"* ]]
  [[ "$output" == *"</Applications/Claude.app>"* ]]
  [[ "$output" == *"<--args>"* ]]
  [[ "$output" == *"<--user-data-dir=$HOME/.claude-profiles/desktop/work>"* ]]
  [[ "$output" == *"<--foo>"* ]]
  [[ "$output" == *"<bar>"* ]]
  [ -d "$HOME/.claude-profiles/desktop/work" ]
}

@test "claude-desktop-profile rejects names with slashes" {
  write_stub open <<'EOF'
#!/usr/bin/env bash
echo "should not run"
exit 99
EOF

  run_zsh_function "$DESKTOP_PROFILE" ../work

  [ "$status" -eq 2 ]
  [[ "$output" == *"profile name must match"* ]]
}

@test "claude-code-profile sets CLAUDE_CONFIG_DIR and clears ambient auth overrides" {
  write_stub claude <<'EOF'
#!/usr/bin/env bash
printf 'CLAUDE_CONFIG_DIR:%s\n' "${CLAUDE_CONFIG_DIR-unset}"
printf 'ANTHROPIC_API_KEY:%s\n' "${ANTHROPIC_API_KEY-unset}"
printf 'ANTHROPIC_AUTH_TOKEN:%s\n' "${ANTHROPIC_AUTH_TOKEN-unset}"
printf 'CLAUDE_CODE_OAUTH_TOKEN:%s\n' "${CLAUDE_CODE_OAUTH_TOKEN-unset}"
printf 'CLAUDE_CODE_USE_BEDROCK:%s\n' "${CLAUDE_CODE_USE_BEDROCK-unset}"
printf 'CLAUDE_CODE_USE_VERTEX:%s\n' "${CLAUDE_CODE_USE_VERTEX-unset}"
printf 'CLAUDE_CODE_USE_FOUNDRY:%s\n' "${CLAUDE_CODE_USE_FOUNDRY-unset}"
printf 'ARGS:%s\n' "$*"
EOF
  export ANTHROPIC_API_KEY=sk-ant-test
  export ANTHROPIC_AUTH_TOKEN=auth-test
  export CLAUDE_CODE_OAUTH_TOKEN=oauth-test
  export CLAUDE_CODE_USE_BEDROCK=1
  export CLAUDE_CODE_USE_VERTEX=1
  export CLAUDE_CODE_USE_FOUNDRY=1

  run_zsh_function "$CODE_PROFILE" work --version

  [ "$status" -eq 0 ]
  [[ "$output" == *"CLAUDE_CONFIG_DIR:$HOME/.claude-profiles/code/work"* ]]
  [[ "$output" == *"ANTHROPIC_API_KEY:unset"* ]]
  [[ "$output" == *"ANTHROPIC_AUTH_TOKEN:unset"* ]]
  [[ "$output" == *"CLAUDE_CODE_OAUTH_TOKEN:unset"* ]]
  [[ "$output" == *"CLAUDE_CODE_USE_BEDROCK:unset"* ]]
  [[ "$output" == *"CLAUDE_CODE_USE_VERTEX:unset"* ]]
  [[ "$output" == *"CLAUDE_CODE_USE_FOUNDRY:unset"* ]]
  [[ "$output" == *"ARGS:--version"* ]]
  [ -d "$HOME/.claude-profiles/code/work" ]
}

@test "claude-code-profile materialises shared settings into the profile" {
  # Wire the real helper + jq onto PATH so the bare-name call runs the real
  # merge (a stub would mirror-test the wiring and stay green if merge broke).
  ln -sf "$MATERIALISE" "$TEST_BIN/claude-profile-materialise"
  link_real jq
  mkdir -p "$HOME/.claude"
  cat >"$HOME/.claude/settings.json" <<'EOF'
{"model": "shared-model", "statusLine": {"type": "command", "command": "statusline"}}
EOF
  write_stub claude <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  local acct=work
  run_zsh_function "$CODE_PROFILE" "$acct" --version

  [ "$status" -eq 0 ]
  run jq -r '.statusLine.command' "$HOME/.claude-profiles/code/$acct/settings.json"
  [ "$output" = "statusline" ]
  run jq -r 'has("model")' "$HOME/.claude-profiles/code/$acct/settings.json"
  [ "$output" = "false" ]
}

@test "claude-code-profile rejects names with slashes" {
  write_stub claude <<'EOF'
#!/usr/bin/env bash
echo "should not run"
exit 99
EOF

  run_zsh_function "$CODE_PROFILE" ../work

  [ "$status" -eq 2 ]
  [[ "$output" == *"profile name must match"* ]]
}
