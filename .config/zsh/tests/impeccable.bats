#!/usr/bin/env bats
# Vendored launcher contract: no task-time installation or telemetry.
load test_helper
bats_require_minimum_version 1.5.0

setup() {
  SOURCE="$REAL_HOME/.config/skills/vendor/impeccable/.agents/skills/impeccable"
  setup_test_home
  mkdir -p "$TEST_HOME/skill/scripts"
  cp "$SOURCE/scripts/impeccable" "$SOURCE/scripts/VERSION" "$TEST_HOME/skill/scripts/"
  LAUNCHER="$TEST_HOME/skill/scripts/impeccable"
  unset IMPECCABLE_BIN IMPECCABLE_HOME IMPECCABLE_SKILL_DIR IMPECCABLE_SELF IMPECCABLE_LAUNCHER_PROBE
  export CALLS="$TEST_HOME/calls"
  for tool in curl wget; do
    cat >"$TEST_BIN/$tool" <<'STUB'
#!/bin/sh
printf '%s\n' network >> "$CALLS"
exit 1
STUB
    chmod +x "$TEST_BIN/$tool"
  done
}

make_engine() {
  cat >"$TEST_BIN/engine" <<'STUB'
#!/bin/sh
printf '%s\n' "$@" > "$CALLS"
printf '%s\n' "${IMPECCABLE_NO_UPDATE_CHECK:-unset}" "${IMPECCABLE_NO_TELEMETRY:-unset}"
exit 23
STUB
  chmod +x "$TEST_BIN/engine"
  export IMPECCABLE_BIN="$TEST_BIN/engine"
}

@test "missing engine fails without fetching or writing a cache" {
  run -127 sh "$LAUNCHER" context
  [ "$status" -eq 127 ]
  [ ! -e "$CALLS" ]
  [ ! -e "$HOME/.impeccable" ]
}

@test "existing engine receives exact arguments and disables update checks and telemetry" {
  make_engine
  run sh "$LAUNCHER" context --target 'src/a b.tsx' ''
  [ "$status" -eq 23 ]
  [ "$output" = $'1\n1' ]
  printf '%s\n' context --target 'src/a b.tsx' '' >"$TEST_HOME/expected"
  cmp "$TEST_HOME/expected" "$CALLS"
}

@test "catalogue maintenance cannot run through the launcher" {
  make_engine
  for verb in install link update; do
    run sh "$LAUNCHER" "$verb"
    [ "$status" -eq 2 ]
    [[ "$output" == *catalogue* ]]
    [ ! -e "$CALLS" ]
  done
}
