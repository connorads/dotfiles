#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

ATUIN_AGENT="$FUNCTIONS_DIR/agents/atuin-agent"

setup() {
  setup_test_home
  unset ATUIN_DB_PATH ATUIN_RECORD_STORE_PATH
  write_stub atuin <<'STUB'
#!/usr/bin/env bash
printf 'db=%s\n' "${ATUIN_DB_PATH-}"
printf 'records=%s\n' "${ATUIN_RECORD_STORE_PATH-}"
printf 'arg=%s\n' "$@"
STUB
}

@test "points atuin at the agent DB and record store" {
  run_zsh_function "$ATUIN_AGENT" search

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "db=$HOME/.local/share/atuin/agents.db" ]
  [ "${lines[1]}" = "records=$HOME/.local/share/atuin/agents-records.db" ]
}

@test "passes args through unchanged" {
  run_zsh_function "$ATUIN_AGENT" search --author 'claude code' -- ''

  [ "$status" -eq 0 ]
  [ "${lines[2]}" = "arg=search" ]
  [ "${lines[3]}" = "arg=--author" ]
  [ "${lines[4]}" = "arg=claude code" ]
  [ "${lines[5]}" = "arg=--" ]
  [ "${lines[6]}" = "arg=" ]
}

@test "propagates atuin's exit status" {
  write_stub atuin <<'STUB'
#!/usr/bin/env bash
exit 3
STUB

  run_zsh_function "$ATUIN_AGENT" status

  [ "$status" -eq 3 ]
}

@test "as an autoloaded function, leaves the caller's shell alive and env clean" {
  run zsh --no-rcs -c '
    fpath=("$1" $fpath)
    autoload -Uz atuin-agent
    atuin-agent --version >/dev/null
    print "alive db=${ATUIN_DB_PATH-unset} records=${ATUIN_RECORD_STORE_PATH-unset}"
  ' zsh "$FUNCTIONS_DIR/agents"

  [ "$status" -eq 0 ]
  [ "$output" = "alive db=unset records=unset" ]
}
