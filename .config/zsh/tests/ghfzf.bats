#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

GHFZF="$FUNCTIONS_DIR/git/ghfzf"

setup() {
  setup_test_home
  export FZF_RESPONSE_DIR="$BATS_TEST_TMPDIR/fzf-responses"
  export FZF_INPUT_DIR="$BATS_TEST_TMPDIR/fzf-inputs"
  export FZF_ARG_LOG="$BATS_TEST_TMPDIR/fzf-args.log"
  export FZF_CALLS="$BATS_TEST_TMPDIR/fzf-calls"
  export GH_LOG="$BATS_TEST_TMPDIR/gh.log"
  export GIT_LOG="$BATS_TEST_TMPDIR/git.log"
  export CLIPBOARD_LOG="$BATS_TEST_TMPDIR/clipboard.log"

  mkdir -p "$FZF_RESPONSE_DIR" "$FZF_INPUT_DIR"
  : >"$FZF_ARG_LOG"
  : >"$FZF_CALLS"
  : >"$GH_LOG"
  : >"$GIT_LOG"
  : >"$CLIPBOARD_LOG"

  write_stub fzf <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
n=$(( $(cat "$FZF_CALLS" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$FZF_CALLS"
{
  printf 'fzf'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >>"$FZF_ARG_LOG"
cat >"$FZF_INPUT_DIR/$n"
if [ -f "$FZF_RESPONSE_DIR/$n.exit" ]; then
  exit "$(cat "$FZF_RESPONSE_DIR/$n.exit")"
fi
if [ -f "$FZF_RESPONSE_DIR/$n" ]; then
  cat "$FZF_RESPONSE_DIR/$n"
  exit 0
fi
exit 130
EOF

  write_stub gh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
{
  printf 'gh'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >>"$GH_LOG"

case "${1:-} ${2:-}" in
  "pr list")
    [ -n "${GH_PR_ROWS:-}" ] && printf '%s\n' "$GH_PR_ROWS"
    ;;
  "issue list")
    [ -n "${GH_ISSUE_ROWS:-}" ] && printf '%s\n' "$GH_ISSUE_ROWS"
    ;;
  "run list")
    [ -n "${GH_RUN_ROWS:-}" ] && printf '%s\n' "$GH_RUN_ROWS"
    ;;
  "label list")
    [ -n "${GH_LABEL_ROWS:-}" ] && printf '%s\n' "$GH_LABEL_ROWS"
    ;;
  *)
    printf 'ran gh %s\n' "$*"
    ;;
esac
exit 0
EOF

  write_stub git <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
{
  printf 'git'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >>"$GIT_LOG"

if [ "${1:-}" = "--git-dir=$HOME/git/dotfiles" ] \
  && [ "${2:-}" = "--work-tree=$HOME" ] \
  && [ "${3:-}" = "remote" ] \
  && [ "${4:-}" = "get-url" ] \
  && [ "${5:-}" = "origin" ]; then
  if [ "${GIT_REMOTE_EXIT:-0}" -ne 0 ]; then
    exit "$GIT_REMOTE_EXIT"
  fi
  printf '%s\n' "${GIT_REMOTE_URL:-git@github.com:connorads/dotfiles.git}"
  exit 0
fi

exit 1
EOF

  write_stub pbcopy <<'EOF'
#!/usr/bin/env bash
cat >"$CLIPBOARD_LOG"
EOF

  export GH_PR_ROWS=$'42\tOPEN\thttps://github.com/o/r/pull/42\t#42\tFix bug\talice\t2026-07-08T00:00:00Z\tbug,ready'
  export GH_ISSUE_ROWS=$'7\tOPEN\thttps://github.com/o/r/issues/7\t#7\tBroken thing\tbob\t2026-07-08T00:00:00Z\ttriage'
  export GH_RUN_ROWS=$'555\tcompleted\tfailure\thttps://github.com/o/r/actions/runs/555\t555\tCI\tFix bug\tmain\tpush\t2026-07-08T00:00:00Z'
  export GH_LABEL_ROWS=$'bug\nneeds review\nready'
}

write_fzf_response() {
  local n=$1
  local body=$2
  printf '%s' "$body" >"$FZF_RESPONSE_DIR/$n"
}

write_fzf_exit() {
  local n=$1
  local status=$2
  printf '%s' "$status" >"$FZF_RESPONSE_DIR/$n.exit"
}

reset_fakes() {
  rm -f "$FZF_RESPONSE_DIR"/* "$FZF_INPUT_DIR"/*
  : >"$FZF_ARG_LOG"
  : >"$FZF_CALLS"
  : >"$GH_LOG"
  : >"$GIT_LOG"
  : >"$CLIPBOARD_LOG"
}

run_ghfzf_with_answer() {
  local answer=$1
  shift
  run bash -c 'printf "%s\n" "$1" | zsh --no-rcs "$2" "${@:3}"' _ "$answer" "$GHFZF" "$@"
}

run_ghfzf_from_home() {
  run bash -c 'cd "$HOME" && zsh --no-rcs "$1" "${@:2}"' _ "$GHFZF" "$@"
}

last_gh_line() {
  tail -n 1 "$GH_LOG"
}

@test "help and version do not invoke gh or fzf" {
  rm -f "$TEST_BIN/gh" "$TEST_BIN/fzf"

  run_zsh_function "$GHFZF" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage: ghfzf"* ]]

  run_zsh_function "$GHFZF" --version
  [ "$status" -eq 0 ]
  [[ "$output" == "ghfzf 0.1.0" ]]

  [ ! -s "$GIT_LOG" ]
  [ ! -s "$GH_LOG" ]
  [ ! -s "$FZF_ARG_LOG" ]
}

@test "invalid arguments return 2 before invoking external tools" {
  rm -f "$TEST_BIN/gh" "$TEST_BIN/fzf"

  run_zsh_function "$GHFZF" repo

  [ "$status" -eq 2 ]
  [[ "$output" == *"ghfzf: unknown subcommand: repo"* ]]
  [ ! -s "$GIT_LOG" ]
  [ ! -s "$GH_LOG" ]
  [ ! -s "$FZF_ARG_LOG" ]
}

@test "missing gh or fzf fails clearly" {
  rm -f "$TEST_BIN/gh"

  local zsh_bin
  zsh_bin="$(command -v zsh)"

  run -127 env PATH="$TEST_BIN:/usr/bin:/bin:/usr/sbin:/sbin" "$zsh_bin" --no-rcs "$GHFZF" pr

  [ "$status" -eq 127 ]
  [[ "$output" == *"ghfzf: gh not found"* ]]

  setup
  rm -f "$TEST_BIN/fzf"

  run -127 env PATH="$TEST_BIN:/usr/bin:/bin:/usr/sbin:/sbin" "$zsh_bin" --no-rcs "$GHFZF" pr

  [ "$status" -eq 127 ]
  [[ "$output" == *"ghfzf: fzf not found"* ]]
}

@test "no-argument chooser dispatches to pull requests" {
  write_fzf_response 1 $'pr\tpull requests\n'
  write_fzf_exit 2 130

  run_zsh_function "$GHFZF"

  [ "$status" -eq 130 ]
  grep -Fq 'gh <pr> <list>' "$GH_LOG"
}

@test "no-argument chooser dispatches to issues" {
  write_fzf_response 1 $'issue\tissues\n'
  write_fzf_exit 2 130

  run_zsh_function "$GHFZF"

  [ "$status" -eq 130 ]
  grep -Fq 'gh <issue> <list>' "$GH_LOG"
}

@test "no-argument chooser dispatches to actions runs" {
  write_fzf_response 1 $'run\tactions runs\n'
  write_fzf_exit 2 130

  run_zsh_function "$GHFZF"

  [ "$status" -eq 130 ]
  grep -Fq 'gh <run> <list>' "$GH_LOG"
}

@test "repo and limit flags are propagated to list and view commands" {
  write_fzf_response 1 $'enter\n42\tOPEN\thttps://github.com/o/r/pull/42\t#42\tFix bug\talice\t2026-07-08T00:00:00Z\tbug,ready\n'

  run_zsh_function "$GHFZF" pr -R owner/repo -L 12

  [ "$status" -eq 0 ]
  grep -Fq 'gh <pr> <list>' "$GH_LOG"
  grep -Fq '<-L> <12>' "$GH_LOG"
  grep -Fq '<-R> <owner/repo>' "$GH_LOG"
  [ "$(last_gh_line)" = 'gh <pr> <view> <42> <-R> <owner/repo>' ]
}

@test "running from home auto-targets dotfiles GitHub repo" {
  mkdir -p "$HOME/git/dotfiles"
  write_fzf_exit 1 130

  run_ghfzf_from_home pr

  [ "$status" -eq 130 ]
  grep -Fq 'git <--git-dir='"$HOME"'/git/dotfiles> <--work-tree='"$HOME"'> <remote> <get-url> <origin>' "$GIT_LOG"
  grep -Fq 'gh <pr> <list>' "$GH_LOG"
  grep -Fq '<-R> <connorads/dotfiles>' "$GH_LOG"
}

@test "explicit repo wins over home dotfiles auto-targeting" {
  mkdir -p "$HOME/git/dotfiles"
  write_fzf_exit 1 130

  run_ghfzf_from_home issue -R owner/repo

  [ "$status" -eq 130 ]
  [ ! -s "$GIT_LOG" ]
  grep -Fq 'gh <issue> <list>' "$GH_LOG"
  grep -Fq '<-R> <owner/repo>' "$GH_LOG"
  ! grep -Fq '<-R> <connorads/dotfiles>' "$GH_LOG"
}

@test "dotfiles auto-targeting only applies at home root" {
  mkdir -p "$HOME/git/dotfiles" "$HOME/project"
  write_fzf_exit 1 130

  run bash -c 'cd "$HOME/project" && zsh --no-rcs "$1" pr' _ "$GHFZF"

  [ "$status" -eq 130 ]
  [ ! -s "$GIT_LOG" ]
  grep -Fq 'gh <pr> <list>' "$GH_LOG"
  ! grep -Fq '<-R>' "$GH_LOG"
}

@test "dotfiles remote parser supports https and ssh URL forms" {
  mkdir -p "$HOME/git/dotfiles"
  export GIT_REMOTE_URL="https://github.com/connorads/dotfiles.git"
  write_fzf_exit 1 130

  run_ghfzf_from_home run

  [ "$status" -eq 130 ]
  grep -Fq '<-R> <connorads/dotfiles>' "$GH_LOG"

  reset_fakes
  mkdir -p "$HOME/git/dotfiles"
  export GIT_REMOTE_URL="ssh://git@github.example.com/teams/dotfiles.git"
  write_fzf_exit 1 130

  run_ghfzf_from_home run

  [ "$status" -eq 130 ]
  grep -Fq '<-R> <github.example.com/teams/dotfiles>' "$GH_LOG"
}

@test "dotfiles remote lookup failure falls back to gh repo discovery" {
  mkdir -p "$HOME/git/dotfiles"
  export GIT_REMOTE_EXIT=1
  write_fzf_exit 1 130

  run_ghfzf_from_home pr

  [ "$status" -eq 130 ]
  grep -Fq 'git <--git-dir='"$HOME"'/git/dotfiles> <--work-tree='"$HOME"'> <remote> <get-url> <origin>' "$GIT_LOG"
  grep -Fq 'gh <pr> <list>' "$GH_LOG"
  ! grep -Fq '<-R>' "$GH_LOG"
}

@test "GHFZF_LIMIT supplies the default limit" {
  export GHFZF_LIMIT=9
  write_fzf_exit 1 130

  run_zsh_function "$GHFZF" issue

  [ "$status" -eq 130 ]
  grep -Fq '<-L> <9>' "$GH_LOG"
}

@test "web and copy actions use the selected item" {
  write_fzf_response 1 $'ctrl-o\n7\tOPEN\thttps://github.com/o/r/issues/7\t#7\tBroken thing\tbob\t2026-07-08T00:00:00Z\ttriage\n'

  run_zsh_function "$GHFZF" issue -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <issue> <view> <7> <--web> <-R> <owner/repo>' ]

  reset_fakes
  write_fzf_response 1 $'ctrl-y\n555\tcompleted\tfailure\thttps://github.com/o/r/actions/runs/555\t555\tCI\tFix bug\tmain\tpush\t2026-07-08T00:00:00Z\n'

  run_zsh_function "$GHFZF" run

  [ "$status" -eq 0 ]
  [ "$(cat "$CLIPBOARD_LOG")" = "https://github.com/o/r/actions/runs/555" ]
  [[ "$output" == *"copied: https://github.com/o/r/actions/runs/555"* ]]
}

@test "empty result sets return 0 before fzf" {
  unset GH_PR_ROWS

  run_zsh_function "$GHFZF" pr

  [ "$status" -eq 0 ]
  [[ "$output" == *"ghfzf: no pull requests found"* ]]
  [ ! -s "$FZF_ARG_LOG" ]
}

@test "cancelled picker and declined confirmation return 130 without mutation" {
  write_fzf_exit 1 130

  run_zsh_function "$GHFZF" pr

  [ "$status" -eq 130 ]
  ! grep -Fq '<merge>' "$GH_LOG"

  reset_fakes
  write_fzf_response 1 $'ctrl-a\n42\tOPEN\thttps://github.com/o/r/pull/42\t#42\tFix bug\talice\t2026-07-08T00:00:00Z\tbug,ready\n'
  write_fzf_response 2 $'merge\tMerge pull request\n'

  run_ghfzf_with_answer n pr -R owner/repo

  [ "$status" -eq 130 ]
  [[ "$output" == *"Command: gh pr merge 42 -R owner/repo"* ]]
  [[ "$output" == *"Cancelled"* ]]
  ! grep -Fq '<merge>' "$GH_LOG"
}

@test "confirmed PR merge and label actions use exact gh commands" {
  write_fzf_response 1 $'ctrl-a\n42\tOPEN\thttps://github.com/o/r/pull/42\t#42\tFix bug\talice\t2026-07-08T00:00:00Z\tbug,ready\n'
  write_fzf_response 2 $'merge\tMerge pull request\n'

  run_ghfzf_with_answer y pr -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <pr> <merge> <42> <-R> <owner/repo>' ]

  reset_fakes
  write_fzf_response 1 $'ctrl-a\n42\tOPEN\thttps://github.com/o/r/pull/42\t#42\tFix bug\talice\t2026-07-08T00:00:00Z\tbug,ready\n'
  write_fzf_response 2 $'add-label\tAdd label\n'
  write_fzf_response 3 $'needs review\n'

  run_ghfzf_with_answer y pr -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <pr> <edit> <42> <--add-label> <needs review> <-R> <owner/repo>' ]

  reset_fakes
  write_fzf_response 1 $'ctrl-a\n42\tOPEN\thttps://github.com/o/r/pull/42\t#42\tFix bug\talice\t2026-07-08T00:00:00Z\tbug,ready\n'
  write_fzf_response 2 $'remove-label\tRemove label\n'
  write_fzf_response 3 $'ready\n'

  run_ghfzf_with_answer y pr -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <pr> <edit> <42> <--remove-label> <ready> <-R> <owner/repo>' ]
}

@test "issue close reopen and label actions use exact gh commands" {
  write_fzf_response 1 $'ctrl-a\n7\tOPEN\thttps://github.com/o/r/issues/7\t#7\tBroken thing\tbob\t2026-07-08T00:00:00Z\ttriage\n'
  write_fzf_response 2 $'close\tClose issue\n'

  run_ghfzf_with_answer y issue -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <issue> <close> <7> <-R> <owner/repo>' ]

  reset_fakes
  export GH_ISSUE_ROWS=$'8\tCLOSED\thttps://github.com/o/r/issues/8\t#8\tClosed thing\tbob\t2026-07-08T00:00:00Z\ttriage'
  write_fzf_response 1 $'ctrl-a\n8\tCLOSED\thttps://github.com/o/r/issues/8\t#8\tClosed thing\tbob\t2026-07-08T00:00:00Z\ttriage\n'
  write_fzf_response 2 $'reopen\tReopen issue\n'

  run_ghfzf_with_answer y issue -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <issue> <reopen> <8> <-R> <owner/repo>' ]

  reset_fakes
  write_fzf_response 1 $'ctrl-a\n7\tOPEN\thttps://github.com/o/r/issues/7\t#7\tBroken thing\tbob\t2026-07-08T00:00:00Z\ttriage\n'
  write_fzf_response 2 $'add-label\tAdd label\n'
  write_fzf_response 3 $'bug\n'

  run_ghfzf_with_answer y issue -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <issue> <edit> <7> <--add-label> <bug> <-R> <owner/repo>' ]
}

@test "run actions use exact gh commands and confirm filesystem writes" {
  write_fzf_response 1 $'ctrl-a\n555\tcompleted\tfailure\thttps://github.com/o/r/actions/runs/555\t555\tCI\tFix bug\tmain\tpush\t2026-07-08T00:00:00Z\n'
  write_fzf_response 2 $'watch\tWatch run\n'

  run_zsh_function "$GHFZF" run -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <run> <watch> <555> <-R> <owner/repo>' ]

  reset_fakes
  write_fzf_response 1 $'ctrl-a\n555\tcompleted\tfailure\thttps://github.com/o/r/actions/runs/555\t555\tCI\tFix bug\tmain\tpush\t2026-07-08T00:00:00Z\n'
  write_fzf_response 2 $'failed-logs\tFailed logs\n'

  run_zsh_function "$GHFZF" run -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <run> <view> <555> <--log-failed> <-R> <owner/repo>' ]

  reset_fakes
  write_fzf_response 1 $'ctrl-a\n555\tcompleted\tfailure\thttps://github.com/o/r/actions/runs/555\t555\tCI\tFix bug\tmain\tpush\t2026-07-08T00:00:00Z\n'
  write_fzf_response 2 $'rerun\tRerun run\n'

  run_ghfzf_with_answer y run -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <run> <rerun> <555> <-R> <owner/repo>' ]

  reset_fakes
  write_fzf_response 1 $'ctrl-a\n555\tcompleted\tfailure\thttps://github.com/o/r/actions/runs/555\t555\tCI\tFix bug\tmain\tpush\t2026-07-08T00:00:00Z\n'
  write_fzf_response 2 $'rerun-failed\tRerun failed jobs\n'

  run_ghfzf_with_answer y run -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <run> <rerun> <555> <--failed> <-R> <owner/repo>' ]

  reset_fakes
  write_fzf_response 1 $'ctrl-a\n555\tcompleted\tfailure\thttps://github.com/o/r/actions/runs/555\t555\tCI\tFix bug\tmain\tpush\t2026-07-08T00:00:00Z\n'
  write_fzf_response 2 $'cancel\tCancel run\n'

  run_ghfzf_with_answer y run -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <run> <cancel> <555> <-R> <owner/repo>' ]

  reset_fakes
  write_fzf_response 1 $'ctrl-a\n555\tcompleted\tfailure\thttps://github.com/o/r/actions/runs/555\t555\tCI\tFix bug\tmain\tpush\t2026-07-08T00:00:00Z\n'
  write_fzf_response 2 $'delete\tDelete run\n'

  run_ghfzf_with_answer y run -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <run> <delete> <555> <-R> <owner/repo>' ]

  reset_fakes
  write_fzf_response 1 $'ctrl-a\n555\tcompleted\tfailure\thttps://github.com/o/r/actions/runs/555\t555\tCI\tFix bug\tmain\tpush\t2026-07-08T00:00:00Z\n'
  write_fzf_response 2 $'download\tDownload artifacts\n'

  run_ghfzf_with_answer y run -R owner/repo

  [ "$status" -eq 0 ]
  [ "$(last_gh_line)" = 'gh <run> <download> <555> <-R> <owner/repo>' ]
}
