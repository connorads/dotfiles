#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

# The state → glyph + colour mapping is rendered three ways: the tab dots
# (@agent_dotfmt), the prefix+Alt+. menu literals, and the prefix+A popup. They
# drifted once because nothing enforced agreement. agent-state-lib.sh is now the
# single source of truth; this suite derives EVERY expectation from the lib
# (agent_hex/agent_char/agent_glyph), so it hardcodes no colours/glyphs and stays
# pure ASCII — change the lib and every renderer must follow or this fails.
LIB="$HOME/.config/tmux/scripts/agent-state-lib.sh"
CONF="$HOME/.config/tmux/tmux.conf"
POPUP="$HOME/.config/tmux/scripts/agent-popup.sh"

# shellcheck disable=SC1090
. "$LIB"

tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agentglyphs_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 120 -y 24
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

# A — tab dots: source the real @agent_dotfmt into a throwaway server and read its
# expansion per state. "unknown" exercises the format's grey-· fallback branch.
@test "tab dots (@agent_dotfmt) match the canonical mapping" {
  conf="$BATS_TEST_TMPDIR/dot.conf"
  grep -E '^set -g @agent_dotfmt ' "$CONF" >"$conf"
  tx source-file "$conf"
  for state in blocked working done idle unknown; do
    tx set-option -w -t s @win_agent_state "$state"
    want="#[fg=#$(agent_hex "$state")]$(agent_char "$state")"
    got=$(tx list-windows -t s -F '#{E:@agent_dotfmt}')
    [[ "$got" == *"$want"* ]]
  done
}

# B — menu literals: the only automated guard on the static prefix+Alt+. items.
# unread shows the done/blue glyph; clear has no glyph so it is not checked.
@test "state menu literals match the canonical mapping" {
  for pair in "working:working" "blocked:blocked" "unread:done" "idle:idle"; do
    label=${pair%:*}
    state=${pair#*:}
    line=$(grep -E "^  \"$label " "$CONF")
    [ -n "$line" ]
    want="#[fg=#$(agent_hex "$state")]$(agent_char "$state")"
    [[ "$line" == *"$want"* ]]
  done
}

# C — popup: one pane per state in a private server, then assert the rendered
# list carries each state's full truecolour glyph (sweeper no-op'd).
@test "popup list glyphs match the canonical mapping" {
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
  export AGENT_SWEEP=/nonexistent
  first=1
  for state in blocked working done idle unknown; do
    [ "$first" = 1 ] && first=0 || tx new-window -t s
    p=$(tx display-message -p -t s '#{pane_id}')
    tx set-option -p -t "$p" @agent_state "$state"
  done
  run sh "$POPUP" list
  [ "$status" -eq 0 ]
  for state in blocked working done idle unknown; do
    want="$(agent_glyph "$state")"
    [[ "$output" == *"$want"* ]]
  done
}
