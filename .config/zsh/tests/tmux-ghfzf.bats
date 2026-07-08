#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

TMUX_DIR="$TESTS_DIR/../../tmux"

@test "Alt-g launches ghfzf and commit review lives in Tools" {
  grep -F 'bind -N "GitHub triage · ghfzf pr issue run" M-g display-popup' "$TMUX_DIR/tmux.conf"
  grep -F 'zsh -ic "ghfzf --tmux-popup"' "$TMUX_DIR/tmux.conf"
  ! grep -F 'bind -N "Review commits (critique)" M-g' "$TMUX_DIR/tmux.conf"

  grep -F $'Git: review commits (critique)\treview; echo; print -n "Press any key..."; read -sk1' "$TMUX_DIR/tools.tsv"
}

@test "help and tmux AGENTS document the ghfzf binding" {
  grep -F '| `Ctrl+b Alt+g` | GitHub triage (ghfzf: PRs, issues, Actions runs) |' "$TMUX_DIR/help.md"
  grep -F '| `Ctrl+b T` | Tools launcher (fzf: tmux join-all/burst, Git review, claude-watch, connections, ports, pclose, bandwhich, tsp, tpm-clean) |' "$TMUX_DIR/help.md"

  grep -F '`M-g` ghfzf' "$TMUX_DIR/AGENTS.md"
}
