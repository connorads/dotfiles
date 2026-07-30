#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

GIT_HOOKS="$FUNCTIONS_DIR/git/git-hooks"

# `git hook list` and config hooks (hook.<name>.command) both need git >= 2.54:
# the subcommand existed briefly in 2.36, was dropped again, and returned with
# config hooks. macOS ships Apple git 2.50, which is first on the sanitised test
# PATH and has `git hook run` but no `list` - so a suite that took the ambient
# git would only ever exercise the degraded path. Discovery mirrors
# `_discover_bash5`: nix profile bins, in the same order.
_git_at_least_254() {
  local ver
  ver="$("$1" --version 2>/dev/null | awk '{print $3}')"
  case "$ver" in
  1.* | 2.[0-9] | 2.[0-9].* | 2.[0-4][0-9] | 2.[0-4][0-9].* | 2.5[0-3] | 2.5[0-3].*) return 1 ;;
  esac
  return 0
}

_discover_git254() {
  local dir
  for dir in "${_nix_profile_bins[@]}" /opt/homebrew/bin; do
    [ -x "$dir/git" ] || continue
    _git_at_least_254 "$dir/git" || continue
    printf '%s\n' "$dir/git"
    return 0
  done
  return 1
}

setup() {
  setup_test_home
  local git254
  git254="$(_discover_git254 || true)"
  [ -n "$git254" ] || skip "no git >= 2.54 available (config hooks unsupported)"
  ln -s "$git254" "$TEST_BIN/git"
}

make_repo() {
  local repo=$1

  git init -b main "$repo" >/dev/null
  git -C "$repo" config user.name "Bats"
  git -C "$repo" config user.email "bats@example.com"
  echo "base" >"$repo/base.txt"
  git -C "$repo" add base.txt
  git -C "$repo" commit -m "initial" >/dev/null
}

# Run git-hooks with $repo as cwd, under the isolated HOME/PATH so the real
# user's global git config (which carries the guard) can never leak in.
run_hooks() {
  local repo=$1
  shift
  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$GIT_HOOKS' $*"
}

write_hook() {
  local path=$1
  local body=$2

  mkdir -p "$(dirname "$path")"
  printf '#!/usr/bin/env sh\n%s\n' "$body" >"$path"
  chmod +x "$path"
}

@test "git-hooks errors outside a git repository" {
  run_hooks "$BATS_TEST_TMPDIR" status

  [ "$status" -ne 0 ]
  [[ "$output" == *"error: not in a git repository"* ]]
}

@test "git-hooks rejects an unknown subcommand" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run_hooks "$repo" arm

  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown subcommand: arm"* ]]
}

@test "git-hooks is silent with --quiet when nothing is declared" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run_hooks "$repo" status --quiet

  [ "$status" -eq 0 ]
  [ -z "$output" ]

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: none declared"* ]]
}

@test "git-hooks reports a declared-but-unarmed husky repo with its payload" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  write_hook "$repo/.husky/pre-commit" 'npx lint-staged'

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: husky - declared, not armed"* ]]
  [[ "$output" == *".husky/pre-commit  ->  npx lint-staged"* ]]
  [[ "$output" == *"arm: npx husky"* ]]
}

@test "git-hooks attributes an armed husky repo to core.hooksPath" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  write_hook "$repo/.husky/pre-commit" 'npx lint-staged'
  # What `npx husky` installs: a shim dir of generated hooks, none of which
  # names husky, plus core.hooksPath pointing at it.
  write_hook "$repo/.husky/_/pre-commit" '. "$(dirname "$0")/h"'
  git -C "$repo" config core.hooksPath .husky/_

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: husky - armed (core.hooksPath=.husky/_)"* ]]
}

@test "git-hooks reports a declared-but-unarmed hk repo" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  printf 'hooks {\n  ["pre-commit"] {\n  }\n}\n' >"$repo/hk.pkl"

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: hk - declared, not armed"* ]]
  [[ "$output" == *"hk.pkl  ->  hk run pre-commit"* ]]
  [[ "$output" == *"arm: hk install"* ]]
}

@test "git-hooks attributes an hk repo armed via a config hook" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  printf 'hooks {\n  ["pre-commit"] {\n  }\n}\n' >"$repo/hk.pkl"
  git -C "$repo" config hook.hk-pre-commit.command "hk run pre-commit"
  git -C "$repo" config hook.hk-pre-commit.event pre-commit

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: hk - armed (hook.hk-pre-commit.command)"* ]]
}

@test "git-hooks attributes an hk repo armed via core.hooksPath" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  printf 'hooks {\n  ["pre-commit"] {\n  }\n}\n' >"$repo/hk.pkl"
  # A tracked wrapper that reaches hk through a variable, so the file itself
  # never spells "hk run" - the hookdir path is the only attribution available.
  write_hook "$repo/.hk-hooks/pre-commit" 'exec "$HK_BIN" run pre-commit "$@"'
  git -C "$repo" config core.hooksPath .hk-hooks

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: hk - armed (core.hooksPath=.hk-hooks)"* ]]
}

@test "git-hooks detects lefthook and the pre-commit framework" {
  local repo="$BATS_TEST_TMPDIR/lefthook-repo"
  make_repo "$repo"
  printf 'pre-commit:\n  commands:\n    lint:\n      run: echo lint\n' >"$repo/lefthook.yml"

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: lefthook - declared, not armed"* ]]
  [[ "$output" == *"arm: lefthook install"* ]]

  local pc_repo="$BATS_TEST_TMPDIR/pre-commit-repo"
  make_repo "$pc_repo"
  printf 'repos:\n  - repo: local\n    hooks:\n      - id: echo\n' >"$pc_repo/.pre-commit-config.yaml"

  run_hooks "$pc_repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: pre-commit - declared, not armed"* ]]
  [[ "$output" == *"arm: pre-commit install"* ]]
}

@test "git-hooks lists both managers when two are declared" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  write_hook "$repo/.husky/pre-commit" 'npx lint-staged'
  printf 'hooks {\n  ["pre-commit"] {\n  }\n}\n' >"$repo/hk.pkl"

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: husky - declared, not armed"* ]]
  [[ "$output" == *"hooks: hk - declared, not armed"* ]]
}

@test "git-hooks reports a pre-push-only repo" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  write_hook "$repo/.husky/pre-push" 'pnpm test'

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: husky - declared, not armed"* ]]
  [[ "$output" == *".husky/pre-push  ->  pnpm test"* ]]
  [[ "$output" != *"none declared"* ]]
}

@test "git-hooks --json carries manager, declared and armed state" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  write_hook "$repo/.husky/pre-commit" 'npx lint-staged'

  run_hooks "$repo" status --json

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.managers[0].name')" = "husky" ]
  [ "$(printf '%s' "$output" | jq -r '.managers[0].declared')" = "true" ]
  [ "$(printf '%s' "$output" | jq -r '.managers[0].armed')" = "false" ]
  [ "$(printf '%s' "$output" | jq -r '.managers[0].events[0]')" = "pre-commit" ]
  [ "$(printf '%s' "$output" | jq -r '.actionable')" = "true" ]
  [ "$(printf '%s' "$output" | jq -r '.hook_list_supported')" = "true" ]

  git -C "$repo" config core.hooksPath .husky/_
  write_hook "$repo/.husky/_/pre-commit" '. "$(dirname "$0")/h"'

  run_hooks "$repo" status --json

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.managers[0].armed')" = "true" ]
  [ "$(printf '%s' "$output" | jq -r '.managers[0].armed_via[0]')" = "core.hooksPath=.husky/_" ]
  [ "$(printf '%s' "$output" | jq -r '.actionable')" = "false" ]
}

@test "git-hooks --check exits 2 unarmed and 0 armed" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  write_hook "$repo/.husky/pre-commit" 'npx lint-staged'

  run_hooks "$repo" status --check

  [ "$status" -eq 2 ]

  write_hook "$repo/.husky/_/pre-commit" '. "$(dirname "$0")/h"'
  git -C "$repo" config core.hooksPath .husky/_

  run_hooks "$repo" status --check

  [ "$status" -eq 0 ]
}

@test "git-hooks reports a stale hookdir stub git silently skips" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  ln -s "/nix/store/gone-home-manager-files/.config/git/template/hooks/pre-commit" \
    "$repo/.git/hooks/pre-commit"

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  # Path prefix unasserted: git resolves the git dir, so on macOS $TMPDIR's
  # /var comes back as /private/var.
  [[ "$output" == *"stale: /"*"/.git/hooks/pre-commit -> /nix/store/gone-home-manager-files/"* ]]
  [[ "$output" == *"(dangling; git skips it)"* ]]
}

@test "git-hooks reports whether the identity guard fires" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"guard: identity-guard NOT firing"* ]]

  local guard="$BATS_TEST_TMPDIR/identity-guard"
  write_hook "$guard" 'exit 0'
  git -C "$repo" config hook.identity-guard.command "$guard"
  git -C "$repo" config hook.identity-guard.event pre-commit

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"guard: identity-guard fires (hook.identity-guard.command)"* ]]
}

@test "git-hooks leaks no variable dumps when its names exist in the environment" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  # An inherited env var is a shell parameter in zsh, and a bare `local name` at
  # script scope then *prints* it - `/etc/zshenv` leaves `p` set from its
  # completion loop, so real runs emitted a stray "p=/Users/...nix-profile"
  # line. Every declaration carries an assignment; these sentinels prove it.
  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' p=SENTINEL line=SENTINEL rec=SENTINEL ev=SENTINEL cand=SENTINEL via=SENTINEL name=SENTINEL zsh --no-rcs '$GIT_HOOKS' status --quiet"

  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "git-hooks says armed state is unknown on a git without 'git hook list'" {
  [ -x /usr/bin/git ] || skip "no /usr/bin/git to stand in for an older git"
  ! _git_at_least_254 /usr/bin/git || skip "/usr/bin/git is >= 2.54"

  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  write_hook "$repo/.husky/pre-commit" 'npx lint-staged'

  # Swap the discovered git for the older one, for this call only.
  ln -sf /usr/bin/git "$TEST_BIN/git"

  run_hooks "$repo" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: husky - declared (.husky), armed state unknown"* ]]
  [[ "$output" == *"guard: unknown"* ]]

  # A git that cannot answer the question must not fail the caller.
  run_hooks "$repo" status --check

  [ "$status" -eq 0 ]
}
