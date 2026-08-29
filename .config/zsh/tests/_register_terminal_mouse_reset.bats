#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

RESET=$'\033[?9l\033[?1000l\033[?1001l\033[?1002l\033[?1003l\033[?1005l\033[?1006l\033[?1015l\033[?1016l'

setup() {
  setup_test_home
  export ZDOTDIR="$BATS_TEST_TMPDIR/zdotdir"
  mkdir -p "$ZDOTDIR"
}

# $ZDOTDIR/.zshrc stands in for ~/.zshrc: it puts the real function dir on fpath
# and autoloads add-zsh-hook, which is all the wirings below need.
write_rc_preamble() {
  cat >"$ZDOTDIR/.zshrc" <<EOF
autoload -Uz add-zsh-hook
fpath=("$FUNCTIONS_DIR/shell" \$fpath)
EOF
}

# The production wiring: register the registrar, which arms the reset itself.
write_deferred_rc() {
  write_rc_preamble
  cat >>"$ZDOTDIR/.zshrc" <<'EOF'
autoload -Uz _register_terminal_mouse_reset terminal-mouse-reset
add-zsh-hook precmd _register_terminal_mouse_reset
EOF
}

# The wiring this replaced, kept so the defect stays pinned rather than recalled.
write_direct_rc() {
  write_rc_preamble
  cat >>"$ZDOTDIR/.zshrc" <<'EOF'
autoload -Uz terminal-mouse-reset
add-zsh-hook precmd terminal-mouse-reset
EOF
}

# The reset stubbed as a counter, so "armed" can be told apart from "fired".
# `++_hits` rather than `_hits++`: the post-increment form evaluates to 0 on the
# first call, which is a non-zero status out of a hook.
write_counter_rc() {
  write_rc_preamble
  cat >>"$ZDOTDIR/.zshrc" <<'EOF'
autoload -Uz _register_terminal_mouse_reset
typeset -g _hits=0
terminal-mouse-reset() { (( ++_hits )) }
add-zsh-hook precmd _register_terminal_mouse_reset
EOF
}

# `zsh -d -is` reading from a pipe runs one precmd before the first line and one
# after each, so prompts come from argument count rather than the clock. `-d`
# drops the global rc files, leaving $ZDOTDIR/.zshrc as the only wiring. With
# stdin not a tty ZLE is off and zsh writes the prompt to stderr, so stdout
# carries hook and command output only.
drive_prompts() {
  printf '%s\n' "$@" | zsh -d -is 2>/dev/null
}

@test "nothing is written at the first prompt, and the reset fires at every later one" {
  write_deferred_rc

  run drive_prompts 'print -rn -- .' 'print -rn -- .'

  [ "$status" -eq 0 ]
  [ "$output" = ".$RESET.$RESET" ]
}

@test "registering the reset directly writes before the first prompt" {
  write_direct_rc

  run drive_prompts 'print -rn -- .' 'print -rn -- .'

  [ "$status" -eq 0 ]
  [ "$output" = "$RESET.$RESET.$RESET" ]
}

@test "the hook is armed by name at the first prompt but has not run" {
  write_counter_rc

  run drive_prompts \
    'print -r -- "hits=$_hits armed=$(( ${precmd_functions[(I)terminal-mouse-reset]} > 0 ))"' \
    'print -r -- "hits=$_hits armed=$(( ${precmd_functions[(I)terminal-mouse-reset]} > 0 ))"'

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "hits=0 armed=1" ]
  [ "${lines[1]}" = "hits=1 armed=1" ]
}
