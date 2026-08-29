#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# quarantine-drift precedent: no setup_test_home. The point is asserting the
# REAL tracked ~/.zshenv reaches the real generated hm-session-vars.sh, so the
# test runs against real $HOME.
ZSHENV="$REAL_HOME/.zshenv"
HOME_SHARED="$REAL_HOME/.config/nix/modules/home-shared.nix"

# The two layouts home-manager writes hm-session-vars.sh under: standalone
# (~/.nix-profile) and nix-darwin module (/etc/profiles/per-user/$USER).
hm_vars_present() {
  [ -f "$REAL_HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" ] ||
    [ -f "/etc/profiles/per-user/$(id -un)/etc/profile.d/hm-session-vars.sh" ]
}

# The value home-shared.nix declares for a session variable, so the test asserts
# the declaration reaches the shell rather than a hard-coded editor name.
declared() {
  sed -n "s/^[[:space:]]*$1 = \"\(.*\)\";\$/\1/p" "$HOME_SHARED" | head -1
}

# `zsh -f` unsets RCS, and nix-darwin's /etc/zshenv body is wrapped in
# `if [[ -o rcs ]]`, so its `EDITOR=nano` default is not in play. Unsetting both
# vars first stops an inherited value faking a pass. What survives is what
# ~/.zshenv itself exported.
#
# `__HM_SESS_VARS_SOURCED` is the generated file's own self-guard, and it is
# exported - so any shell whose ancestor already read ~/.zshenv passes it down
# and the source becomes a no-op. Every shell bats runs under is such a shell.
# Clearing it is what makes this subshell behave like a fresh login shell
# rather than measuring the guard.
zshenv_var() {
  env -u EDITOR -u VISUAL -u __HM_SESS_VARS_SOURCED \
    zsh -f -c "source '$ZSHENV'; print -r -- \${$1}"
}

setup() {
  hm_vars_present || skip "no hm-session-vars.sh on this host"
}

@test ".zshenv exports the declared EDITOR" {
  run zshenv_var EDITOR
  [ "$status" -eq 0 ]
  [ "$output" = "$(declared EDITOR)" ]
}

@test ".zshenv exports the declared VISUAL" {
  run zshenv_var VISUAL
  [ "$status" -eq 0 ]
  [ "$output" = "$(declared VISUAL)" ]
}
