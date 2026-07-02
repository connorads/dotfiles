#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

SBX="$FUNCTIONS_DIR/agents/sbx"

setup() {
  setup_test_home
}

# Fake docker + colima. Every call is logged to $TEST_LOG regardless of how the
# caller redirects stdout/stderr, so tests assert on the exact commands issued.
# Controllable state via env:
#   COLIMA_STATUS       exit of `colima status` (default 0 = VM running)
#   DOCKER_IMAGE_EXISTS exit of `docker image inspect` (default 0 = built)
#   DOCKER_PS_RUNNING   newline list emitted by `docker ps` (running names)
#   DOCKER_PS_ALL       newline list emitted by `docker ps -a` (all names)
write_sbx_stubs() {
  write_stub docker <<'EOF'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >>"$TEST_LOG"
case "$1" in
  image) exit "${DOCKER_IMAGE_EXISTS:-0}" ;;
  ps)
    if printf '%s\n' "$@" | grep -qx -- '-a'; then
      [ -n "${DOCKER_PS_ALL:-}" ] && printf '%s\n' "${DOCKER_PS_ALL}"
    else
      [ -n "${DOCKER_PS_RUNNING:-}" ] && printf '%s\n' "${DOCKER_PS_RUNNING}"
    fi
    exit 0 ;;
  *) exit 0 ;;
esac
EOF

  write_stub colima <<'EOF'
#!/usr/bin/env bash
printf 'colima %s\n' "$*" >>"$TEST_LOG"
[ "$1" = status ] && exit "${COLIMA_STATUS:-0}"
exit 0
EOF
}

# --- dispatch / errors -------------------------------------------------------

@test "help exits 0 and prints the subcommand usage" {
  write_sbx_stubs

  run_zsh_function "$SBX" help

  [ "$status" -eq 0 ]
  [[ "$output" == *"new [--net] [name]"* ]]
  [[ "$output" == *"net on|off [name]"* ]]
  [ ! -s "$TEST_LOG" ]
}

@test "unknown subcommand fails without touching docker" {
  write_sbx_stubs

  run_zsh_function "$SBX" bogus

  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown subcommand 'bogus'"* ]]
  [ ! -s "$TEST_LOG" ]
}

# --- new: hardening + offline-by-default ------------------------------------

@test "new bakes the hardening flags and the per-box work volume" {
  write_sbx_stubs

  run_zsh_function "$SBX" new argusred

  [ "$status" -eq 0 ]
  run_line="$(grep '^docker run ' "$TEST_LOG")"
  [[ "$run_line" == *"--name sbx-argusred"* ]]
  [[ "$run_line" == *"--cap-drop ALL"* ]]
  [[ "$run_line" == *"--security-opt no-new-privileges"* ]]
  [[ "$run_line" == *"--pids-limit 512"* ]]
  [[ "$run_line" == *"--memory 2g"* ]]
  [[ "$run_line" == *"-v sbx-argusred-work:/work"* ]]
  [[ "$run_line" == *"sbx:latest"* ]]
}

@test "new is offline by default: bridge is disconnected after run, then tmux attaches" {
  write_sbx_stubs

  run_zsh_function "$SBX" new argusred

  [ "$status" -eq 0 ]
  grep -Fxq 'docker network disconnect bridge sbx-argusred' "$TEST_LOG"
  grep -Fxq 'docker exec -it sbx-argusred tmux new-session -A -s main' "$TEST_LOG"
}

@test "new --net leaves the box online (no bridge disconnect)" {
  write_sbx_stubs

  run_zsh_function "$SBX" new --net argusred

  [ "$status" -eq 0 ]
  grep -q '^docker run ' "$TEST_LOG"
  ! grep -q 'network disconnect' "$TEST_LOG"
}

@test "new defaults the box name to 'default'" {
  write_sbx_stubs

  run_zsh_function "$SBX" new

  [ "$status" -eq 0 ]
  grep -q '^docker run .*--name sbx-default' "$TEST_LOG"
}

@test "new force-removes any existing container before recreating it" {
  write_sbx_stubs

  run_zsh_function "$SBX" new argusred

  [ "$status" -eq 0 ]
  rm_ln="$(grep -n '^docker rm -f sbx-argusred' "$TEST_LOG" | head -1 | cut -d: -f1)"
  run_ln="$(grep -n '^docker run ' "$TEST_LOG" | head -1 | cut -d: -f1)"
  [ -n "$rm_ln" ] && [ -n "$run_ln" ] && [ "$rm_ln" -lt "$run_ln" ]
}

# --- network toggle ----------------------------------------------------------

@test "net on connects the bridge for the named box" {
  write_sbx_stubs

  run_zsh_function "$SBX" net on argusred

  [ "$status" -eq 0 ]
  grep -Fxq 'docker network connect bridge sbx-argusred' "$TEST_LOG"
}

@test "net off disconnects the bridge for the named box" {
  write_sbx_stubs

  run_zsh_function "$SBX" net off argusred

  [ "$status" -eq 0 ]
  grep -Fxq 'docker network disconnect bridge sbx-argusred' "$TEST_LOG"
}

@test "net with a bad direction reports usage and touches nothing" {
  write_sbx_stubs

  run_zsh_function "$SBX" net sideways argusred

  [ "$status" -eq 1 ]
  [[ "$output" == *"usage: sbx net on|off"* ]]
  [ ! -s "$TEST_LOG" ]
}

# --- lifecycle: list / stop / rm / cp ---------------------------------------

@test "list filters on the sbx label" {
  write_sbx_stubs

  run_zsh_function "$SBX" list

  [ "$status" -eq 0 ]
  grep -q '^docker ps -a --filter label=sbx' "$TEST_LOG"
}

@test "stop stops the named box only" {
  write_sbx_stubs

  run_zsh_function "$SBX" stop argusred

  [ "$status" -eq 0 ]
  grep -Fxq 'docker stop sbx-argusred' "$TEST_LOG"
}

@test "rm removes the box and its work volume" {
  write_sbx_stubs

  run_zsh_function "$SBX" rm argusred

  [ "$status" -eq 0 ]
  grep -Fxq 'docker rm -f sbx-argusred' "$TEST_LOG"
  grep -Fxq 'docker volume rm sbx-argusred-work' "$TEST_LOG"
}

@test "cp without a source path reports usage and copies nothing" {
  write_sbx_stubs

  run_zsh_function "$SBX" cp

  [ "$status" -eq 1 ]
  [[ "$output" == *"usage: sbx cp <path>"* ]]
  ! grep -q 'docker cp' "$TEST_LOG"
}

@test "cp copies a host path into the box's /work" {
  write_sbx_stubs
  export DOCKER_PS_RUNNING="sbx-argusred"

  run_zsh_function "$SBX" cp ./payload argusred

  [ "$status" -eq 0 ]
  grep -Fxq 'docker cp ./payload sbx-argusred:/work/' "$TEST_LOG"
}

# --- self-heal (ensure) ------------------------------------------------------

@test "shell attaches to an already-running box without recreating it" {
  write_sbx_stubs
  export DOCKER_PS_RUNNING="sbx-work"

  run_zsh_function "$SBX" shell work

  [ "$status" -eq 0 ]
  ! grep -q '^docker run ' "$TEST_LOG"
  ! grep -q '^docker start ' "$TEST_LOG"
  grep -Fxq 'docker exec -it sbx-work tmux new-session -A -s main' "$TEST_LOG"
}

@test "shell starts a stopped box instead of creating a new one" {
  write_sbx_stubs
  export DOCKER_PS_ALL="sbx-work"

  run_zsh_function "$SBX" shell work

  [ "$status" -eq 0 ]
  grep -Fxq 'docker start sbx-work' "$TEST_LOG"
  ! grep -q '^docker run ' "$TEST_LOG"
}

@test "shell creates the box when it does not exist yet" {
  write_sbx_stubs

  run_zsh_function "$SBX" shell work

  [ "$status" -eq 0 ]
  grep -q '^docker run .*--name sbx-work' "$TEST_LOG"
  grep -Fxq 'docker network disconnect bridge sbx-work' "$TEST_LOG"
}

@test "a stopped colima VM is started on demand; a running one is left alone" {
  write_sbx_stubs
  export DOCKER_PS_RUNNING="sbx-default"

  COLIMA_STATUS=1 run_zsh_function "$SBX" shell
  [ "$status" -eq 0 ]
  grep -q '^colima start' "$TEST_LOG"

  : >"$TEST_LOG"
  COLIMA_STATUS=0 run_zsh_function "$SBX" shell
  [ "$status" -eq 0 ]
  ! grep -q '^colima start' "$TEST_LOG"
}

# --- build -------------------------------------------------------------------

@test "build ensures the VM then builds the image" {
  write_sbx_stubs
  export DOCKER_IMAGE_EXISTS=1

  run_zsh_function "$SBX" build

  [ "$status" -eq 0 ]
  grep -q '^colima status' "$TEST_LOG"
  grep -q '^docker build -t sbx:latest' "$TEST_LOG"
}
