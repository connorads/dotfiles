#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# ghcl-org's SSH-url and clone-dir rules live in `_ghcl-common`, so this suite
# covers that file as much as it covers ghcl-org. Naming it here is what makes
# the `bats-scoped` hk gate (a `grep -rlw` on the staged file's stem) run this
# suite for a commit touching only `_ghcl-common`.
GHCL_ORG="$FUNCTIONS_DIR/git/ghcl-org"

setup() {
  setup_test_home

  export WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
  cd "$WORK" || return 1

  export GH_LOG="$BATS_TEST_TMPDIR/gh.log"
  export GH_ROWS="$BATS_TEST_TMPDIR/gh.rows"
  export GIT_LOG="$BATS_TEST_TMPDIR/git.log"
  : >"$GH_LOG"
  : >"$GH_ROWS"
  : >"$GIT_LOG"

  # gh stub: emits the TSV real gh would produce *after* --jq, i.e.
  # name<TAB>nameWithOwner<TAB>defaultBranch<TAB>isArchived<TAB>isFork.
  write_stub gh <<'EOF'
#!/usr/bin/env bash
{
  printf 'gh'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >>"$GH_LOG"
[ -n "${GH_STDERR:-}" ] && printf '%s\n' "$GH_STDERR" >&2
rc="${GH_RC:-0}"
[ "$rc" = 0 ] && [ -f "$GH_ROWS" ] && cat "$GH_ROWS"
exit "$rc"
EOF

  # git: a logging wrapper around the real thing, not a replacement. The probe
  # has to observe real repos (that is the half a stub cannot fake), while the
  # log is what proves the tool only ever reads.
  REAL_GIT="$(command -v git)"
  export REAL_GIT
  write_stub git <<'EOF'
#!/usr/bin/env bash
{
  printf 'git'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >>"$GIT_LOG"
exec "$REAL_GIT" "$@"
EOF
}

rows() {
  printf '%s\n' "$@" >"$GH_ROWS"
}

# A listing row, tab-joined: name, nameWithOwner, default branch, archived, fork.
row() {
  printf '%s\t%s\t%s\t%s\t%s' "$1" "$2" "$3" "${4:-false}" "${5:-false}"
}

make_repo() {
  local dir=$1 branch=$2 origin=${3:-}

  git init -q -b "$branch" "$dir"
  git -C "$dir" config user.name Bats
  git -C "$dir" config user.email bats@example.com
  [ -n "$origin" ] && git -C "$dir" remote add origin "$origin"
  return 0
}

commit_in() {
  local dir=$1

  echo base >"$dir/base.txt"
  git -C "$dir" add base.txt
  git -C "$dir" commit -q -m initial
}

# Truncate the logs so each assertion sees only ghcl-org's own invocations, not
# the fixture setup's.
run_org() {
  : >"$GH_LOG"
  : >"$GIT_LOG"
  run_zsh_function "$GHCL_ORG" "$@"
}

# The plan row for REPO, as `action<TAB>reason`, read back out of --json.
plan_of() {
  printf '%s' "$output" | jq -r --arg r "$1" '.[] | select(.repo == $r) | "\(.action)\t\(.reason // "")"'
}

@test "an absent repo plans a clone" {
  rows "$(row api acme/api main)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of api)" = "$(printf 'clone\t')" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.repo == "api") | .url')" = "git@github.com:acme/api.git" ]
}

@test "archived repos and forks are not selected" {
  rows \
    "$(row api acme/api main)" \
    "$(row arch acme/arch main true false)" \
    "$(row oldfork acme/oldfork main false true)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '[.[].repo] | join(",")')" = "api" ]
}

@test "an empty repo is skipped, not cloned" {
  rows "$(row empty acme/empty '')"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of empty)" = "$(printf 'skip\tempty')" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.repo == "empty") | .default_branch')" = "null" ]
}

@test "a repo on its default branch plans a pull" {
  make_repo web main git@github.com:acme/web.git
  rows "$(row web acme/web main)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of web)" = "$(printf 'pull\t')" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.repo == "web") | .local_branch')" = "main" ]
}

@test "a repo on a non-default branch is skipped" {
  make_repo web feat/x git@github.com:acme/web.git
  rows "$(row web acme/web main)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of web)" = "$(printf 'skip\tnot-default-branch')" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.repo == "web") | .local_branch')" = "feat/x" ]
}

@test "a detached HEAD is skipped" {
  make_repo web main git@github.com:acme/web.git
  commit_in web
  git -C web checkout -q --detach HEAD
  rows "$(row web acme/web main)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of web)" = "$(printf 'skip\tdetached')" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.repo == "web") | .local_branch')" = "null" ]
}

@test "a repo with no origin is skipped" {
  make_repo web main
  rows "$(row web acme/web main)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of web)" = "$(printf 'skip\tno-origin')" ]
}

@test "a plain directory colliding with a repo name is skipped" {
  mkdir api
  rows "$(row api acme/api main)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of api)" = "$(printf 'skip\tnot-a-repo')" ]
}

@test "a plain directory inside a checkout is still not-a-repo" {
  # rev-parse --show-toplevel walks UP, so a plain dir inside a checkout reports
  # its ancestor's toplevel - reading the return code alone would call this a
  # repo and plan a pull against the wrong tree.
  git init -q -b main .
  mkdir api
  rows "$(row api acme/api main)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of api)" = "$(printf 'skip\tnot-a-repo')" ]
}

@test "an inherited GIT_DIR does not fool the probe" {
  # `git -C` does not override an exported GIT_DIR, and the dotfiles pre-commit
  # hook exports one - so without the probe's own shadowing every repo would be
  # observed as whatever repo the caller's environment named.
  make_repo elsewhere feat/x
  make_repo web main git@github.com:acme/web.git
  rows "$(row web acme/web main)"

  export GIT_DIR="$WORK/elsewhere/.git" GIT_WORK_TREE="$WORK/elsewhere"
  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of web)" = "$(printf 'pull\t')" ]
}

@test "an unlisted repo pointing at the org is orphaned" {
  make_repo gone main git@github.com:acme/gone.git
  rows "$(row api acme/api main)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of gone)" = "$(printf 'orphaned\t')" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.repo == "gone") | .owner')" = "null" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.repo == "gone") | .url')" = "null" ]
}

@test "an https origin is recognised for orphan membership" {
  make_repo gone main https://github.com/acme/gone.git
  rows "$(row api acme/api main)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(plan_of gone)" = "$(printf 'orphaned\t')" ]
}

@test "a repo belonging to another org is not an orphan" {
  make_repo other main git@github.com:someoneelse/other.git
  rows "$(row api acme/api main)"

  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '[.[].repo] | join(",")')" = "api" ]
}

@test "the plan phase runs no git command that can write" {
  make_repo web main git@github.com:acme/web.git
  make_repo gone main git@github.com:acme/gone.git
  mkdir plain
  rows "$(row api acme/api main)" "$(row web acme/web main)"

  run_org acme --dry-run

  [ "$status" -eq 0 ]
  [ -s "$GIT_LOG" ]
  # Every logged invocation must name one of the three read-only subcommands.
  run grep -cvE '<(rev-parse|symbolic-ref|remote)>' "$GIT_LOG"
  [ "$output" = "0" ]
}

@test "every probe git call carries --no-optional-locks" {
  make_repo web main git@github.com:acme/web.git
  rows "$(row web acme/web main)"

  run_org acme --dry-run

  [ "$status" -eq 0 ]
  run grep -cv -- '<--no-optional-locks>' "$GIT_LOG"
  [ "$output" = "0" ]
}

@test "the dry-run table reports each action" {
  make_repo web main git@github.com:acme/web.git
  make_repo feat feat/x git@github.com:acme/feat.git
  make_repo gone main git@github.com:acme/gone.git
  rows \
    "$(row api acme/api main)" \
    "$(row web acme/web main)" \
    "$(row feat acme/feat main)"

  run_org acme --dry-run

  [ "$status" -eq 0 ]
  [[ "$output" == *"REPO"*"ACTION"*"DETAIL"* ]]
  [[ "$output" == *"api"*"clone"* ]]
  [[ "$output" == *"web"*"pull"* ]]
  [[ "$output" == *"not-default-branch (on feat/x, want main)"* ]]
  [[ "$output" == *"gone"*"orphaned"* ]]
  [[ "$output" == *"clone"*"1"* ]]
}

@test "two dry-runs in a row produce identical output" {
  make_repo web main git@github.com:acme/web.git
  rows "$(row api acme/api main)" "$(row web acme/web main)"

  run_org acme --dry-run
  [ "$status" -eq 0 ]
  local first="$output"

  run_org acme --dry-run
  [ "$status" -eq 0 ]
  [ "$output" = "$first" ]
}

@test "an org listing nothing reports nothing to do" {
  run_org acme

  [ "$status" -eq 0 ]
  [[ "$output" == *"Nothing to do"* ]]
}

@test "--json on an empty plan emits an empty array" {
  run_org acme --json

  [ "$status" -eq 0 ]
  [ "$output" = "[]" ]
}

@test "a listing that hits --limit is refused" {
  rows "$(row api acme/api main)" "$(row web acme/web main)"

  run_org acme --limit 2

  [ "$status" -eq 1 ]
  [[ "$output" == *"hit --limit 2"* ]]
}

@test "--limit rejects a non-numeric value before calling gh" {
  run_org acme --limit lots

  [ "$status" -eq 1 ]
  [[ "$output" == *"positive integer"* ]]
  [ ! -s "$GH_LOG" ]
}

@test "an SSO 403 answers with the grant path" {
  export GH_RC=1
  export GH_STDERR='HTTP 403: Resource protected by organization SAML enforcement.'

  run_org acme --dry-run

  [ "$status" -eq 1 ]
  [[ "$output" == *"not SSO-authorised for 'acme'"* ]]
  [[ "$output" == *"SSO organisation access"* ]]
}

@test "a non-SSO gh failure reports plainly" {
  export GH_RC=1
  export GH_STDERR='could not resolve to an Organization'

  run_org acme --dry-run

  [ "$status" -eq 1 ]
  [[ "$output" == *"unable to list repos for 'acme'"* ]]
  [[ "$output" != *"SSO organisation access"* ]]
}

@test "a missing org errors before calling gh" {
  run_org

  [ "$status" -eq 1 ]
  [[ "$output" == *"an org is required"* ]]
  [ ! -s "$GH_LOG" ]
}

@test "an unknown flag errors before calling gh" {
  run_org acme --bogus

  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown flag --bogus"* ]]
  [ ! -s "$GH_LOG" ]
}

@test "a second positional argument errors" {
  run_org acme other-org

  [ "$status" -eq 1 ]
  [[ "$output" == *"unexpected argument: other-org"* ]]
  [ ! -s "$GH_LOG" ]
}

@test "--help prints usage without calling gh" {
  run_org --help

  [ "$status" -eq 0 ]
  [[ "$output" == *"usage: ghcl-org"* ]]
  [ ! -s "$GH_LOG" ]
}
