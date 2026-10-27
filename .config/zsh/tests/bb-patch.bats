#!/usr/bin/env bats

source "$BATS_TEST_DIRNAME/test_helper.bash"

WRAPPER="$FUNCTIONS_DIR/patch/bb-patch"

setup() {
  setup_test_home
  write_stub python3 <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$TEST_LOG"
exit "${MANAGER_EXIT:-0}"
EOF
}

@test "bb-patch forwards literal arguments and manager exit status" {
  export MANAGER_EXIT=2
  run zsh --no-rcs "$WRAPPER" inspect --app '/synthetic/path with spaces.app' --json
  [ "$status" -eq 2 ]
  grep -qFx -- '-B' "$TEST_LOG"
  grep -qFx "$HOME/src/bb-plugins/workflows-patch/scripts/bb_patch.py" "$TEST_LOG"
  grep -qFx '/synthetic/path with spaces.app' "$TEST_LOG"
  grep -qFx inspect "$TEST_LOG"
  grep -qFx -- '--json' "$TEST_LOG"
  [ "$(wc -l <"$TEST_LOG" | tr -d ' ')" -eq 6 ]
  [ ! -e "$HOME/src" ]
}

@test "bb-patch autoload and executable modes preserve success" {
  run "$WRAPPER" verify --plan /synthetic/plan.json
  [ "$status" -eq 0 ]
  grep -qFx verify "$TEST_LOG"
  run zsh --no-rcs -c 'fpath=("$1" $fpath); autoload -Uz bb-patch; bb-patch "$2" --plan "$3"' wrapper "${WRAPPER%/*}" verify /synthetic/plan.json
  [ "$status" -eq 0 ]
  grep -qFx /synthetic/plan.json "$TEST_LOG"
}
