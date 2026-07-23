#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

MATERIALISE="$FUNCTIONS_DIR/claude-profile-materialise"

# Make a real tool (jq) discoverable on the test PATH via a TEST_BIN symlink, so
# the helper's `command -v jq` / merge run under the hermetic HOME.
link_real() {
  local name=$1 real
  real="$(command -v "$name" 2>/dev/null)" || return 0
  ln -sf "$real" "$TEST_BIN/$name"
}

# Seed a shared ~/.claude with a settings.json carrying dotfiles-managed user
# config plus a model (which base must strip) and a CLAUDE.md memory file.
seed_shared_config() {
  mkdir -p "$HOME/.claude"
  cat >"$HOME/.claude/settings.json" <<'EOF'
{
  "model": "shared-model",
  "statusLine": {"type": "command", "command": "statusline"},
  "hooks": {
    "Stop": [{"hooks": [{"type": "command", "command": "agent-state.sh"}]}],
    "SessionStart": [{"hooks": [{"type": "command", "command": "sh ~/.config/tmux/scripts/claude-profile-tag.sh"}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "sh ~/.config/tmux/scripts/claude-profile-tag.sh clear || true"}]}]
  }
}
EOF
  printf '@.agents/AGENTS.md\n' >"$HOME/.claude/CLAUDE.md"
}

setup() {
  setup_test_home
  link_real jq
  # Build the profile path via a var so no concrete .claude-profiles path is
  # committed (claude-profile-leak-guard), matching the resurrect tests.
  local acct=work
  PROFILE_DIR="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$PROFILE_DIR"
}

@test "materialise inherits shared statusLine and hooks into the profile" {
  seed_shared_config

  run_zsh_function "$MATERIALISE" "$PROFILE_DIR"

  [ "$status" -eq 0 ]
  run jq -r '.statusLine.command' "$PROFILE_DIR/settings.json"
  [ "$output" = "statusline" ]
  run jq -r '.hooks.Stop[0].hooks[0].command' "$PROFILE_DIR/settings.json"
  [ "$output" = "agent-state.sh" ]
}

@test "materialise inherits the SessionStart/End profile-tag hooks into the profile" {
  seed_shared_config

  run_zsh_function "$MATERIALISE" "$PROFILE_DIR"

  [ "$status" -eq 0 ]
  # Every ccp account inherits the pane-border tag hooks, so a resumed/restored
  # session re-tags its pane regardless of how it was launched.
  run jq -r '.hooks.SessionStart[0].hooks[0].command' "$PROFILE_DIR/settings.json"
  [[ "$output" == *"claude-profile-tag.sh"* ]]
  run jq -r '.hooks.SessionEnd[0].hooks[0].command' "$PROFILE_DIR/settings.json"
  [[ "$output" == *"claude-profile-tag.sh clear"* ]]
}

@test "materialise preserves a per-account model and theme the base does not define" {
  seed_shared_config
  cat >"$PROFILE_DIR/settings.json" <<'EOF'
{"model": "account-model", "theme": "dark"}
EOF

  run_zsh_function "$MATERIALISE" "$PROFILE_DIR"

  [ "$status" -eq 0 ]
  run jq -r '.model' "$PROFILE_DIR/settings.json"
  [ "$output" = "account-model" ]
  run jq -r '.theme' "$PROFILE_DIR/settings.json"
  [ "$output" = "dark" ]
}

@test "materialise never leaks the shared model into a fresh profile" {
  seed_shared_config

  run_zsh_function "$MATERIALISE" "$PROFILE_DIR"

  [ "$status" -eq 0 ]
  run jq -r 'has("model")' "$PROFILE_DIR/settings.json"
  [ "$output" = "false" ]
}

@test "materialise symlinks CLAUDE.md at the shared memory file" {
  seed_shared_config

  run_zsh_function "$MATERIALISE" "$PROFILE_DIR"

  [ "$status" -eq 0 ]
  assert_symlink_target "$PROFILE_DIR/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
}

@test "materialise is idempotent" {
  seed_shared_config

  run_zsh_function "$MATERIALISE" "$PROFILE_DIR"
  [ "$status" -eq 0 ]
  local first
  first="$(cat "$PROFILE_DIR/settings.json")"

  run_zsh_function "$MATERIALISE" "$PROFILE_DIR"
  [ "$status" -eq 0 ]
  [ "$(cat "$PROFILE_DIR/settings.json")" = "$first" ]
}

@test "materialise fails open when jq is absent, leaving settings untouched" {
  seed_shared_config
  cat >"$PROFILE_DIR/settings.json" <<'EOF'
{"theme": "light"}
EOF
  # jq is reachable via both the nix bin dir (shared with zsh) and /usr/bin, so
  # dropping the TEST_BIN symlink is not enough. Link zsh + ln into TEST_BIN and
  # restrict PATH to dirs with no jq, so the child shell finds no jq at all.
  link_real zsh
  link_real ln
  rm -f "$TEST_BIN/jq"
  PATH="$TEST_BIN" run_zsh_function "$MATERIALISE" "$PROFILE_DIR"

  [ "$status" -eq 0 ]
  # Merge skipped: the existing per-account file is untouched.
  [ "$(cat "$PROFILE_DIR/settings.json")" = '{"theme": "light"}' ]
  # Symlink still created (independent of jq).
  assert_symlink_target "$PROFILE_DIR/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
}

@test "materialise is a no-op merge when no shared settings.json exists" {
  mkdir -p "$HOME/.claude"
  printf '@.agents/AGENTS.md\n' >"$HOME/.claude/CLAUDE.md"

  run_zsh_function "$MATERIALISE" "$PROFILE_DIR"

  [ "$status" -eq 0 ]
  [ ! -f "$PROFILE_DIR/settings.json" ]
  assert_symlink_target "$PROFILE_DIR/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
}
