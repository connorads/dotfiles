#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

TSSSH="$FUNCTIONS_DIR/tailscale/tsssh"

setup() {
  setup_test_home
  export TSSSH_STATE="$BATS_TEST_TMPDIR/tsssh-state"
  echo false > "$TSSSH_STATE"

  write_stub ts <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$1" in
  debug)
    state=$(cat "$TSSSH_STATE")
    printf '{ "RunSSH": %s }\n' "$state"
    ;;
  set)
    case "$2" in
      --ssh=true) echo true > "$TSSSH_STATE" ;;
      --ssh=false) echo false > "$TSSSH_STATE" ;;
      *) exit 1 ;;
    esac
    ;;
  *)
    exit 1
    ;;
esac
EOF
}

@test "status reports the current ssh setting" {
  run_zsh_function "$TSSSH" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"Tailscale SSH: off (--ssh=false)"* ]]
  [[ "$output" == *"Use: tsssh on | off | toggle"* ]]
}

@test "toggle flips the ssh setting and reports the new value" {
  run_zsh_function "$TSSSH" toggle

  [ "$status" -eq 0 ]
  [ "$(cat "$TSSSH_STATE")" = "true" ]
  [[ "$output" == *"Tailscale SSH: on (--ssh=true)"* ]]
}

@test "help prints usage" {
  run_zsh_function "$TSSSH" --help

  [ "$status" -eq 0 ]
  [ "$output" = "Usage: tsssh [status|on|off|toggle]" ]
}
