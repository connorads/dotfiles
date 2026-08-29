#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# zshenv.bats precedent: no setup_test_home. The point is asserting the REAL
# tracked ~/.zshrc keeps its first-prompt stdout empty, so the test reads the
# real file rather than a fixture.
#
# Both assertions guard the same invariant from opposite ends: powerlevel10k's
# instant-prompt preamble redirects stdout to a capture file, and whatever
# survives its stripping raises "Console output during zsh initialization
# detected". So nothing may write below that preamble at the first prompt, and
# anything that must stay visible has to sit above it.
ZSHRC="$REAL_HOME/.zshrc"

# 1-indexed line of the first match, or empty when there is none.
line_of() {
  grep -n -m1 -- "$1" "$ZSHRC" | cut -d: -f1
}

@test ".zshrc arms the mouse-mode reset through its deferring registrar" {
  run grep -qx 'add-zsh-hook precmd _register_terminal_mouse_reset' "$ZSHRC"
  [ "$status" -eq 0 ]
}

@test ".zshrc does not register the mouse-mode reset on precmd directly" {
  run grep -qx 'add-zsh-hook precmd terminal-mouse-reset' "$ZSHRC"
  [ "$status" -ne 0 ]
}

@test ".zshrc reports stale patch markers above the instant-prompt preamble" {
  local loop preamble
  loop=$(line_of '^for _stale in ')
  preamble=$(line_of 'p10k-instant-prompt')

  [ -n "$loop" ]
  [ -n "$preamble" ]
  [ "$loop" -lt "$preamble" ]
}
