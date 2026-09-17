#!/usr/bin/env bats

# Each Bats test owns its environment in a separate process.
# shellcheck disable=SC2030,SC2031

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

OYO="$TESTS_DIR/../../../.local/bin/oyp"
OYO_TMUX="$TESTS_DIR/../../tmux/scripts/oyo.sh"

setup() {
  setup_test_home
  mkdir -p "$HOME/.local/bin"
  ln -s "$OYO" "$HOME/.local/bin/oyp"
  export GH_ERROR=""
  export GH_LOG="$BATS_TEST_TMPDIR/gh.log" OY_LOG="$BATS_TEST_TMPDIR/oy.log"
  export GH_PR='{"number":42,"state":"OPEN","url":"https://github.com/team/project/pull/42"}'
  export OY_PULL='{"revision":"abc123...def456"}'
  export REPO="$HOME/repo with spaces"
  mkdir -p "$REPO"
  cd "$REPO" || return
  git init -q -b feature
  git -c user.name=Test -c user.email=test@example.com -c core.hooksPath=/dev/null commit -qm initial --allow-empty
  git remote add origin git@github.com:team/project.git
  write_stub gh <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$GH_LOG"
if [ -n "${GH_ERROR:-}" ]; then
  printf '%s\n' "$GH_ERROR" >&2
  exit 1
fi
printf '%s\n' "$GH_PR"
STUB
  write_stub oy <<'STUB'
#!/bin/sh
printf 'cwd=%s gitdir=%s worktree=%s args=%s\n' "$PWD" "${GIT_DIR:-}" "${GIT_WORK_TREE:-}" "$*" >> "$OY_LOG"
if [ "${1:-}" = review ]; then
  if [ -n "${OY_ERROR:-}" ]; then
    printf '%s\n' "$OY_ERROR" >&2
    exit 1
  fi
  printf '%s\n' "$OY_PULL"
fi
STUB
}

@test "opens the PR revision and preserves the branch, index and dirty files" {
  printf 'staged\n' >tracked
  git add tracked
  printf 'unstaged\n' >>tracked
  before=$(git status --porcelain=v1)
  head_before=$(git rev-parse HEAD)
  index_before=$(git write-tree)
  run "$OYO"
  [ "$status" -eq 0 ]
  grep -F 'args=review pull 42 origin --json' "$OY_LOG"
  grep -F 'args=--range abc123...def456' "$OY_LOG"
  grep -F "cwd=$REPO " "$OY_LOG"
  [ "$(git status --porcelain=v1)" = "$before" ]
  [ "$(git rev-parse HEAD)" = "$head_before" ]
  [ "$(git write-tree)" = "$index_before" ]
  [ "$(git branch --show-current)" = feature ]
}

@test "a fork PR uses the base repository remote" {
  git remote set-url origin https://github.com/contributor/project.git
  git remote add upstream ssh://git@github.com/team/project.git
  run "$OYO"
  [ "$status" -eq 0 ]
  grep -F 'args=review pull 42 upstream --json' "$OY_LOG"
}

@test "no PR opens plain Oyo" {
  export GH_ERROR='no pull requests found for branch "feature"'
  run "$OYO"
  [ "$status" -eq 0 ]
  grep -E 'args=$' "$OY_LOG"
  run ! grep -F 'review pull' "$OY_LOG"
}

@test "closed and merged PRs open plain Oyo" {
  for state in CLOSED MERGED; do
    export GH_PR="{\"number\":42,\"state\":\"$state\",\"url\":\"https://github.com/team/project/pull/42\"}"
    run "$OYO"
    [ "$status" -eq 0 ]
  done
  [ "$(wc -l <"$OY_LOG" | tr -d ' ')" -eq 2 ]
  run ! grep -F 'review pull' "$OY_LOG"
}

@test "detached HEAD opens plain Oyo without a GitHub lookup" {
  git checkout -q --detach
  run "$OYO"
  [ "$status" -eq 0 ]
  grep -E 'args=$' "$OY_LOG"
  [ ! -e "$GH_LOG" ]
}

@test "authentication errors do not turn into a no-PR fallback" {
  export GH_ERROR='HTTP 401: Bad credentials'
  run "$OYO"
  [ "$status" -ne 0 ]
  [[ "$output" == *'HTTP 401: Bad credentials'* ]]
  [ ! -e "$OY_LOG" ]
}

@test "missing history remains an error without opening another target" {
  export OY_ERROR='Could not determine the merge base. Fetch its history and retry.'
  run "$OYO"
  [ "$status" -ne 0 ]
  [[ "$output" == *'Fetch its history and retry.'* ]]
  [ "$(wc -l <"$OY_LOG" | tr -d ' ')" -eq 1 ]
}

@test "ambiguous base repository remotes fail visibly" {
  git remote add upstream https://github.com/team/project.git
  run "$OYO"
  [ "$status" -ne 0 ]
  [[ "$output" == *'Multiple remotes match'* ]]
  [ ! -e "$OY_LOG" ]
}

@test "missing base repository remote fails visibly" {
  git remote set-url origin git@github.com:contributor/project.git
  run "$OYO"
  [ "$status" -ne 0 ]
  [[ "$output" == *'No remote matches'* ]]
  [ ! -e "$OY_LOG" ]
}

@test "dotfiles home uses the dedicated git directory and work-tree" {
  mkdir -p "$HOME/git"
  mv "$REPO/.git" "$HOME/git/dotfiles"
  cd "$HOME" || return
  run "$OYO"
  [ "$status" -eq 0 ]
  grep -F "gitdir=$HOME/git/dotfiles worktree=$HOME args=review pull 42 origin --json" "$OY_LOG"
}

@test "malformed pull output does not open a default review" {
  export OY_PULL='{}'
  run "$OYO"
  [ "$status" -ne 0 ]
  [ "$(wc -l <"$OY_LOG" | tr -d ' ')" -eq 1 ]
}

# Exercise the real terminal boundary: pipe-only tests cannot exercise the terminal-only pause.
run_review_tty() {
  run python3 - "$1" "$2" "$3" <<'PYTHON'
import os
import pty
import select
import signal
import sys
import time

command, should_pause, expected = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execv(command, [command])

output = bytearray()
status = None
paused = False
deadline = time.monotonic() + 5
try:
    while status is None:
        assert time.monotonic() < deadline, "command did not exit"
        ready, _, _ = select.select([fd], [], [], 0.05)
        if ready:
            try:
                output.extend(os.read(fd, 4096))
            except OSError:
                pass
        if not paused and b"Press any key to close..." in output:
            assert should_pause == "pause", "terminal command unexpectedly paused"
            done, _ = os.waitpid(pid, os.WNOHANG)
            assert not done, "launcher exited before a key was pressed"
            paused = True
            os.write(fd, b"q")
        done, child_status = os.waitpid(pid, os.WNOHANG)
        if done:
            status = child_status
    assert paused == (should_pause == "pause"), "wrong pause behaviour"
    assert os.waitstatus_to_exitcode(status) == int(expected), "exit status changed"
    sys.stdout.buffer.write(output)
finally:
    if status is None:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    os.close(fd)
PYTHON
}

@test "oyp resolves from PATH without shell aliases" {
  PATH="$HOME/.local/bin:$PATH" run "$BASH5" --noprofile --norc -c oyp
  [ "$status" -eq 0 ]
  grep -F 'args=--range abc123...def456' "$OY_LOG"
}

@test "direct terminal errors return without waiting for a key" {
  export GH_ERROR='HTTP 401: Bad credentials'
  run_review_tty "$OYO" no-pause 1
  [ "$status" -eq 0 ]
  [[ "$output" == *'HTTP 401: Bad credentials'* ]]
}

@test "tmux terminal errors wait for a key and preserve the exit status" {
  export GH_ERROR='HTTP 401: Bad credentials'
  run_review_tty "$OYO_TMUX" pause 1
  [ "$status" -eq 0 ]
  [[ "$output" == *'HTTP 401: Bad credentials'* ]]
}

@test "a successful tmux review exits without a pause" {
  run_review_tty "$OYO_TMUX" no-pause 0
  [ "$status" -eq 0 ]
  grep -F "cwd=$REPO " "$OY_LOG"
  grep -F 'args=--range abc123...def456' "$OY_LOG"
}

@test "tmux errors without a terminal return directly" {
  export GH_ERROR='HTTP 401: Bad credentials'
  run "$OYO_TMUX"
  [ "$status" -eq 1 ]
  [[ "$output" == *'HTTP 401: Bad credentials'* ]]
  [[ "$output" != *'Press any key'* ]]
}
