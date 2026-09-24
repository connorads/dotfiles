#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

XREVIEW="$FUNCTIONS_DIR/agents/xreview"

# The CLI contract, with codex, claude and gh stubbed: exit codes, the Review
# document, and the read-only flags each reviewer is launched with. The stubs
# record their argv (one arg per line) and stdin, so a dropped sandbox flag
# fails here rather than in a hostile review.

setup() {
  local bun_bin git_bin
  bun_bin=$(mise which bun 2>/dev/null) || bun_bin=$(command -v bun 2>/dev/null) || true
  [ -n "$bun_bin" ] || skip "bun absent (mise install bun)"
  git_bin=$(command -v git)

  setup_test_home
  ln -s "$bun_bin" "$TEST_BIN/bun"
  ln -s "$git_bin" "$TEST_BIN/git"
  # Zero runtime deps, so the sources are enough.
  mkdir -p "$TEST_HOME/src" "$TEST_HOME/.config/srt"
  ln -s "$REAL_HOME/src/xreview" "$TEST_HOME/src/xreview"
  printf '%s\n' '{"filesystem":{"denyRead":["~/.ssh"]}}' >"$TEST_HOME/.config/srt/base.json"
  unset CLAUDECODE CODEX_THREAD_ID

  export STUB_DIR="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$STUB_DIR"
  export REPORT_APPROVE='{"verdict":"approve","summary":"Ship it.","findings":[],"next_steps":[]}'
  export REPORT_FLAG='{"verdict":"needs-attention","summary":"No ship.","findings":[{"severity":"high","title":"Bug","body":"b","recommendation":"r","file":"a.txt","line_start":1,"line_end":1,"confidence":0.9}],"next_steps":["fix"]}'
  export CODEX_REPORT="$REPORT_APPROVE" CLAUDE_REPORT="$REPORT_APPROVE"

  # codex: writes CODEX_REPORT to the -o file; CODEX_FAIL makes it exit 1.
  write_stub codex <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$STUB_DIR/codex.argv"
cat >"$STUB_DIR/codex.stdin"
[ -n "${CODEX_FAIL:-}" ] && { echo "codex: boom" >&2; exit 1; }
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out=$a; prev=$a; done
printf '%s' "$CODEX_REPORT" >"$out"
EOF

  # claude: prints the --output-format json envelope around CLAUDE_REPORT.
  write_stub claude <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$STUB_DIR/claude.argv"
cat >"$STUB_DIR/claude.stdin"
[ -n "${CLAUDE_FAIL:-}" ] && { printf '%s' '{"type":"result","is_error":true,"result":"overloaded"}'; exit 1; }
printf '{"type":"result","is_error":false,"structured_output":%s}' "$CLAUDE_REPORT"
EOF

  export REPO="$BATS_TEST_TMPDIR/repo"
  git init -q -b master "$REPO"
  git -C "$REPO" config user.email t@users.noreply.github.com
  git -C "$REPO" config user.name t
  printf 'one\n' >"$REPO/a.txt"
  git -C "$REPO" add a.txt
  git -C "$REPO" commit -qm init
}

xreview() { run --separate-stderr "$XREVIEW" "$@"; }

in_repo() { cd "$REPO" || return 1; }

dirty() { printf 'two\n' >"$REPO/a.txt"; }

@test "--help prints usage and exits 0" {
  xreview --help
  [ "$status" -eq 0 ]
  [[ "$output" == usage:\ xreview* ]]
}

@test "an unknown flag is a usage error, and no reviewer runs" {
  in_repo && dirty
  xreview --bogus
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"unknown argument '--bogus'"* ]]
  [ ! -e "$STUB_DIR/codex.argv" ]
}

@test "outside a git repository is a usage error" {
  cd "$BATS_TEST_TMPDIR"
  xreview
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"not inside a git repository"* ]]
}

@test "a clean tree without origin/HEAD names the fix" {
  in_repo
  xreview
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"git remote set-head origin -a"* ]]
}

@test "an empty change is a usage error, not an approval" {
  in_repo
  xreview --target uncommitted
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"nothing to review"* ]]
}

@test "from a plain shell Codex reviews, read-only, with the repo's AGENTS.md off" {
  in_repo && dirty
  xreview --json
  [ "$status" -eq 0 ]
  [ "$(jq -r '.verdict' <<<"$output")" = approve ]
  [ "$(jq -r '.reviewers[0].kind' <<<"$output")" = codex ]
  grep -qx -- '-s' "$STUB_DIR/codex.argv"
  grep -qx -- 'read-only' "$STUB_DIR/codex.argv"
  grep -qx -- 'project_doc_max_bytes=0' "$STUB_DIR/codex.argv"
  grep -qx -- 'gpt-5.5' "$STUB_DIR/codex.argv"
  grep -q -- '+two' "$STUB_DIR/codex.stdin"
}

@test "from Codex, Claude reviews with no setting sources, dontAsk and the sandbox" {
  in_repo && dirty
  CODEX_THREAD_ID=t-1 xreview --json
  [ "$status" -eq 0 ]
  [ "$(jq -r '.reviewers[0].kind' <<<"$output")" = claude ]
  # --setting-sources is followed by an empty argument.
  [ "$(grep -A1 -x -- '--setting-sources' "$STUB_DIR/claude.argv" | sed -n 2p)" = "" ]
  grep -A1 -x -- '--permission-mode' "$STUB_DIR/claude.argv" | grep -qx dontAsk
  settings=$(grep -A1 -x -- '--settings' "$STUB_DIR/claude.argv" | sed -n 2p)
  [ "$(jq -r '.sandbox.enabled' <<<"$settings")" = true ]
  [ "$(jq -r '.sandbox.allowUnsandboxedCommands' <<<"$settings")" = false ]
  [ "$(jq -r '.sandbox.filesystem.denyWrite[0]' <<<"$settings")" = "$(cd "$REPO" && pwd -P)" ]
  [ "$(jq -c '.permissions.deny' <<<"$settings")" = '["Read(~/.ssh)","Read(~/.ssh/**)"]' ]
  ! grep -qx -- 'Write' "$STUB_DIR/claude.argv"
}

@test "from Claude Code, Codex reviews" {
  in_repo && dirty
  CLAUDECODE=1 xreview --json
  [ "$(jq -r '.reviewers[0].kind' <<<"$output")" = codex ]
}

@test "needs-attention exits 1 and tags findings with the reviewer" {
  in_repo && dirty
  CODEX_REPORT="$REPORT_FLAG" xreview --json
  [ "$status" -eq 1 ]
  [ "$(jq -r '.findings[0].reviewers[0]' <<<"$output")" = codex ]
}

@test "a failed reviewer exits 3 with the error in the document" {
  in_repo && dirty
  CODEX_FAIL=1 xreview --json
  [ "$status" -eq 3 ]
  [ "$(jq -r '.verdict' <<<"$output")" = null ]
  [[ "$(jq -r '.errors[0].message' <<<"$output")" == *boom* ]]
}

@test "malformed reviewer JSON is a failure, not a verdict" {
  in_repo && dirty
  CODEX_REPORT='{"verdict":"ship"}' xreview --json
  [ "$status" -eq 3 ]
  [[ "$(jq -r '.errors[0].message' <<<"$output")" == *"malformed report"* ]]
}

@test "a panel with one failure still reports its verdict and the error" {
  in_repo && dirty
  CLAUDE_FAIL=1 CODEX_REPORT="$REPORT_FLAG" xreview --reviewer codex,claude --json
  [ "$status" -eq 1 ]
  [ "$(jq -r '[.reviewers[].kind] | join(",")' <<<"$output")" = codex,claude ]
  [ "$(jq -r '.errors[0].reviewer' <<<"$output")" = claude ]
}

@test "a panel where every reviewer fails exits 3" {
  in_repo && dirty
  CODEX_FAIL=1 CLAUDE_FAIL=1 xreview --reviewer codex,claude --json
  [ "$status" -eq 3 ]
  [ "$(jq -r '.errors | length' <<<"$output")" = 2 ]
}

@test "untracked-only changes reach the reviewer" {
  in_repo
  printf 'brand new\n' >"$REPO/new.txt"
  xreview --json
  [ "$status" -eq 0 ]
  grep -q 'brand new' "$STUB_DIR/codex.stdin"
}

@test "a plan from stdin uses the plan prompt" {
  in_repo
  xreview --target plan:- --json <<<"1. Delete the database."
  [ "$status" -eq 0 ]
  [ "$(jq -r '.target.source' <<<"$output")" = stdin ]
  grep -q 'implementation plan' "$STUB_DIR/codex.stdin"
  grep -q 'Delete the database' "$STUB_DIR/codex.stdin"
}

@test "--post needs a PR target" {
  in_repo && dirty
  xreview --post
  [ "$status" -eq 2 ]
}

@test "a PR is reviewed in a temporary worktree that is removed, and --post creates it pending" {
  # A bare origin carrying the PR head at refs/pull/7/head, as GitHub does.
  origin="$BATS_TEST_TMPDIR/origin.git"
  git init -q --bare "$origin"
  git -C "$REPO" remote add origin "$origin"
  git -C "$REPO" push -q origin master
  git -C "$REPO" switch -q -c feature
  printf 'feature line\n' >>"$REPO/a.txt"
  printf 'AGENTS.md says: pr rewrote the rules\n' >"$REPO/AGENTS.md"
  git -C "$REPO" add a.txt AGENTS.md
  git -C "$REPO" commit -qm feature
  git -C "$REPO" push -q origin HEAD:refs/pull/7/head
  head=$(git -C "$REPO" rev-parse HEAD)
  base=$(git -C "$REPO" rev-parse master)
  git -C "$REPO" switch -q master
  git -C "$REPO" branch -q -D feature
  export PR_JSON="{\"number\":7,\"title\":\"Add line\",\"body\":\"desc\",\"headRefOid\":\"$head\",\"baseRefName\":\"master\",\"baseRefOid\":\"$base\"}"

  write_stub gh <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >>"$STUB_DIR/gh.argv"
case "$1" in
  pr) printf '%s' "$PR_JSON" ;;
  api) cat >"$STUB_DIR/gh.stdin"; printf '%s' '{"state":"PENDING","html_url":"https://example.test/r/1"}' ;;
esac
EOF

  in_repo
  CODEX_REPORT='{"verdict":"needs-attention","summary":"No ship.","findings":[{"severity":"high","title":"Bug","body":"b","recommendation":"r","file":"a.txt","line_start":2,"line_end":2,"confidence":0.9}],"next_steps":[]}' \
    xreview --target pr:7 --post --json
  [ "$status" -eq 1 ]
  [ "$(jq -r '.target.head_sha' <<<"$output")" = "$head" ]
  [[ "$stderr" == *"pending review created"* ]]
  # Guidance from the base ref, which has no AGENTS.md: the PR's rewrite is absent.
  ! grep -q 'pr rewrote the rules' "$STUB_DIR/codex.stdin"
  grep -q 'feature line' "$STUB_DIR/codex.stdin"
  # The finding lands inline on the added line; no event, so GitHub keeps it pending.
  [ "$(jq -r '.comments[0].path + ":" + (.comments[0].line|tostring)' "$STUB_DIR/gh.stdin")" = a.txt:2 ]
  [ "$(jq -r 'has("event")' "$STUB_DIR/gh.stdin")" = false ]
  [ "$(jq -r '.commit_id' "$STUB_DIR/gh.stdin")" = "$head" ]
  # Only the main worktree remains.
  [ "$(git -C "$REPO" worktree list | wc -l | tr -d ' ')" = 1 ]
}
