#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

POPUP="$HOME/.config/tmux/scripts/ai-usage-popup.sh"

setup() {
  setup_test_home
  mkdir -p "$HOME/.local/bin" "$HOME/.cache"
  export POPUP_LOG="$BATS_TEST_TMPDIR/popup.log"
  export REFRESH_DONE="$BATS_TEST_TMPDIR/refresh-done"
  export REFRESH_RELEASE="$BATS_TEST_TMPDIR/refresh-release"
  : >"$POPUP_LOG"
}

write_ai_usage_stub() {
  local refresh_body=${1:-:}
  write_executable "$HOME/.local/bin/ai-usage" <<EOF
#!/usr/bin/env sh
printf '%s\\n' "\$1" >>"\$POPUP_LOG"
case "\$1" in
  --cache-only) printf 'cached dashboard\\n' ;;
  --refresh-only)
    $refresh_body
    touch "\$REFRESH_DONE"
    ;;
esac
EOF
}

run_popup_tty() {
  local key_delay=$1
  run python3 - "$POPUP" "$key_delay" <<'PY'
import os
import pty
import select
import sys
import time

command, delay = sys.argv[1], float(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    os.execve(command, [command], os.environ)

started = time.monotonic()
sent = False
chunks = []
while True:
    if not sent and time.monotonic() - started >= delay:
        os.write(fd, b"q")
        sent = True
    ready, _, _ = select.select([fd], [], [], 0.02)
    if ready:
        try:
            chunks.append(os.read(fd, 4096))
        except OSError:
            break
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        break
    if time.monotonic() - started > 5:
        os.kill(pid, 9)
        _, status = os.waitpid(pid, 0)
        break
if not done:
    _, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(b"".join(chunks))
raise SystemExit(os.waitstatus_to_exitcode(status))
PY
}

run_popup_after_refresh() {
  run python3 - "$POPUP" "$REFRESH_DONE" <<'PY'
import os
import pty
import select
import sys
import time

command, done_file = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execve(command, [command], os.environ)
started = time.monotonic()
sent = False
chunks = []
while True:
    if not sent and os.path.exists(done_file):
        time.sleep(0.2)
        os.write(fd, b"q")
        sent = True
    ready, _, _ = select.select([fd], [], [], 0.02)
    if ready:
        try:
            chunks.append(os.read(fd, 4096))
        except OSError:
            break
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        break
    if time.monotonic() - started > 5:
        os.kill(pid, 9)
        _, status = os.waitpid(pid, 0)
        break
if not done:
    _, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(b"".join(chunks))
raise SystemExit(os.waitstatus_to_exitcode(status))
PY
}

run_popup_sigterm() {
  run python3 - "$POPUP" <<'PY'
import os
import pty
import select
import signal
import sys
import time

command = sys.argv[1]
log_file = os.environ["POPUP_LOG"]
pid, fd = pty.fork()
if pid == 0:
    os.execve(command, [command], os.environ)
started = time.monotonic()
sent = False
chunks = []
while True:
    if not sent:
        try:
            refresh_started = "--refresh-only" in open(log_file).read()
        except OSError:
            refresh_started = False
        if refresh_started:
            os.kill(pid, signal.SIGTERM)
            sent = True
    ready, _, _ = select.select([fd], [], [], 0.02)
    if ready:
        try:
            chunks.append(os.read(fd, 4096))
        except OSError:
            break
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        break
    if time.monotonic() - started > 5:
        os.kill(pid, 9)
        _, status = os.waitpid(pid, 0)
        break
if not done:
    _, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(b"".join(chunks))
raise SystemExit(os.waitstatus_to_exitcode(status))
PY
}

@test "non-TTY invocation preserves refresh-then-render compatibility" {
  write_ai_usage_stub ':'

  run "$POPUP"

  [ "$status" -eq 0 ]
  [ "$output" = "" ]
  [ "$(cat "$POPUP_LOG")" = "--fancy" ]
}

@test "TTY key dismisses promptly while detached refresh continues" {
  write_ai_usage_stub 'while [ ! -e "$REFRESH_RELEASE" ]; do sleep 0.05; done'

  run_popup_tty 0.2

  [ "$status" -eq 0 ]
  [ ! -e "$REFRESH_DONE" ]
  touch "$REFRESH_RELEASE"
  wait_until -i 0.1 '[ -e "$REFRESH_DONE" ]'
}

@test "SIGTERM restores the popup display while detached refresh continues" {
  write_ai_usage_stub 'while [ ! -e "$REFRESH_RELEASE" ]; do sleep 0.05; done'

  run_popup_sigterm

  [ "$status" -eq 130 ]
  [[ "$output" == *$'\033[?25h'* ]]
  [ ! -e "$REFRESH_DONE" ]
  touch "$REFRESH_RELEASE"
  wait_until -i 0.1 '[ -e "$REFRESH_DONE" ]'
}

@test "natural refresh completion redraws once when a cache changed" {
  write_ai_usage_stub 'printf updated >"$HOME/.cache/codex-usage.json"'

  run_popup_after_refresh

  [ "$status" -eq 0 ]
  [ "$(grep -c '^--cache-only$' "$POPUP_LOG")" -eq 2 ]
  [ "$(grep -c '^--refresh-only$' "$POPUP_LOG")" -eq 1 ]
}

@test "natural refresh completion does not redraw unchanged data" {
  write_ai_usage_stub ':'

  run_popup_after_refresh

  [ "$status" -eq 0 ]
  [ "$(grep -c '^--cache-only$' "$POPUP_LOG")" -eq 1 ]
  [ "$(grep -c '^--refresh-only$' "$POPUP_LOG")" -eq 1 ]
}
