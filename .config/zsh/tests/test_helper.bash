#!/usr/bin/env bash

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZSH_DIR="$(cd "$TESTS_DIR/.." && pwd)"
# shellcheck disable=SC2034  # read by the .bats files that source this helper
FUNCTIONS_DIR="$ZSH_DIR/functions"

# The real home, captured at source time: setup_test_home replaces $HOME with a
# throwaway dir, and the nix profile discovery below still needs the real one.
REAL_HOME="$HOME"

# Nix profile bin dirs, existence unchecked here and filtered at use.
_nix_profile_bins=(
  "/etc/profiles/per-user/${USER:-${LOGNAME:-}}/bin"
  "/run/current-system/sw/bin"
  "$REAL_HOME/.nix-profile/bin"
  "/nix/var/nix/profiles/default/bin"
)

# Candidates for a bash >= 5, in the SAME order as the bash5 re-exec preamble in
# the tmux scripts: nix profiles first, Homebrew as the last-resort fallback.
# Kept aligned deliberately - if the two ever disagree, a test can pass under an
# interpreter production never picks.
_bash5_bins=("${_nix_profile_bins[@]}" "/opt/homebrew/bin")

_discover_bash5() {
  local dir ver
  for dir in "${_bash5_bins[@]}"; do
    [ -x "$dir/bash" ] || continue
    # shellcheck disable=SC2016  # the CHILD bash must expand this, not us
    ver="$("$dir/bash" -c 'echo ${BASH_VERSINFO[0]}' 2>/dev/null || echo 0)"
    [ "${ver:-0}" -ge 5 ] 2>/dev/null || continue
    printf '%s\n' "$dir/bash"
    return 0
  done
  # Linux hosts: the ambient bash is already 5.x, so no nix path is needed.
  # shellcheck disable=SC2016  # the CHILD bash must expand this, not us
  ver="$(bash -c 'echo ${BASH_VERSINFO[0]}' 2>/dev/null || echo 0)"
  if [ "${ver:-0}" -ge 5 ] 2>/dev/null; then
    command -v bash
    return 0
  fi
  return 1
}

# BASH5: an interpreter guaranteed to be bash >= 5. On macOS `command -v bash`
# is Apple's 3.2, which cannot run the bash-4+ syntax the tmux scripts use, so a
# test that invokes bash directly must use "$BASH5" rather than plain `bash`.
BASH5="$(_discover_bash5 || true)"
export BASH5

setup_test_home() {
  export TEST_HOME="$BATS_TEST_TMPDIR/home"
  export TEST_BIN="$BATS_TEST_TMPDIR/bin"
  export TEST_LOG="$BATS_TEST_TMPDIR/commands.log"

  mkdir -p "$TEST_HOME" "$TEST_BIN"
  export HOME="$TEST_HOME"
  # An explicit PATH, not one derived from wherever the caller's zsh happened to
  # live. Order: stubs, then the native host dirs, then whichever nix profile
  # dirs exist. Native-first mirrors production - in the tmux server's PATH /bin
  # precedes the nix profiles - so a test sees the same Apple bash/jq/touch the
  # scripts see. That is safe because the scripts re-exec themselves under
  # bash >= 5; it is also what makes a macOS-only portability bug fail here
  # rather than only in production. Existing dirs only, de-duplicated.
  local dir new_path=""
  for dir in "$TEST_BIN" /usr/bin /bin /usr/sbin /sbin "${_nix_profile_bins[@]}"; do
    [ -d "$dir" ] || continue
    case ":$new_path:" in
    *":$dir:"*) continue ;;
    esac
    new_path="${new_path:+$new_path:}$dir"
  done
  export PATH="$new_path"
  : >"$TEST_LOG"
}

# path_without NAME - a PATH carrying the usual system tools but genuinely no
# NAME, with $TEST_BIN in front.
#
# "Tool absent from PATH" cannot be spelled by listing fewer system dirs: macOS
# keeps lsof in /usr/sbin, so "$TEST_BIN:/usr/bin:/bin" excludes it, while Linux
# keeps it in /usr/bin, so the same list includes it. Symlinking a filtered view
# of the system dirs is the only spelling that means the same thing on both.
path_without() {
  local drop=$1
  # Cached per file, not per test: building it costs a symlink per system binary.
  local dir="${BATS_FILE_TMPDIR:-$BATS_TEST_TMPDIR}/path-without-$drop"
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    local sysdir entry name
    for sysdir in /usr/bin /bin; do
      [ -d "$sysdir" ] || continue
      for entry in "$sysdir"/*; do
        [ -f "$entry" ] && [ -x "$entry" ] || continue
        name="${entry##*/}"
        if [ "$name" != "$drop" ]; then
          ln -sf "$entry" "$dir/$name"
        fi
      done
    done
  fi
  printf '%s' "$TEST_BIN:$dir"
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

# Indexed curl stub for the usage-tracker tests. Each invocation consumes the
# next response, keyed by 1-based call index N via env vars the test exports:
#   CURL_<N>_KIND = hb | stdout | net   (default net -> exit 7)
#   CURL_<N>_CODE = HTTP status for hb  (default 200)
#   CURL_<N>_BODY = file copied to curl's -o target for hb (default empty body)
#   CURL_<N>_OUT  = file streamed to stdout for the stdout kind
# The call counter lives in $CURL_STATE.
write_curl_stub() {
  export CURL_STATE="$BATS_TEST_TMPDIR/curl-state"
  : >"$CURL_STATE"
  write_stub curl <<'EOF'
#!/usr/bin/env bash
set -u
n=$(( $(cat "$CURL_STATE" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$CURL_STATE"
hdr="" out="" prev=""
for a in "$@"; do
  case "$prev" in
    -D) hdr="$a" ;;
    -o) out="$a" ;;
  esac
  prev="$a"
done
kv="CURL_${n}_KIND"; kind="${!kv:-net}"
case "$kind" in
  hb)
    cv="CURL_${n}_CODE"; code="${!cv:-200}"
    bv="CURL_${n}_BODY"; bf="${!bv:-}"
    [ -n "$hdr" ] && printf 'HTTP/1.1 %s OK\r\n\r\n' "$code" >"$hdr"
    if [ -n "$out" ]; then
      if [ -n "$bf" ]; then cat "$bf" >"$out"; else : >"$out"; fi
    fi
    ;;
  stdout)
    ov="CURL_${n}_OUT"; of="${!ov:-}"
    [ -n "$of" ] && cat "$of"
    ;;
  *) exit 7 ;;
esac
exit 0
EOF
}
