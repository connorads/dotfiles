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

@test "prune removes symlinks whose canonical source is gone" {
  run_zsh_function "$SKILLSYNC"
  [ "$status" -eq 0 ]

  # Simulate a removed skill: its per-agent symlinks now dangle.
  rm -rf "$HOME/.agents/skills/git-skill"

  run_zsh_function "$SKILLSYNC" --prune

  [ "$status" -eq 0 ]
  [ ! -L "$HOME/.claude/skills/git-skill" ]
  [ ! -e "$HOME/.claude/skills/git-skill" ]
  # The surviving skill's link is left intact.
  assert_symlink_target "$HOME/.claude/skills/tmux-skill" "../../.agents/skills/tmux-skill"
}

@test "prune leaves live links and real directories untouched" {
  run_zsh_function "$SKILLSYNC"
  [ "$status" -eq 0 ]

  # A real (non-symlink) skill dir living directly in an agent dir.
  mkdir -p "$HOME/.codex/skills/local-only"

  run_zsh_function "$SKILLSYNC" --prune

  [ "$status" -eq 0 ]
  [ -d "$HOME/.codex/skills/local-only" ]
  [ ! -L "$HOME/.codex/skills/local-only" ]
  assert_symlink_target "$HOME/.codex/skills/git-skill" "../../.agents/skills/git-skill"
}

@test "prune dry-run reports removals without deleting" {
  run_zsh_function "$SKILLSYNC"
  [ "$status" -eq 0 ]

  rm -rf "$HOME/.agents/skills/git-skill"

  run_zsh_function "$SKILLSYNC" --prune --dry-run

  [ "$status" -eq 0 ]
  [[ "$output" == *"Pruning: $HOME/.claude/skills/git-skill"* ]]
  # Still present (and still dangling) because nothing was written.
  [ -L "$HOME/.claude/skills/git-skill" ]
  [ ! -e "$HOME/.claude/skills/git-skill" ]
}

@test "prune works when the canonical dir is empty" {
  run_zsh_function "$SKILLSYNC"
  [ "$status" -eq 0 ]

  # Empty the autoload set entirely (the real-world end state).
  rm -rf "$HOME/.agents/skills"/*

  run_zsh_function "$SKILLSYNC" --prune

  [ "$status" -eq 0 ]
  [ ! -e "$HOME/.claude/skills/git-skill" ]
  [ ! -e "$HOME/.codex/skills/tmux-skill" ]
}
