#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

SKILLSYNC="$FUNCTIONS_DIR/skillsync"

setup() {
  setup_test_home
  mkdir -p "$HOME/.agents/skills/git-skill" "$HOME/.agents/skills/tmux-skill"
}

@test "creates per-agent skill symlinks from canonical skills" {
  run_zsh_function "$SKILLSYNC"

  [ "$status" -eq 0 ]
  assert_symlink_target "$HOME/.claude/skills/git-skill" "../../.agents/skills/git-skill"
  assert_symlink_target "$HOME/.codex/skills/tmux-skill" "../../.agents/skills/tmux-skill"
}

@test "removes a legacy directory symlink before creating skill links" {
  mkdir -p "$HOME/.legacy-skills"
  mkdir -p "$HOME/.codex"
  ln -s "$HOME/.legacy-skills" "$HOME/.codex/skills"

  run_zsh_function "$SKILLSYNC"

  [ "$status" -eq 0 ]
  [ -d "$HOME/.codex/skills" ]
  [ ! -L "$HOME/.codex/skills" ]
  assert_symlink_target "$HOME/.codex/skills/git-skill" "../../.agents/skills/git-skill"
}

@test "dry-run reports planned links without writing them" {
  run_zsh_function "$SKILLSYNC" --dry-run --verbose

  [ "$status" -eq 0 ]
  [[ "$output" == *"Creating: $HOME/.claude/skills/git-skill -> ../../.agents/skills/git-skill"* ]]
  [ ! -e "$HOME/.claude/skills/git-skill" ]
}
