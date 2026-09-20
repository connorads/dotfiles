#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

FN="$FUNCTIONS_DIR/macos/pedal-flash"

setup() {
  setup_test_home
  # Stub footswitch: log every argv line, answer -r from a canned readback file.
  write_stub footswitch <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >>"$HOME/calls"
if [ "$1" = "-r" ]; then
  cat "$HOME/readback"
fi
exit 0
STUB
  printf '[switch 1]: esc\n[switch 2]: r_alt\n[switch 3]: enter\n' >"$HOME/readback"
}

@test "default flashes esc / r_alt / enter then reads back and exits 0" {
  run_zsh_function "$FN"
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$HOME/calls")" = "-1 -k esc -2 -m r_alt -3 -k enter" ]
  [ "$(sed -n 2p "$HOME/calls")" = "-r" ]
  [ "$(wc -l <"$HOME/calls" | tr -d ' ')" = "2" ]
  [[ "$output" == *"[switch 2]: r_alt"* ]]
}

@test "readback mismatch exits 1 naming the pedal" {
  printf '[switch 1]: esc\n[switch 2]: b\n[switch 3]: enter\n' >"$HOME/readback"
  run_zsh_function "$FN"
  [ "$status" -eq 1 ]
  [[ "$output" == *"pedal 2 reads back 'b', expected 'r_alt'"* ]]
}

@test "--read sends only -r" {
  run_zsh_function "$FN" --read
  [ "$status" -eq 0 ]
  [ "$(cat "$HOME/calls")" = "-r" ]
  [[ "$output" == *"[switch 1]: esc"* ]]
}

@test "--dry-run prints the command and calls nothing" {
  run_zsh_function "$FN" --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"footswitch -1 -k esc -2 -m r_alt -3 -k enter"* ]]
  [ ! -e "$HOME/calls" ]
}

@test "footswitch absent exits 1 naming the nix package" {
  rm "$TEST_BIN/footswitch"
  PATH="$(path_without footswitch)"
  run_zsh_function "$FN"
  [ "$status" -eq 1 ]
  [[ "$output" == *"footswitch.nix"* ]]
  [ ! -e "$HOME/calls" ]
}

@test "unknown flag exits 2 with usage" {
  run_zsh_function "$FN" --bogus
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown arg: --bogus"* ]]
  [[ "$output" == *"usage: pedal-flash"* ]]
}
