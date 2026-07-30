#!/usr/bin/env bats

# The rebuild wrappers are pure argv dispatch, so every host can run these -
# darwin-rebuild/home-manager/nixos-rebuild are stubbed, not required on PATH.
#
# Regression: drs/hms took no "$@", so `drsr` (then `drs --rollback`) discarded
# the flag and performed a plain switch, exiting 0. A rollback that silently
# switches is worst exactly when it is reached, after a bad switch.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

setup() {
  setup_test_home

  # sudo: transparent, so the wrapper's real argv reaches the stub below.
  write_stub sudo <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF

  for cmd in darwin-rebuild home-manager nixos-rebuild; do
    write_stub "$cmd" <<EOF
#!/usr/bin/env bash
echo "$cmd \$*" >>"\$TEST_LOG"
EOF
  done
}

# assert_invocation <wrapper> <expected argv line>
assert_invocation() {
  local wrapper=$1 expected=$2
  shift 2

  run_zsh_function "$FUNCTIONS_DIR/nix/$wrapper" "$@"
  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_LOG")" = "$expected" ]
}

@test "drs switches against the flake" {
  assert_invocation drs "darwin-rebuild switch --flake $TEST_HOME/.config/nix"
}

@test "drs forwards extra arguments" {
  assert_invocation drs \
    "darwin-rebuild switch --flake $TEST_HOME/.config/nix --show-trace" --show-trace
}

@test "drsr passes --rollback to darwin-rebuild" {
  assert_invocation drsr \
    "darwin-rebuild switch --flake $TEST_HOME/.config/nix --rollback"
}

@test "hms switches against the flake" {
  assert_invocation hms "home-manager switch --flake $TEST_HOME/.config/nix"
}

@test "hms forwards extra arguments" {
  assert_invocation hms \
    "home-manager switch --flake $TEST_HOME/.config/nix --show-trace" --show-trace
}

@test "hmsr passes --rollback to home-manager" {
  # --rollback must trail `switch`: home-manager rejects it at top level.
  assert_invocation hmsr \
    "home-manager switch --flake $TEST_HOME/.config/nix --rollback"
}

@test "nrs switches against the flake" {
  assert_invocation nrs "nixos-rebuild switch --flake $TEST_HOME/.config/nix"
}

@test "nrsr passes --rollback to nixos-rebuild" {
  assert_invocation nrsr \
    "nixos-rebuild switch --flake $TEST_HOME/.config/nix --rollback"
}

@test "nrs honours NIXOS_FLAKE" {
  NIXOS_FLAKE=/etc/nixos assert_invocation nrs \
    "nixos-rebuild switch --flake /etc/nixos"
}
