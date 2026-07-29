#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

# Exercises the tab/agent wiring in the REAL tmux.conf (window label formats,
# the @agent_dotfmt state→glyph mapping, and the seen-demotion hooks) against a throwaway tmux
# server, so a future conf edit that breaks them fails `mise run zsh-tests`.
CONF="$HOME/.config/tmux/tmux.conf"
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agenttabs_${BATS_TEST_NUMBER}_$$"
  # -f /dev/null: start bare, then source ONLY the curated agent.conf below. Without
  # it the server would also load the whole real tmux.conf, defeating the isolation
  # this test exists for (the unrelated base hooks the next comment says it excludes).
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 120 -y 12
  conf="$BATS_TEST_TMPDIR/agent.conf"
  # Isolate the tab additions: label formats, dot mapping and the seen hooks.
  # Navigation uses stable indexed hooks so reloads replace rather than append;
  # client-focus-in remains a scalar hook.
  grep -E '^set -g @agent_dotfmt |^set -g window-status(-current)?-format |^set-hook -g '\''(after-select-pane|session-window-changed)\[[0-9]+\]'\'' |^set-hook -g client-focus-in ' "$CONF" >"$conf"
  tx source-file "$conf"
}

@test "navigation relies on native redraws while preserving seen hooks" {
  run grep -E '^set-hook -g (after-select-pane|session-window-changed) .*refresh-client -S' "$CONF"
  [ "$status" -eq 1 ]
  grep -Fq "set-hook -g 'after-select-pane[100]' \"if -F" "$CONF"
  grep -Fq "set-hook -g 'session-window-changed[100]' \"if -F" "$CONF"
}

@test "navigation hooks stay singular across config reloads" {
  tx source-file "$conf"

  run tx show-hooks -g after-select-pane
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c 'agent-state.sh seen')" -eq 1 ]
  [[ "$output" != *"refresh-client -S"* ]]

  run tx show-hooks -g session-window-changed
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c 'agent-state.sh seen')" -eq 1 ]
  [[ "$output" != *"refresh-client -S"* ]]
}

@test "custom mode indicator uses recursive native option expansion" {
  script="$HOME/.config/tmux/tmux-mode-indicator.tmux"
  grep -Fq 'custom_prompt="#{E:$custom_prompt_config}"' "$script"
  grep -Fq 'custom_style="#{E:$custom_mode_style_config}"' "$script"
  run grep -F '#(tmux show-option -qv @mode_indicator_custom_' "$script"
  [ "$status" -eq 1 ]
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

dot() { tx list-windows -t s -F '#{E:@agent_dotfmt}'; }

assert_tab_label() {
  local target=$1
  local expected=$2
  local unexpected=$3
  local option rendered

  for option in window-status-format window-status-current-format; do
    rendered="$(tx display-message -p -t "$target" "#{T:$option}")"
    [[ "$rendered" == *"$expected"* ]]
    [[ "$rendered" != *"$unexpected"* ]]
  done
}

@test "blocked maps to a red diamond" {
  tx set-option -w -t s @win_agent_state blocked
  [[ "$(dot)" == *"#[fg=#f38ba8]◆"* ]]
}

@test "working is a peach half-dot (clears the yellow active-tab text)" {
  tx set-option -w -t s @win_agent_state working # sole window is active
  [[ "$(dot)" == *"#[fg=#fab387]◐"* ]]
}

@test "working stays peach on an unfocused tab (one colour per state)" {
  tx set-option -w -t s @win_agent_state working # window 1, currently active
  tx new-window -t s                             # window 2 active; window 1 inactive
  [[ "$(dot)" == *"#[fg=#fab387]◐"* ]]
}

@test "done maps to a blue filled dot" {
  tx set-option -w -t s @win_agent_state done
  [[ "$(dot)" == *"#[fg=#89b4fa]●"* ]]
}

@test "idle maps to a green hollow dot" {
  tx set-option -w -t s @win_agent_state idle
  [[ "$(dot)" == *"#[fg=#a6e3a1]○"* ]]
}

@test "no agent state renders nothing" {
  tx set-option -wu -t s @win_agent_state
  [ -z "$(dot)" ]
}

@test "automatic window tab labels render cwd basename" {
  dir="$BATS_TEST_TMPDIR/auto-project"
  mkdir -p "$dir"
  win="$(tx new-window -d -P -F '#{window_id}' -t s -c "$dir")"

  assert_tab_label "$win" "auto-project" "zsh"
}

@test "manual window tab labels render the window name" {
  dir="$BATS_TEST_TMPDIR/cwd-project"
  mkdir -p "$dir"
  win="$(tx new-window -d -P -F '#{window_id}' -t s -c "$dir")"
  tx rename-window -t "$win" "manual-name"

  assert_tab_label "$win" "manual-name" "cwd-project"
}

@test "resetting automatic-rename returns tab labels to cwd basename" {
  dir="$BATS_TEST_TMPDIR/cwd-project"
  mkdir -p "$dir"
  win="$(tx new-window -d -P -F '#{window_id}' -t s -c "$dir")"
  tx rename-window -t "$win" "manual-name"
  tx set-window-option -t "$win" automatic-rename on

  assert_tab_label "$win" "cwd-project" "manual-name"
}

# The navigation commands below return non-zero headlessly (tmux's hook dispatch
# emits "no current client" with no client attached); the demotion side-effect
# still happens, so we assert the resulting state, not the command's exit code.
@test "after-select-pane ages a done pane to idle" {
  tx split-window -t s
  set -- $(tx list-panes -t s -F '#{pane_id}')
  p1=$1
  p2=$2
  tx set-option -p -t "$p1" @agent_state done
  tx select-pane -t "$p2" || true
  tx select-pane -t "$p1" || true
  sleep 0.3
  [ "$(tx show-options -pqv -t "$p1" @agent_state)" = idle ]
}

@test "session-window-changed ages a done pane to idle" {
  w1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$w1" @agent_state done
  tx new-window -t s
  tx select-window -t "$(tx display-message -p -t "$w1" '#{window_id}')" || true
  sleep 0.3
  [ "$(tx show-options -pqv -t "$w1" @agent_state)" = idle ]
}

# client-focus-in fires on a real terminal focus event, which cannot be driven
# headlessly, so assert tmux actually REGISTERED the hook bound to `seen`. This
# guards the tmux 3.7b trap: `pane-focus-in` is accepted but never stored as a
# global hook, so reverting this to pane-focus-in would silently stop ageing a
# `done` pane you regain focus on without navigating.
@test "client-focus-in is registered to age panes via seen" {
  line="$(tx show-hooks -g | grep client-focus-in || true)"
  [ -n "$line" ]
  [[ "$line" == *"agent-state.sh seen"* ]]
}

@test "status row carries session rail and pane header control ranges" {
  row="$(grep "^set -g 'status-format\\[1\\]'" "$CONF")"
  border="$(grep '^set -g pane-border-format' "$CONF")"
  [[ "$row" == *"#{S:"* ]]
  [[ "$row" == *"range=session|#{session_id}"* ]]
  [[ "$row" == *"list=focus"* ]]
  [[ "$row" == *"#{E:@session_agent_attention_fmt}"* ]]
  [[ "$row" == *"#{E:@session_agent_attention_current_fmt}"* ]]
  [[ "$border" == *"range=control|7"* ]]
  [[ "$border" == *"range=control|8"* ]]
}

@test "pane and window topology hooks reconcile cached agent rollups" {
  for hook in after-kill-pane after-split-window window-linked window-unlinked; do
    line="$(grep "set-hook -g '$hook\[100\]'" "$CONF")"
    [[ "$line" == *"agent-sweep.sh sync"* ]]
  done
}

@test "session cycle bindings follow the session rail's creation order" {
  grep -Fq 'bind -N "Previous session (rail order)" -n C-M-h switch-client -p -O creation' "$CONF"
  grep -Fq 'bind -N "Next session (rail order)" -n C-M-l switch-client -n -O creation' "$CONF"
  grep -Fq 'bind -T copy-mode-vi C-M-h switch-client -p -O creation' "$CONF"
  grep -Fq 'bind -T copy-mode-vi C-M-l switch-client -n -O creation' "$CONF"
  grep -Fq 'bind -N "Previous session (rail order)" '\''('\'' switch-client -p -O creation' "$CONF"
  grep -Fq 'bind -N "Next session (rail order)" '\'')'\'' switch-client -n -O creation' "$CONF"
  grep -Fq 'bind -N "Session switch/create popup (fzf)" -n M-S display-popup' "$CONF"
  grep -Fq 'bind -T copy-mode-vi M-S display-popup' "$CONF"
}

@test "window move mode has persistent movement and explicit exits" {
  grep -Fq 'bind -N "Enter window move mode" -n M-M switch-client -T window-move \; display-message "Move window: h/l, q/Esc exits"' "$CONF"
  grep -Fq 'bind -T copy-mode-vi M-M switch-client -T window-move \; display-message "Move window: h/l, q/Esc exits"' "$CONF"
  grep -Fq 'bind -T window-move h swap-window -t -1 \; previous-window \; switch-client -T window-move \; display-message "Move window: h/l, q/Esc exits"' "$CONF"
  grep -Fq 'bind -T window-move l swap-window -t +1 \; next-window \; switch-client -T window-move \; display-message "Move window: h/l, q/Esc exits"' "$CONF"
  grep -Fq 'bind -T window-move q switch-client -T root' "$CONF"
  grep -Fq 'bind -T window-move Escape switch-client -T root' "$CONF"
  ! grep -Fq 'C-M-H swap-window' "$CONF"
  ! grep -Fq 'C-M-L swap-window' "$CONF"
}

@test "window move mode repeats, follows the window, wraps, and exits" {
  grep -E 'window-move|Enter window move mode' "$CONF" >"$BATS_TEST_TMPDIR/window-move.conf"
  tx source-file "$BATS_TEST_TMPDIR/window-move.conf"
  tx rename-window -t s:0 one
  tx new-window -d -a -t s:one -n two
  tx new-window -d -a -t s:two -n three
  tx select-window -t s:one

  mkfifo "$BATS_TEST_TMPDIR/client.in"
  exec 9<>"$BATS_TEST_TMPDIR/client.in"
  (
    exec 9>&-
    "$TMUX_BIN" -L "$SOCK" -C attach-session -t s <"$BATS_TEST_TMPDIR/client.in" >"$BATS_TEST_TMPDIR/client.out"
  ) &
  client_pid=$!
  wait_until '[ -n "$(tx list-clients -F "#{client_name}" 2>/dev/null)" ]'
  client="$(tx list-clients -F '#{client_name}' 2>/dev/null | head -1)"
  [ -n "$client" ]
  [ "$(tx display-message -p -c "$client" '#W')" = one ]
  initial_order="$(tx list-windows -t s -F '#W' | paste -sd, -)"
  [ "$(tx display-message -p -c "$client" '#{window_index}')" = 0 ]

  tx send-keys -K -c "$client" M-M
  [ "$(tx display-message -p -c "$client" '#{client_key_table}')" = window-move ]

  tx send-keys -K -c "$client" h
  [ "$(tx display-message -p -c "$client" '#W')" = one ]
  [ "$(tx display-message -p -c "$client" '#{window_index}')" = 2 ]
  [ "$(tx display-message -p -c "$client" '#{client_key_table}')" = window-move ]

  tx send-keys -K -c "$client" h
  [ "$(tx display-message -p -c "$client" '#W')" = one ]
  [ "$(tx display-message -p -c "$client" '#{window_index}')" = 1 ]
  [ "$(tx display-message -p -c "$client" '#{client_key_table}')" = window-move ]

  tx send-keys -K -c "$client" l l
  [ "$(tx display-message -p -c "$client" '#W')" = one ]
  [ "$(tx display-message -p -c "$client" '#{window_index}')" = 0 ]
  [ "$(tx list-windows -t s -F '#W' | paste -sd, -)" = "$initial_order" ]
  [ "$(tx display-message -p -c "$client" '#{client_key_table}')" = window-move ]

  tx send-keys -K -c "$client" Escape
  [ "$(tx display-message -p -c "$client" '#{client_key_table}')" = root ]
  tx send-keys -K -c "$client" M-M q
  [ "$(tx display-message -p -c "$client" '#{client_key_table}')" = root ]
  exec 9>&-
  wait "$client_pid" 2>/dev/null || true
}
