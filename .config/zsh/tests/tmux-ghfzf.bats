#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

TMUX_DIR="$TESTS_DIR/../../tmux"

@test "Alt-g opens the GitHub menu with ghfzf triage and commit review lives in Tools" {
  grep -F 'bind -N "GitHub menu · ghfzf gh-dash ghui oyo" M-g display-menu' "$TMUX_DIR/tmux.conf"
  grep -F '"review · oyo"        o' "$TMUX_DIR/tmux.conf"
  grep -F 'big zsh -c' "$TMUX_DIR/tmux.conf" | grep -F 'scripts/oyo.sh'
  grep -F 'ghfzf --tmux-popup' "$TMUX_DIR/tmux.conf"
  run ! grep -F 'bind -N "Review commits (critique)" M-g' "$TMUX_DIR/tmux.conf"

  grep -F $'Git: review commits (critique)\treview; echo; print -n "Press any key..."; read -sk1' "$TMUX_DIR/tools.tsv"
}

@test "help and tmux AGENTS document the ghfzf binding" {
  grep -F '| `Ctrl+b Alt+g` | GitHub menu (ghfzf triage · gh-dash · ghui · `o` Oyo current PR/local review) |' "$TMUX_DIR/help.md"
  # The Tools row summarises tools.tsv in prose, so assert the items this
  # test guards moved there - not the whole enumeration, which rots on
  # every tools.tsv addition.
  tools_row=$(grep -F '| `Ctrl+b T` | Tools launcher' "$TMUX_DIR/help.md")
  [[ $tools_row == *'Git review'* ]]
  [[ $tools_row == *'claude-watch'* ]]
  [[ $tools_row == *'Claude plan viewer'* ]]
  [[ $tools_row == *'tpm-clean'* ]]

  grep -F '`M-g` ghfzf' "$TMUX_DIR/AGENTS.md"
}
