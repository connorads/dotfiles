#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

ATP="$FUNCTIONS_DIR/agent-teleport"
RESOLVER="$BATS_TEST_DIRNAME/../../tmux/scripts/claude-session-resolve.py"

setup() {
  setup_test_home
  # Point the function at the real tmux script libs while $HOME is faked.
  export ATP_TMUX_SCRIPTS="$BATS_TEST_DIRNAME/../../tmux/scripts"
  # Deterministic empty environ for claude_config_dir_for_pid on all platforms.
  export RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/proc"
}

atp() {
  run_zsh_function "$ATP" "$@"
}

# --- pure helpers ------------------------------------------------------------

@test "slugify replaces every non-alphanumeric char including dots" {
  atp --internal slugify "/Users/x/.trees/repo"
  [ "$status" -eq 0 ]
  [ "$output" = "-Users-x--trees-repo" ]
}

@test "slugify matches the python resolver's project_slug" {
  local path="/Users/x/.trees/repo.v2"
  atp --internal slugify "$path"
  local zsh_slug="$output"
  py_slug=$(
    python3 - "$RESOLVER" "$path" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("resolver", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
sys.modules["resolver"] = mod  # dataclasses on 3.9 needs the module registered
spec.loader.exec_module(mod)
print(mod.project_slug(sys.argv[2]))
PY
  )
  [ "$zsh_slug" = "$py_slug" ]
}

@test "uuid7 emits a lowercase RFC 9562 v7 uuid" {
  atp --internal uuid7
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
}

@test "claude rewrite renames ids and cwd, preserves everything else" {
  local src="$BATS_TEST_TMPDIR/src.jsonl" out="$BATS_TEST_TMPDIR/out.jsonl"
  cat >"$src" <<'EOF'
{"sessionId":"old-id","cwd":"/old/path","type":"user","message":{"content":"hello /old/path"}}
{"sessionId":"old-id","cwd":"/old/path","type":"assistant","message":{"content":"hi"},"costUSD":0.05}
{"type":"summary","summary":"no sid or cwd here"}
EOF
  local newid="4ab29cb2-19a1-4c7c-9f30-5f4d3aab6c10"

  atp --internal rewrite-claude "$src" "$out" "$newid" "/new/dest"

  [ "$status" -eq 0 ]
  [ "$(wc -l <"$out" | tr -d ' ')" = "3" ]
  # Every line that has the fields carries the new values.
  [ "$(jq -rs '[.[] | select(has("sessionId")) | .sessionId] | unique | .[]' "$out")" = "$newid" ]
  [ "$(jq -rs '[.[] | select(has("cwd")) | .cwd] | unique | .[]' "$out")" = "/new/dest" ]
  # Non-target fields are untouched (message content mentioning the old path included).
  [ "$(jq -c 'del(.sessionId, .cwd)' "$src" | shasum)" = "$(jq -c 'del(.sessionId, .cwd)' "$out" | shasum)" ]
  [ "$(jq -r 'select(.type == "user") | .message.content' "$out")" = "hello /old/path" ]
}

@test "codex rewrite touches only line 1 ids; the rest ships byte-identical" {
  local src="$BATS_TEST_TMPDIR/rollout.jsonl" out="$BATS_TEST_TMPDIR/out.jsonl"
  cat >"$src" <<'EOF'
{"timestamp":"2026-07-22T10:30:00.000Z","type":"session_meta","payload":{"id":"old-uuid","session_id":"old-uuid","cwd":"/old","cli_version":"0.9.0"}}
{"timestamp":"2026-07-22T10:30:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"hello"}}
{"timestamp":"2026-07-22T10:30:02.000Z","type":"response_item","payload":{"type":"message","role":"assistant"}}
EOF
  local newid="01890a5d-ac96-774b-bcce-b302099a8057"

  atp --internal rewrite-codex "$src" "$out" "$newid"

  [ "$status" -eq 0 ]
  [ "$(head -n 1 "$out" | jq -r '.payload.id')" = "$newid" ]
  [ "$(head -n 1 "$out" | jq -r '.payload.session_id')" = "$newid" ]
  [ "$(head -n 1 "$out" | jq -r '.payload.cwd')" = "/old" ]
  cmp <(tail -n +2 "$src") <(tail -n +2 "$out")
}

@test "codex fork filename keeps the timestamp, swaps the uuid" {
  atp --internal codex-fork-name \
    "rollout-2026-07-22T10-30-00-01890a5d-ac96-774b-bcce-b302099a8056.jsonl" \
    "01890a5d-ac96-774b-bcce-b302099a8057"
  [ "$status" -eq 0 ]
  [ "$output" = "rollout-2026-07-22T10-30-00-01890a5d-ac96-774b-bcce-b302099a8057.jsonl" ]
}

@test "codex fork filename rejects an unexpected shape" {
  atp --internal codex-fork-name "rollout-not-a-uuid.jsonl" "01890a5d-ac96-774b-bcce-b302099a8057"
  [ "$status" -ne 0 ]
}

@test "remap-flags swaps only origin-home path prefixes" {
  atp --internal remap-flags /Users/origin /home/target \
    --append-system-prompt-file /Users/origin/.claude/system-append.md \
    --model opus \
    --settings=/Users/origin/.claude/x.json \
    /Users/originother/keep
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "--append-system-prompt-file" ]
  [ "${lines[1]}" = "/home/target/.claude/system-append.md" ]
  [ "${lines[2]}" = "--model" ]
  [ "${lines[3]}" = "opus" ]
  [ "${lines[4]}" = "--settings=/home/target/.claude/x.json" ]
  # /Users/originother is NOT under /Users/origin/ - must stay untouched.
  [ "${lines[5]}" = "/Users/originother/keep" ]
}

# --- tree-shipping pure helpers ------------------------------------------------

make_repo() {
  local repo=$1

  git init -q "$repo"
  git -C "$repo" config user.name "Bats"
  git -C "$repo" config user.email "bats@example.com"
  echo "base" >"$repo/base.txt"
  git -C "$repo" add base.txt
  git -C "$repo" commit -qm "initial"
}

@test "branch-name slugs the origin branch and appends 8 id hex chars" {
  atp --internal branch-name "4ab29cb2-19a1-4c7c-9f30-5f4d3aab6c10" "feature/foo.bar"
  [ "$status" -eq 0 ]
  [ "$output" = "atp/feature-foo-bar-4ab29cb2" ]
}

@test "branch-name without an origin branch is atp/<short8>" {
  atp --internal branch-name "4ab29cb2-19a1-4c7c-9f30-5f4d3aab6c10"
  [ "$status" -eq 0 ]
  [ "$output" = "atp/4ab29cb2" ]
}

@test "snapshot-ref captures staged+unstaged+untracked, origin untouched" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  local head_before status_before index_before
  head_before=$(git -C "$repo" rev-parse HEAD)
  echo staged >"$repo/staged.txt"
  git -C "$repo" add staged.txt
  echo unstaged >>"$repo/base.txt"
  echo untracked >"$repo/untracked.txt"
  echo ignored >"$repo/ignored.txt"
  echo "/ignored.txt" >"$repo/.git/info/exclude"
  status_before=$(git -C "$repo" status --porcelain)
  index_before=$(shasum "$repo/.git/index")

  atp --internal snapshot-ref "$repo" refs/atp/test

  [ "$status" -eq 0 ]
  local snap="$output"
  # One synthetic commit parented on HEAD, parked on the ref.
  [ "$(git -C "$repo" rev-parse "$snap^")" = "$head_before" ]
  [ "$(git -C "$repo" rev-parse refs/atp/test)" = "$snap" ]
  [ "$(git -C "$repo" show "$snap:staged.txt")" = "staged" ]
  [ "$(git -C "$repo" show "$snap:untracked.txt")" = "untracked" ]
  [ "$(git -C "$repo" show "$snap:base.txt")" = "$(printf 'base\nunstaged')" ]
  run git -C "$repo" cat-file -e "$snap:ignored.txt"
  [ "$status" -ne 0 ]
  # Origin repo state is byte-identical.
  [ "$(git -C "$repo" rev-parse HEAD)" = "$head_before" ]
  [ "$(git -C "$repo" status --porcelain)" = "$status_before" ]
  [ "$(shasum "$repo/.git/index")" = "$index_before" ]
}

@test "snapshot-ref on a clean tree returns HEAD and writes no ref" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  atp --internal snapshot-ref "$repo" refs/atp/test

  [ "$status" -eq 0 ]
  [ "$output" = "$(git -C "$repo" rev-parse HEAD)" ]
  run git -C "$repo" show-ref --verify refs/atp/test
  [ "$status" -ne 0 ]
}

@test "snapshot-ref fails on a repo with no commits" {
  local repo="$BATS_TEST_TMPDIR/repo"
  git init -q "$repo"
  echo x >"$repo/f.txt"

  atp --internal snapshot-ref "$repo" refs/atp/test

  [ "$status" -ne 0 ]
}

@test "bundle-prereqs keeps only locally-present shas, deduped" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  local have absent="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  have=$(git -C "$repo" rev-parse HEAD)

  atp --internal bundle-prereqs "$repo" "$have" "$absent" "$have" "not-a-sha"

  [ "$status" -eq 0 ]
  [ "$output" = "$have" ]
}

@test "tree-decision truth table" {
  local ATP_BIN="$ATP"
  decide() { zsh --no-rcs "$ATP_BIN" --internal tree-decision "$@"; }
  # with_tree no_tree is_git is_dirty tty_ok
  [ "$(decide 1 0 1 1 1)" = "on" ]     # explicit flag, git repo
  [ "$(decide 1 0 1 0 0)" = "on" ]     # explicit flag needs no tty
  [ "$(decide 1 0 0 0 1)" = "error" ]  # explicit flag, non-git cwd
  [ "$(decide 0 1 1 1 1)" = "off" ]    # --no-tree wins
  [ "$(decide 0 0 0 1 1)" = "off" ]    # non-git, no flags
  [ "$(decide 0 0 1 1 1)" = "prompt" ] # dirty + tty -> ask
  [ "$(decide 0 0 1 1 0)" = "off" ]    # dirty but no tty
  [ "$(decide 0 0 1 0 1)" = "off" ]    # clean, no flags
}

# --- argument handling -------------------------------------------------------

@test "unknown argument exits 2" {
  atp --bogus
  [ "$status" -eq 2 ]
}

@test "--pane and --pid together exit 2" {
  atp --pane %1 --pid 42
  [ "$status" -eq 2 ]
}

@test "--host without a value exits 2" {
  atp --host
  [ "$status" -eq 2 ]
}

@test "--help prints usage and exits 0" {
  atp --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage: agent-teleport"* ]]
}

@test "--list-hosts prints ssh config hosts" {
  mkdir -p "$HOME/.ssh"
  cat >"$HOME/.ssh/config" <<'EOF'
Host mac-mini
  HostName mac-mini
Host dev rpi5
Host *
EOF
  atp --list-hosts
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "mac-mini" ]
  [ "${lines[1]}" = "dev" ]
  [ "${lines[2]}" = "rpi5" ]
  [ "${#lines[@]}" -eq 3 ]
}

@test "session picker cancel exits 130" {
  # One live claude session (our own pid is alive) so the picker is reached.
  mkdir -p "$HOME/.claude/sessions"
  printf '{"sessionId":"sid-live","cwd":"/tmp"}\n' >"$HOME/.claude/sessions/$$.json"
  write_stub ts <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
exit 130
EOF

  ATP_PICKER=1 atp --host anywhere --copy
  [ "$status" -eq 130 ]
}

# --- full flows with a stubbed remote ---------------------------------------

# Seed a live-looking Claude session (pid 4242) plus the ts/ps/pbcopy stubs.
setup_claude_flow() {
  export SID="11111111-2222-3333-4444-555555555555"
  export ORIGIN_CWD="$HOME/proj"
  mkdir -p "$ORIGIN_CWD" "$HOME/.claude/sessions" "$RESURRECT_PROC_ROOT/4242"
  : >"$RESURRECT_PROC_ROOT/4242/environ"
  printf '{"pid":4242,"sessionId":"%s","cwd":"%s","name":"demo","status":"idle"}\n' \
    "$SID" "$ORIGIN_CWD" >"$HOME/.claude/sessions/4242.json"

  slug=$(zsh --no-rcs "$ATP" --internal slugify "$ORIGIN_CWD")
  mkdir -p "$HOME/.claude/projects/$slug"
  cat >"$HOME/.claude/projects/$slug/$SID.jsonl" <<EOF
{"sessionId":"$SID","cwd":"$ORIGIN_CWD","type":"user","message":{"content":"codeword aubergine"}}
{"sessionId":"$SID","cwd":"$ORIGIN_CWD","type":"assistant","message":{"content":"noted"}}
EOF

  write_stub ps <<EOF
#!/usr/bin/env bash
case "\$*" in
  *"-o comm= -p 4242"*) echo claude ;;
  *"-o args= -p 4242"*) echo "claude --append-system-prompt-file $HOME/.claude/system-append.md --dangerously-skip-permissions" ;;
  *) exit 1 ;;
esac
EOF

  export TS_LOG="$BATS_TEST_TMPDIR/ts.log"
  export TS_SHIP="$BATS_TEST_TMPDIR/shipped.jsonl"
  export TS_SESSIONS="$BATS_TEST_TMPDIR/sessions.out"
  : >"$TS_SESSIONS"
  write_stub ts <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TS_LOG"
cmd="$3"
case "$cmd" in
  *'echo "$HOME"'*) echo /remote/home ;;
  *"cat > "*) cat >"$TS_SHIP" ;;
  *"dest="*) echo "dest=ok" ;;
  *list-sessions*) cat "$TS_SESSIONS" ;;
esac
exit 0
EOF

  export CLIP="$BATS_TEST_TMPDIR/clipboard.txt"
  write_stub pbcopy <<'EOF'
#!/usr/bin/env bash
cat >"$CLIP"
EOF
}

@test "copy mode ships a rewritten fork and copies the resume command" {
  setup_claude_flow

  atp --pid 4242 --host mac-mini --copy

  [ "$status" -eq 0 ]
  [[ "$output" == *"teleported claude session $SID -> "* ]]

  # Shipped transcript: fresh id on every line, cwd rewritten, content intact.
  newid=$(jq -rs '[.[] | .sessionId] | unique | .[]' "$TS_SHIP")
  [ "$newid" != "$SID" ]
  [[ "$newid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]
  [ "$(jq -rs '[.[] | .cwd] | unique | .[]' "$TS_SHIP")" = "/remote/home/proj" ]
  [ "$(wc -l <"$TS_SHIP" | tr -d ' ')" = "2" ]
  [ "$(jq -r 'select(.type == "user") | .message.content' "$TS_SHIP")" = "codeword aubergine" ]

  # Shipped into the slug dir for the DEST cwd under the target home.
  grep -q "projects/-remote-home-proj/$newid.jsonl" "$TS_LOG"

  # Clipboard carries the full remote one-liner with remapped flags. Substrings
  # with spaces are backslash-escaped by the quoting layers, so assert tokens.
  [[ "$(cat "$CLIP")" == ts\ ssh\ mac-mini* ]]
  [[ "$(cat "$CLIP")" == *"--resume"* ]]
  [[ "$(cat "$CLIP")" == *"$newid"* ]]
  [[ "$(cat "$CLIP")" == *"/remote/home/.claude/system-append.md"* ]]
  [[ "$(cat "$CLIP")" == *"--dangerously-skip-permissions"* ]]
  [[ "$(cat "$CLIP")" != *"$HOME/.claude/system-append.md"* ]]
}

@test "window mode targets the most recent attached session" {
  setup_claude_flow
  cat >"$TS_SESSIONS" <<'EOF'
0 1700000900 detached
1 1700000100 older
1 1700000500 newer
EOF

  atp --pid 4242 --host mac-mini --window

  [ "$status" -eq 0 ]
  grep -q "new-window" "$TS_LOG"
  launch_line=$(grep "new-window" "$TS_LOG")
  [[ "$launch_line" == *"newer"* ]]
  [[ "$launch_line" == *"tp:proj"* ]]
  [[ "$launch_line" != *"detached"* ]]
  [[ "$output" == *"tmux session 'newer'"* ]]
}

@test "window mode degrades to copy when the target has no tmux session" {
  setup_claude_flow

  atp --pid 4242 --host mac-mini --window

  [ "$status" -eq 0 ]
  [[ "$output" == *"falling back to --copy"* ]]
  [[ "$(cat "$CLIP")" == *"--resume"* ]]
  ! grep -q "new-window" "$TS_LOG"
}

@test "explicit --dest that is missing on the target fails cleanly" {
  setup_claude_flow
  write_stub ts <<'EOF'
#!/usr/bin/env bash
cmd="$3"
case "$cmd" in
  *'echo "$HOME"'*) echo /remote/home ;;
  *"dest="*) echo "dest=missing" ;;
esac
exit 0
EOF

  atp --pid 4242 --host mac-mini --copy --dest /remote/home/nowhere

  [ "$status" -eq 1 ]
  [[ "$output" == *"does not exist on mac-mini"* ]]
}

@test "unresolvable claude session points at claude-session-adopt" {
  mkdir -p "$RESURRECT_PROC_ROOT/4242"
  : >"$RESURRECT_PROC_ROOT/4242/environ"
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"-o comm= -p 4242"*) echo claude ;;
  *) exit 1 ;;
esac
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  write_stub ts <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  atp --pid 4242 --host mac-mini --copy

  [ "$status" -eq 1 ]
  [[ "$output" == *"claude-session-adopt --pid 4242"* ]]
}

@test "codex flow forks the rollout under a fresh uuidv7 in the original date dir" {
  export ORIGIN_CWD="$HOME/proj"
  mkdir -p "$ORIGIN_CWD" "$RESURRECT_PROC_ROOT/5353"
  : >"$RESURRECT_PROC_ROOT/5353/environ"
  local oldid="01890a5d-ac96-774b-bcce-b302099a8056"
  local rollout_dir="$HOME/.codex/sessions/2026/07/22"
  mkdir -p "$rollout_dir"
  local rollout="$rollout_dir/rollout-2026-07-22T10-30-00-$oldid.jsonl"
  cat >"$rollout" <<EOF
{"timestamp":"2026-07-22T10:30:00.000Z","type":"session_meta","payload":{"id":"$oldid","cwd":"$ORIGIN_CWD","cli_version":"0.9.0"}}
{"timestamp":"2026-07-22T10:30:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"codeword courgette"}}
EOF

  write_stub ps <<EOF
#!/usr/bin/env bash
case "\$*" in
  *"-o comm= -p 5353"*) echo codex ;;
  *"-o args= -p 5353"*) echo "codex --dangerously-bypass-approvals-and-sandbox -C $ORIGIN_CWD" ;;
  *) exit 1 ;;
esac
EOF
  write_stub lsof <<EOF
#!/usr/bin/env bash
case "\$*" in
  *"-p 5353"*) printf 'codex 5353 u txt REG 1,4 1 1 %s\n' "$rollout" ;;
  *) exit 1 ;;
esac
EOF

  export TS_LOG="$BATS_TEST_TMPDIR/ts.log"
  export TS_SHIP="$BATS_TEST_TMPDIR/shipped.jsonl"
  write_stub ts <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TS_LOG"
cmd="$3"
case "$cmd" in
  *'echo "$HOME"'*) echo /remote/home ;;
  *"cat > "*) cat >"$TS_SHIP" ;;
  *"dest="*) echo "dest=ok" ;;
esac
exit 0
EOF
  export CLIP="$BATS_TEST_TMPDIR/clipboard.txt"
  write_stub pbcopy <<'EOF'
#!/usr/bin/env bash
cat >"$CLIP"
EOF

  atp --pid 5353 --host mac-mini --copy

  [ "$status" -eq 0 ]
  newid=$(head -n 1 "$TS_SHIP" | jq -r '.payload.id')
  [ "$newid" != "$oldid" ]
  [[ "$newid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
  cmp <(tail -n +2 "$rollout") <(tail -n +2 "$TS_SHIP")
  # Shipped to the original date dir with the timestamp-preserving name.
  grep -q "/remote/home/.codex/sessions/2026/07/22/rollout-2026-07-22T10-30-00-$newid.jsonl" "$TS_LOG"
  # Resume command: codex resume <newid>, flags kept, -C dropped (we cd instead).
  [[ "$(cat "$CLIP")" == *"codex"* ]]
  [[ "$(cat "$CLIP")" == *"resume"* ]]
  [[ "$(cat "$CLIP")" == *"$newid"* ]]
  [[ "$(cat "$CLIP")" == *"--dangerously-bypass-approvals-and-sandbox"* ]]
  [[ "$(cat "$CLIP")" != *"-C "* ]]
  [[ "$(cat "$CLIP")" == *"/remote/home/proj"* ]]
}

@test "missing origin profile on target degrades to the default account" {
  setup_claude_flow
  # Mark the live pid as running under a ccp profile via its environ.
  local acct=acme
  local profile_dir="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$profile_dir/sessions" "$profile_dir/projects"
  printf 'CLAUDE_CONFIG_DIR=%s\0' "$profile_dir" >"$RESURRECT_PROC_ROOT/4242/environ"
  mv "$HOME/.claude/sessions/4242.json" "$profile_dir/sessions/4242.json"
  slug=$(zsh --no-rcs "$ATP" --internal slugify "$ORIGIN_CWD")
  mkdir -p "$profile_dir/projects/$slug"
  mv "$HOME/.claude/projects/$slug/$SID.jsonl" "$profile_dir/projects/$slug/$SID.jsonl"

  write_stub ts <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TS_LOG"
cmd="$3"
case "$cmd" in
  *'echo "$HOME"'*) echo /remote/home ;;
  *"cat > "*) cat >"$TS_SHIP" ;;
  *"dest="*) echo "dest=ok"; echo "profile=missing" ;;
esac
exit 0
EOF

  atp --pid 4242 --host mac-mini --copy

  [ "$status" -eq 0 ]
  [[ "$output" == *"profile 'acme' not present on mac-mini"* ]]
  # Degraded: shipped under the DEFAULT ~/.claude projects dir, no config-dir env.
  grep -q "/remote/home/.claude/projects/-remote-home-proj/" "$TS_LOG"
  [[ "$(cat "$CLIP")" != *"CLAUDE_CONFIG_DIR"* ]]
  [[ "$(cat "$CLIP")" != *"claude-profile-materialise"* ]]
}

@test "present origin profile on target is reused with materialise" {
  setup_claude_flow
  local acct=acme
  local profile_dir="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$profile_dir/sessions" "$profile_dir/projects"
  printf 'CLAUDE_CONFIG_DIR=%s\0' "$profile_dir" >"$RESURRECT_PROC_ROOT/4242/environ"
  mv "$HOME/.claude/sessions/4242.json" "$profile_dir/sessions/4242.json"
  slug=$(zsh --no-rcs "$ATP" --internal slugify "$ORIGIN_CWD")
  mkdir -p "$profile_dir/projects/$slug"
  mv "$HOME/.claude/projects/$slug/$SID.jsonl" "$profile_dir/projects/$slug/$SID.jsonl"

  write_stub ts <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TS_LOG"
cmd="$3"
case "$cmd" in
  *'echo "$HOME"'*) echo /remote/home ;;
  *"cat > "*) cat >"$TS_SHIP" ;;
  *"dest="*) echo "dest=ok"; echo "profile=ok" ;;
esac
exit 0
EOF

  atp --pid 4242 --host mac-mini --copy

  [ "$status" -eq 0 ]
  [[ "$output" == *"profile acme"* ]]
  grep -q "/remote/home/.claude-profiles/code/$acct/projects/-remote-home-proj/" "$TS_LOG"
  [[ "$(cat "$CLIP")" == *"claude-profile-materialise"* ]]
  [[ "$(cat "$CLIP")" == *"CLAUDE_CONFIG_DIR"* ]]
  [[ "$(cat "$CLIP")" == *"/remote/home/.claude-profiles/code/$acct"* ]]
}
