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

# wait_until [-t SECS] [-i SECS] [-d DIAG] 'PREDICATE'
#
# Poll PREDICATE until it succeeds, or the budget expires. The suite's only
# sanctioned way to wait for something asynchronous.
#
# A fixed `sleep` long enough to outlast the work on an idle machine is not long
# enough under `-j`, where fork/exec chains inflate several-fold - and every
# second of it is paid on every run whether the work finished in 10ms or not.
# A poll is both faster and stable: it costs one interval when the work is
# quick, and only spends the budget when something is genuinely wrong.
#
#   -t  wall-clock budget, whole seconds (default 10). A backstop, not an
#       expectation. Raising it slows a passing test by nothing, so prefer a
#       generous one over a tuned one.
#   -i  poll interval, fractional allowed (default 0.05).
#   -d  a command run once on timeout, its output printed as the diagnostic -
#       so the failure says what WAS observed, not only what was wanted.
#
# PREDICATE is a shell command string, re-evaluated every poll. **Single-quote
# it**: in double quotes a `$(...)` is expanded once at the call, and the poll
# then re-tests that one frozen value forever.
#
#   wait_until -t 5 '[ -s "$pidfile" ]'
#   wait_until -d 'cat "$log"' 'grep -q ready "$log"'
#
# Returns 0 as soon as PREDICATE succeeds, 1 on timeout - which fails the test,
# since bats runs test bodies under errexit. Inside a function invoked with
# `run`, errexit is off, so use `wait_until ... || return 1` there.
wait_until() {
  local timeout=10 interval=0.05 diagnostic=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
    -t)
      timeout=$2
      shift 2
      ;;
    -i)
      interval=$2
      shift 2
      ;;
    -d)
      diagnostic=$2
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *) break ;;
    esac
  done

  # A deadline read off $SECONDS, rather than a fixed iteration count: the
  # budget must bound wall-clock, and under contention a single poll iteration
  # can itself cost more than the interval.
  local deadline=$((SECONDS + timeout))
  while :; do
    eval "$*" && return 0
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep "$interval"
  done

  printf 'wait_until: timed out after %ss waiting for: %s\n' "$timeout" "$*" >&2
  if [ -n "$diagnostic" ]; then
    printf 'wait_until: last observed: %s\n' "$(eval "$diagnostic" 2>&1)" >&2
  fi
  return 1
}

setup_test_home() {
  export TEST_HOME="$BATS_TEST_TMPDIR/home"
  export TEST_BIN="$BATS_TEST_TMPDIR/bin"
  export TEST_LOG="$BATS_TEST_TMPDIR/commands.log"

  mkdir -p "$TEST_HOME" "$TEST_BIN"
  export HOME="$TEST_HOME"
  # Git's own environment, dropped: `dotfiles commit` runs the pre-commit hook
  # with GIT_DIR/GIT_WORK_TREE exported (the wrapper's --git-dir/--work-tree
  # flags become env vars for hooks), and the hook runs this suite. A test that
  # builds its own repo under the isolated HOME would silently address the REAL
  # dotfiles repo instead - which failed with "invalid object" while committing,
  # and passed when the same test was run by hand.
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_PREFIX
  # XDG dirs follow HOME. They are exported in every shell (~/.zshenv sources
  # home-manager's hm-session-vars.sh), and they are absolute, so swapping HOME
  # alone leaves them pointing at the REAL user dirs - git then reads
  # $XDG_CONFIG_HOME/git/config and tmux-resurrect writes under
  # $XDG_DATA_HOME/tmux, both outside the isolated home. Re-point them at their
  # spec defaults beneath TEST_HOME, which is what a consumer deriving them from
  # HOME would compute anyway.
  export XDG_CONFIG_HOME="$TEST_HOME/.config"
  export XDG_DATA_HOME="$TEST_HOME/.local/share"
  export XDG_STATE_HOME="$TEST_HOME/.local/state"
  export XDG_CACHE_HOME="$TEST_HOME/.cache"
  export XDG_BIN_HOME="$TEST_HOME/.local/bin"
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

# attach_pty_client [SESSION] - attach a real background client over a pseudo-tty
# to SESSION (default `s`) on the private server named by $TMUX_BIN and $SOCK, so
# commands that need a real client (switch-client, popups, the sweep's
# "someone is viewing" gate) have one. Sets ATTACH_PID for teardown; returns
# non-zero if no client appears, so callers can `skip` - some CI environments
# refuse to allocate a pty.
#
# Two `script` spellings because BSD (macOS) and util-linux take different flags.
# TERM is forced: CI leaves it unset, tmux then fails to open the terminal, and
# the test would silently skip rather than fail. 3>&- closes bats's status fd so
# the backgrounded client cannot hang the run.
#
# **Stdin is a FIFO this shell holds open on fd 9, never the caller's.** `script`
# exits the instant its input reaches EOF and takes the pty client down with it,
# so a backgrounded client inheriting an already-drained stdin lives only a few
# milliseconds - long enough for `#{session_attached}` to flip, not long enough
# to still be attached when the test uses it. The client's lifetime has to be
# owned, not inferred: without this the caller is racing a process it never
# asked to be short-lived, and wins only by accident. tmux-render-smoke.bats
# reaches the same conclusion from the other direction.
attach_pty_client() {
  local sess=${1:-s}
  local fifo="$BATS_TEST_TMPDIR/attach-stdin.fifo"

  rm -f "$fifo"
  mkfifo "$fifo"
  # Read-write, so this shell is itself the writer keeping the pipe from EOF.
  exec 9<>"$fifo"

  if script --help 2>&1 | grep -q 'illegal option'; then # BSD
    TERM=${TERM:-screen} script -q /dev/null "$TMUX_BIN" -L "$SOCK" attach -t "$sess" \
      <&9 >/dev/null 2>&1 3>&- &
  else # util-linux
    TERM=${TERM:-screen} script -qec "$TMUX_BIN -L $SOCK attach -t $sess" /dev/null \
      <&9 >/dev/null 2>&1 3>&- &
  fi
  # shellcheck disable=SC2034  # read by the calling .bats file's teardown
  ATTACH_PID=$!

  # shellcheck disable=SC2016  # a wait_until predicate expands per poll, not here
  wait_until -d '"$TMUX_BIN" -L "$SOCK" list-clients' "_session_has_client $sess"
}

# stop_private_server - kill the suite's bare server and unlink its socket.
#
# tmux leaves the socket file behind when the server exits, so a teardown that
# only kills the server leaks one file per test execution; /private/tmp/tmux-501
# had grown to 15k that way. $TMUX_BIN and $SOCK are the same implicit contract
# attach_pty_client takes. The socket path is recomputed from $SOCK rather than
# captured at setup, so this also works when the server never started.
stop_private_server() {
  [ -n "${SOCK:-}" ] || return 0
  "${TMUX_BIN:-tmux}" -L "$SOCK" kill-server 2>/dev/null || true
  rm -f "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)/$SOCK"
}

# True only when SESSION really has an attached client. `[ "$(...)" != 0 ]` was
# not that test: display-message printing nothing - a dead server, a missing
# session, any error - also satisfies "not 0", so the poll would report a client
# where there was not even a server.
_session_has_client() {
  local n
  n=$("$TMUX_BIN" -L "$SOCK" display-message -p -t "$1" '#{session_attached}' 2>/dev/null)
  case "$n" in
  '' | *[!0-9]*) return 1 ;;
  esac
  [ "$n" -gt 0 ]
}

# read_pidfile FILE - the pid a process wrote to FILE, once it is actually there.
#
# A pidfile is created by the shell redirection *before* the writing process has
# put anything in it, so "the file exists" and "the file names a pid" are
# different moments. Polling the first and reading anyway yields an empty pid,
# and every check downstream then passes vacuously: `kill -0 ""` fails, so a
# test asking "has it exited yet?" answers yes immediately and proves nothing
# about the process it was watching.
read_pidfile() {
  local file=$1
  # shellcheck disable=SC2016  # a wait_until predicate expands per poll, not here
  wait_until -d 'printf "%s exists=%s content=[%s]\n" "$file" "$([ -e "$file" ] && echo y || echo n)" "$(cat "$file" 2>/dev/null)"' \
    '_pidfile_has_pid "$file"' || return 1
  cat "$file"
}

_pidfile_has_pid() {
  local content
  content=$(cat "$1" 2>/dev/null | tr -d ' \n')
  case "$content" in
  '' | *[!0-9]*) return 1 ;;
  esac
  return 0
}

# run_in_tty COMMAND - run COMMAND under `script(1)` so it sees a tty, for
# asserting output that is gated on one (colour, a progress line, an
# interactive-only warning).
#
# **It cannot answer a prompt** - `script` gives the child no way to receive a
# keystroke here, and the failure is silent rather than loud. Use `run_on_pty`
# below for anything that reads from stdin.
run_in_tty() {
  local command=$1

  if script --help 2>&1 | grep -q 'illegal option'; then
    run script -q /dev/null zsh --no-rcs -i -c "$command"
  else
    run script -qc "$command" /dev/null
  fi
}

# run_on_pty ANSWER CMD... - run CMD on a real pseudo-tty, answer its prompt
# with ANSWER, and `run` it, so $status is CMD's own exit status.
#
# `script(1)` cannot do this in either spelling, and neither failure says so.
# Handed a FIFO on stdin (the `attach_pty_client` fd-9 pattern) BSD `script`
# calls tcgetattr on its own stdin and aborts - `script: tcgetattr/ioctl:
# Operation not supported on socket` - so the child never runs at all. Handed a
# heredoc it starts, but the pty reaches EOF before the child's `read` happens:
# the prompt sees ^D, the answer parses as empty, and therefore **every answer
# reads as "no"**. An abort test then passes for entirely the wrong reason while
# its proceed twin fails, which is exactly how this hid.
#
# So the driver owns the pty rather than borrowing one: `pty.openpty()`, the
# child's stdin/stdout/stderr all the slave, the answer written to the master,
# and **the master held open until the child exits** - that is what keeps the
# child's stdin from hitting EOF first. It also exits with the child's real
# status, which `script`'s own exit status is not reliably; a script-based test
# has to round-trip the exit code through a file to get it.
#
# python3 is already a suite dependency (`create_unix_socket`). The heredoc is
# python's *own* stdin, while the child's stdin is the pty slave `Popen` sets
# explicitly, so the two never collide.
run_on_pty() {
  local answer=$1
  shift

  run python3 - "$answer" "$@" <<'PY'
"""run_on_pty ANSWER CMD... - run CMD on a pty, type ANSWER, exit with its status."""
import os
import pty
import subprocess
import sys

answer = sys.argv[1].encode()
master, slave = pty.openpty()
proc = subprocess.Popen(sys.argv[2:], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
# The line discipline holds this until the child reads it, and the master
# staying open is what keeps the child's stdin from hitting EOF first.
os.write(master, answer + b"\n")

chunks = []
while True:
    try:
        data = os.read(master, 4096)
    except OSError:
        break
    if not data:
        break
    chunks.append(data)

proc.wait()
os.close(master)
sys.stdout.buffer.write(b"".join(chunks))
sys.exit(proc.returncode)
PY
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
