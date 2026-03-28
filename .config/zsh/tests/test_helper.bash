#!/usr/bin/env bash

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZSH_DIR="$(cd "$TESTS_DIR/.." && pwd)"
FUNCTIONS_DIR="$ZSH_DIR/functions"

setup_test_home() {
  export TEST_HOME="$BATS_TEST_TMPDIR/home"
  export TEST_BIN="$BATS_TEST_TMPDIR/bin"
  export TEST_LOG="$BATS_TEST_TMPDIR/commands.log"

  mkdir -p "$TEST_HOME" "$TEST_BIN"
  export HOME="$TEST_HOME"
  # Preserve the path to zsh (may be nix-managed, not in /usr/bin)
  local zsh_dir
  zsh_dir="$(dirname "$(command -v zsh 2>/dev/null || echo /usr/bin/zsh)")"
  export PATH="$TEST_BIN:$zsh_dir:/usr/bin:/bin:/usr/sbin:/sbin"
  : > "$TEST_LOG"
}

write_executable() {
  local path=$1
  shift

  cat >"$path"
  chmod +x "$path"
}

write_stub() {
  local name=$1
  local path="$TEST_BIN/$name"
  shift

  write_executable "$path" "$@"
}

run_zsh_function() {
  local function_path=$1
  shift

  run zsh --no-rcs "$function_path" "$@"
}

assert_symlink_target() {
  local path=$1
  local expected=$2

  [ -L "$path" ]
  [ "$(readlink "$path")" = "$expected" ]
}

create_unix_socket() {
  local path=$1

  python3 - "$path" <<'PY'
import socket
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
sock = socket.socket(socket.AF_UNIX)
sock.bind(str(path))
sock.close()
PY
}

run_in_tty() {
  local command=$1

  if script --help 2>&1 | grep -q 'illegal option'; then
    run script -q /dev/null zsh --no-rcs -i -c "$command"
  else
    run script -qc "$command" /dev/null
  fi
}
