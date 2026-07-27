#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

REAL_SAVE_SESSIONS="$BATS_TEST_DIRNAME/../../tmux/scripts/resurrect-save-sessions.sh"
REAL_SESSION_LIB="$BATS_TEST_DIRNAME/../../tmux/scripts/lib/agent-session.sh"
REAL_ARGV_LIB="$BATS_TEST_DIRNAME/../../tmux/scripts/lib/resurrect-argv.sh"
REAL_CLAUDE_STRATEGY="$BATS_TEST_DIRNAME/../../tmux/strategies/claude_session_id.sh"
REAL_CODEX_STRATEGY="$BATS_TEST_DIRNAME/../../tmux/strategies/codex_session_id.sh"
REAL_OPENCODE_STRATEGY="$BATS_TEST_DIRNAME/../../tmux/strategies/opencode_session_id.sh"
REAL_CLAUDE_LAUNCH="$BATS_TEST_DIRNAME/../../tmux/scripts/resurrect-claude-launch.sh"
REAL_CODEX_LAUNCH="$BATS_TEST_DIRNAME/../../tmux/scripts/resurrect-codex-launch.sh"
REAL_CLAUDE_MATERIALISE="$BATS_TEST_DIRNAME/../functions/claude-profile-materialise"
REAL_FOREGROUND_STRATEGY="$BATS_TEST_DIRNAME/../../tmux/save_command_strategies/foreground.sh"
# The bundled upstream strategy, for the regression comparison. The plugin dir is
# a local checkout, so tests using it skip when it is absent.
REAL_PS_STRATEGY="$BATS_TEST_DIRNAME/../../tmux/plugins/tmux-resurrect/save_command_strategies/ps.sh"
# The scripts under test need bash >= 5; on macOS `command -v bash` is Apple's
# 3.2. $BASH5 (test_helper.bash) is the same interpreter their re-exec preamble
# would land on.
REAL_BASH="$BASH5"
# Captured before setup_test_home narrows PATH.
REAL_TMUX="$(command -v tmux || true)"

# Make a real tool discoverable on the test PATH via a TEST_BIN symlink.
link_real() {
  local name=$1 real
  real="$(command -v "$name" 2>/dev/null)" || return 0
  ln -sf "$real" "$TEST_BIN/$name"
}

setup() {
  setup_test_home
  # The isolated test home must not inherit the runner's ccp account, or the
  # launcher's "leave CLAUDE_CONFIG_DIR alone when none recorded" path would
  # observe a leaked value.
  unset CLAUDE_CONFIG_DIR
  SAVE_SESSIONS="$HOME/.config/tmux/scripts/resurrect-save-sessions.sh"
  ARGV_LIB="$HOME/.config/tmux/scripts/lib/resurrect-argv.sh"
  CLAUDE_STRATEGY="$HOME/.config/tmux/strategies/claude_session_id.sh"
  CODEX_STRATEGY="$HOME/.config/tmux/strategies/codex_session_id.sh"
  OPENCODE_STRATEGY="$HOME/.config/tmux/strategies/opencode_session_id.sh"
  CLAUDE_LAUNCH="$HOME/.config/tmux/scripts/resurrect-claude-launch.sh"
  CODEX_LAUNCH="$HOME/.config/tmux/scripts/resurrect-codex-launch.sh"
  FOREGROUND_STRATEGY="$HOME/.config/tmux/save_command_strategies/foreground.sh"
  SESSION_FILE="$HOME/.local/share/tmux/resurrect/session_ids.json"
  mkdir -p "$HOME/.config/tmux/scripts/lib" "$HOME/.config/tmux/strategies" "$HOME/.config/tmux/save_command_strategies" "$HOME/.local/share/tmux/resurrect" "$HOME/.claude/sessions"
  cp "$REAL_FOREGROUND_STRATEGY" "$FOREGROUND_STRATEGY"
  cp "$REAL_SAVE_SESSIONS" "$SAVE_SESSIONS"
  cp "$REAL_SESSION_LIB" "$HOME/.config/tmux/scripts/lib/agent-session.sh"
  cp "$REAL_ARGV_LIB" "$ARGV_LIB"
  cp "$REAL_CLAUDE_STRATEGY" "$CLAUDE_STRATEGY"
  cp "$REAL_CODEX_STRATEGY" "$CODEX_STRATEGY"
  cp "$REAL_OPENCODE_STRATEGY" "$OPENCODE_STRATEGY"
  cp "$REAL_CLAUDE_LAUNCH" "$CLAUDE_LAUNCH"
  cp "$REAL_CODEX_LAUNCH" "$CODEX_LAUNCH"
  chmod +x "$SAVE_SESSIONS" "$CLAUDE_STRATEGY" "$CODEX_STRATEGY" "$OPENCODE_STRATEGY" "$CLAUDE_LAUNCH" "$CODEX_LAUNCH" "$FOREGROUND_STRATEGY"
}

teardown() {
  # Only the save-command-strategy tests start a server (PRIVATE_TMUX set there).
  # That wrapper carries the `-L <unique socket>`, so this can only ever kill the
  # test's own server, never the real one.
  [ -n "${PRIVATE_TMUX:-}" ] && "$PRIVATE_TMUX" kill-server 2>/dev/null
  return 0
}

# --- Stubs shared by launcher tests ---

# tmux display-message stub that always reports the given pane key.
write_tmux_display_stub() {
  local key="$1"
  write_stub tmux <<EOF
#!/usr/bin/env bash
if [ "\$1" = "display-message" ]; then
	printf '%s\n' "$key"
	exit 0
fi
exit 1
EOF
}

# claude stub echoing the exported config dir + its argv, so a test can assert
# exactly what the launcher exec'd.
write_claude_launch_stub() {
  write_stub claude <<'EOF'
#!/usr/bin/env bash
echo "CFG=${CLAUDE_CONFIG_DIR:-} args=$*"
EOF
}

# codex stub echoing its argv.
write_codex_launch_stub() {
  write_stub codex <<'EOF'
#!/usr/bin/env bash
echo "args=$*"
EOF
}

write_tmux_stub_for_save() {
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\tclaude\t/Users/connorads\t/dev/ttys001\n'
	printf 'main:1.2\t222\tclaude\t/Users/connorads\t/dev/ttys002\n'
	printf 'main:2.1\t333\tzsh\t/Users/connorads\t/dev/ttys003\n'
	exit 0
fi
exit 1
EOF
}

write_ps_stub_for_save() {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*ttys001*)
		printf ' 901 S+ claude\n'
		;;
	*ttys002*)
		printf ' 902 S+ claude\n'
		;;
	*)
		exit 1
		;;
esac
EOF
}

# ---------------------------------------------------------------------------
# Save hook
# ---------------------------------------------------------------------------

@test "save hook records Claude sessions per pane when cwd repeats" {
  write_tmux_stub_for_save
  write_ps_stub_for_save
  cat >"$HOME/.claude/sessions/901.json" <<'EOF'
{"pid":901,"sessionId":"session-one","cwd":"/Users/connorads"}
EOF
  cat >"$HOME/.claude/sessions/902.json" <<'EOF'
{"pid":902,"sessionId":"session-two","cwd":"/Users/connorads"}
EOF
  touch "$HOME/.local/share/tmux/resurrect/save.txt"

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.version' "$SESSION_FILE"
  [ "$output" = "2" ]
  run jq -r '.panes["main:1.1"].claude' "$SESSION_FILE"
  [ "$output" = "session-one" ]
  run jq -r '.panes["main:1.2"].claude' "$SESSION_FILE"
  [ "$output" = "session-two" ]
  # Claude/Codex resolve by pane key at restore time - no top-level per-dir map.
  run jq -r 'has("/Users/connorads")' "$SESSION_FILE"
  [ "$output" = "false" ]
}

@test "save hook records a Claude session for a profile pane under its config dir" {
  # The pane's registry lives under the profile config dir, not ~/.claude, so the
  # save hook must resolve the account before reading the registry.
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$cfg/sessions" "$BATS_TEST_TMPDIR/proc/901"
  printf 'CLAUDE_CONFIG_DIR=%s\0' "$cfg" >"$BATS_TEST_TMPDIR/proc/901/environ"
  cat >"$cfg/sessions/901.json" <<'EOF'
{"pid":901,"sessionId":"session-profile","cwd":"/Users/connorads"}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\tclaude\t/Users/connorads\t/dev/ttys001\n'
	exit 0
fi
exit 1
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*-E*) exit 1 ;;
	*ttys001*) printf ' 901 S+ claude\n' ;;
	*) exit 1 ;;
esac
EOF

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/proc" \
    run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes["main:1.1"].claude' "$SESSION_FILE"
  [ "$output" = "session-profile" ]
  run jq -r '.panes["main:1.1"].claudeConfigDir' "$SESSION_FILE"
  [ "$output" = "$cfg" ]
}

@test "save hook records CLAUDE_CONFIG_DIR via ps -E without leaking other env vars" {
  # Build the config dir via a var so no concrete profile path is committed.
  local acct=acme
  export CLAUDE_CFG="$HOME/.claude-profiles/code/$acct"
  # A profile pane's session lives under its config dir, not ~/.claude.
  mkdir -p "$CLAUDE_CFG/sessions"
  cat >"$CLAUDE_CFG/sessions/901.json" <<'EOF'
{"pid":901,"sessionId":"session-one","cwd":"/Users/connorads"}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\tclaude\t/Users/connorads\t/dev/ttys001\n'
	exit 0
fi
exit 1
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*-E*901*)
		printf 'claude --resume s1 CLAUDE_CONFIG_DIR=%s SECRET_TOKEN=hunter2\n' "$CLAUDE_CFG"
		;;
	*ttys001*)
		printf ' 901 S+ claude\n'
		;;
	*)
		exit 1
		;;
esac
EOF

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/no-proc" \
    run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes["main:1.1"].claudeConfigDir' "$SESSION_FILE"
  [ "$output" = "$CLAUDE_CFG" ]
  # Only CLAUDE_CONFIG_DIR may be persisted - the rest of the env carries secrets.
  run grep -c 'hunter2' "$SESSION_FILE"
  [ "$output" = "0" ]
}

@test "save hook reads CLAUDE_CONFIG_DIR from proc environ when available" {
  local acct=acme
  export CLAUDE_CFG="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$BATS_TEST_TMPDIR/proc/901"
  printf 'HOME=%s\0CLAUDE_CONFIG_DIR=%s\0SECRET_TOKEN=hunter2\0' "$HOME" "$CLAUDE_CFG" \
    >"$BATS_TEST_TMPDIR/proc/901/environ"
  # A profile pane's session lives under its config dir, not ~/.claude.
  mkdir -p "$CLAUDE_CFG/sessions"
  cat >"$CLAUDE_CFG/sessions/901.json" <<'EOF'
{"pid":901,"sessionId":"session-one","cwd":"/Users/connorads"}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\tclaude\t/Users/connorads\t/dev/ttys001\n'
	exit 0
fi
exit 1
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*-E*) exit 1 ;;
	*ttys001*) printf ' 901 S+ claude\n' ;;
	*) exit 1 ;;
esac
EOF

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/proc" \
    run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes["main:1.1"].claudeConfigDir' "$SESSION_FILE"
  [ "$output" = "$CLAUDE_CFG" ]
  run grep -c 'hunter2' "$SESSION_FILE"
  [ "$output" = "0" ]
}

@test "save hook records Codex sessions per pane when cwd repeats" {
  mkdir -p "$HOME/.codex/sessions/2026/06/24"
  cat >"$HOME/.codex/sessions/2026/06/24/rollout-one.jsonl" <<'EOF'
{"type":"session_meta","payload":{"id":"codex-one","cwd":"/Users/connorads"}}
EOF
  cat >"$HOME/.codex/sessions/2026/06/24/rollout-two.jsonl" <<'EOF'
{"type":"session_meta","payload":{"id":"codex-two","cwd":"/Users/connorads"}}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\tcodex\t/Users/connorads\t/dev/ttys001\n'
	printf 'main:1.2\t222\tcodex\t/Users/connorads\t/dev/ttys002\n'
	exit 0
fi
exit 1
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*ttys001*) printf ' 901 S+ codex\n' ;;
	*ttys002*) printf ' 902 S+ codex\n' ;;
	*) exit 1 ;;
esac
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*901*) printf 'codex 901 user 10r REG 1,2 0 1 %s/.codex/sessions/2026/06/24/rollout-one.jsonl\n' "$HOME" ;;
	*902*) printf 'codex 902 user 10r REG 1,2 0 1 %s/.codex/sessions/2026/06/24/rollout-two.jsonl\n' "$HOME" ;;
	*) exit 1 ;;
esac
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes["main:1.1"].codex' "$SESSION_FILE"
  [ "$output" = "codex-one" ]
  run jq -r '.panes["main:1.2"].codex' "$SESSION_FILE"
  [ "$output" = "codex-two" ]
}

@test "save hook records a Codex session when lsof is absent from PATH" {
  # The launchd shape: the keepalive's plist PATH lists no dir holding lsof, so a
  # PATH-only lookup found nothing and every Codex pane's id went unrecorded while
  # Claude's registry-based panes kept resolving - a silent, one-agent-wide gap.
  mkdir -p "$HOME/.codex/sessions/2026/06/24" "$BATS_TEST_TMPDIR/sbin"
  cat >"$HOME/.codex/sessions/2026/06/24/rollout-one.jsonl" <<'EOF'
{"type":"session_meta","payload":{"id":"codex-one","cwd":"/Users/connorads"}}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\tcodex\t/Users/connorads\t/dev/ttys001\n'
	exit 0
fi
exit 1
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*ttys001*) printf ' 901 S+ codex\n' ;;
	*) exit 1 ;;
esac
EOF
  cat >"$BATS_TEST_TMPDIR/sbin/lsof" <<'EOF'
#!/usr/bin/env bash
printf 'codex 901 user 10r REG 1,2 0 1 %s/.codex/sessions/2026/06/24/rollout-one.jsonl\n' "$HOME"
EOF
  chmod +x "$BATS_TEST_TMPDIR/sbin/lsof"

  # No lsof on PATH at all, only at the fallback location. path_without is what
  # makes that true on Linux too, where lsof lives in /usr/bin rather than the
  # /usr/sbin that setup_test_home's own PATH carries.
  PATH="$(path_without lsof)" AGENT_LSOF_FALLBACK="$BATS_TEST_TMPDIR/sbin/lsof" \
    run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes["main:1.1"].codex' "$SESSION_FILE"
  [ "$output" = "codex-one" ]
}

# ---------------------------------------------------------------------------
# Save hook: session_ids.json is merged, not rewritten
# ---------------------------------------------------------------------------

# A save that resolves no session for a live agent pane (agent still starting, a
# trust prompt, a transient ps miss) must not destroy that pane's recorded id.

# tmux stub: one resolvable claude pane, one that resolves to nothing, a claude
# pane whose cwd moved on, and a plain shell pane.
write_tmux_stub_for_merge() {
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\tclaude\t/Users/connorads\t/dev/ttys001\n'
	printf 'main:1.2\t222\tclaude\t/Users/connorads\t/dev/ttys002\n'
	printf 'main:1.3\t333\tclaude\t/Users/connorads/moved\t/dev/ttys003\n'
	printf 'main:2.1\t444\tzsh\t/Users/connorads\t/dev/ttys004\n'
	exit 0
fi
exit 1
EOF
}

# ps stub resolving only the first pane's agent - every other pane is a live
# agent that this save cannot confirm.
write_ps_stub_for_merge() {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*ttys001*) printf ' 901 S+ claude\n' ;;
	*) exit 1 ;;
esac
EOF
}

@test "save hook carries an unconfirmed entry whose pane is still a live agent in the same cwd" {
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  jq -n --arg cfg "$cfg" \
    '{version:2,panes:{
      "main:1.1":{dir:"/Users/connorads",claude:"stale-one"},
      "main:1.2":{dir:"/Users/connorads",claude:"old-two",claudeConfigDir:$cfg}}}' \
    >"$SESSION_FILE"
  write_tmux_stub_for_merge
  write_ps_stub_for_merge
  cat >"$HOME/.claude/sessions/901.json" <<'EOF'
{"pid":901,"sessionId":"session-one","cwd":"/Users/connorads"}
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  # The resolved pane overlays its carried entry.
  run jq -r '.panes["main:1.1"].claude' "$SESSION_FILE"
  [ "$output" = "session-one" ]
  # The unconfirmed pane keeps its id and its account.
  run jq -r '.panes["main:1.2"].claude' "$SESSION_FILE"
  [ "$output" = "old-two" ]
  run jq -r '.panes["main:1.2"].claudeConfigDir' "$SESSION_FILE"
  [ "$output" = "$cfg" ]
}

@test "save hook drops an unconfirmed entry whose live pane moved to another cwd" {
  jq -n '{version:2,panes:{
      "main:1.3":{dir:"/Users/connorads",claude:"old-three"}}}' \
    >"$SESSION_FILE"
  write_tmux_stub_for_merge
  write_ps_stub_for_merge
  cat >"$HOME/.claude/sessions/901.json" <<'EOF'
{"pid":901,"sessionId":"session-one","cwd":"/Users/connorads"}
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  # The slot now holds a different cwd, so the recorded session is not its own.
  run jq -r '.panes | has("main:1.3")' "$SESSION_FILE"
  [ "$output" = "false" ]
  run jq -r '.panes["main:1.1"].claude' "$SESSION_FILE"
  [ "$output" = "session-one" ]
}

@test "save hook drops an entry whose pane key is no longer an agent pane" {
  jq -n '{version:2,panes:{
      "main:2.1":{dir:"/Users/connorads",claude:"old-shell"},
      "main:9.9":{dir:"/Users/connorads",claude:"old-dead"}}}' \
    >"$SESSION_FILE"
  write_tmux_stub_for_merge
  write_ps_stub_for_merge
  cat >"$HOME/.claude/sessions/901.json" <<'EOF'
{"pid":901,"sessionId":"session-one","cwd":"/Users/connorads"}
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes | has("main:2.1")' "$SESSION_FILE"
  [ "$output" = "false" ]
  run jq -r '.panes | has("main:9.9")' "$SESSION_FILE"
  [ "$output" = "false" ]
}

@test "save hook keeps the file when nothing resolves but an entry can be carried" {
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  jq -n --arg cfg "$cfg" \
    '{version:2,panes:{"main:1.2":{dir:"/Users/connorads",claude:"old-two",claudeConfigDir:$cfg}}}' \
    >"$SESSION_FILE"
  write_tmux_stub_for_merge
  # Nothing resolves at all - the whole-map delete this replaces lost the ids of
  # panes sitting at Claude's trust prompt.
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  [ -f "$SESSION_FILE" ]
  run jq -r '.panes["main:1.2"].claude' "$SESSION_FILE"
  [ "$output" = "old-two" ]
  run jq -r '.panes["main:1.2"].claudeConfigDir' "$SESSION_FILE"
  [ "$output" = "$cfg" ]
}

@test "save hook removes the file when nothing resolves and no agent pane is live" {
  jq -n '{version:2,panes:{"main:1.2":{dir:"/Users/connorads",claude:"old-two"}}}' \
    >"$SESSION_FILE"
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:2.1\t444\tzsh\t/Users/connorads\t/dev/ttys004\n'
	exit 0
fi
exit 1
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  [ ! -f "$SESSION_FILE" ]
}

# ---------------------------------------------------------------------------
# Save-command strategy: record the command for exec'd / re-parented panes
# ---------------------------------------------------------------------------

# The bug needs no stubs to reproduce, so these run against a real throwaway
# server with real tmux/ps: an exec'd pane has no child of pane_pid, which is the
# only thing upstream's strategy looks at.
#
# Isolation is belt and braces, because the script under test calls bare `tmux`
# and the real server holds live work: a unique *named* socket (`-L`, the
# never-reaches-the-real-one pattern) injected through a tmux wrapper on the test
# PATH, so no invocation from a test or from the strategy can address the default
# socket, plus a private TMUX_TMPDIR.
start_private_server() {
  [ -n "$REAL_TMUX" ] || skip "tmux not installed"
  unset TMUX
  local socket="rsc-$$-${BATS_TEST_NUMBER}"
  # Short TMUX_TMPDIR under /tmp: the AF_UNIX socket path must stay under ~104
  # chars, which the long macOS BATS_TEST_TMPDIR blows.
  export TMUX_TMPDIR="/tmp/$socket"
  mkdir -p "$TMUX_TMPDIR"
  write_stub tmux <<EOF
#!/usr/bin/env bash
exec "$REAL_TMUX" -L "$socket" "\$@"
EOF
  link_real awk
  PRIVATE_TMUX="$TEST_BIN/tmux"
  "$PRIVATE_TMUX" -f /dev/null new-session -d -s s -x 80 -y 24 "$@"
}

pane_pid_of() {
  "$PRIVATE_TMUX" list-panes -a -F '#{pane_pid}' | head -1
}

# Wait for a pane's foreground command, so a test never races process startup.
wait_for_pane_command() {
  local want="$1" i
  for i in $(seq 1 50); do
    [ "$("$PRIVATE_TMUX" list-panes -a -F '#{pane_current_command}' | head -1)" = "$want" ] && return 0
    sleep 0.1
  done
  return 1
}

@test "foreground strategy records the command of a pane that exec'd it" {
  # The branch/fork menu's pane shape: tmux split-window '<cmd>', shell exec's it,
  # so pane_pid IS the process and there is no child to find.
  # /bin/sleep, not a bare `sleep`: the nix coreutils multi-call binary reports
  # `coreutils` as the pane command, which would make the assertion PATH-dependent.
  start_private_server 'exec /bin/sleep 300'
  wait_for_pane_command sleep

  run "$REAL_BASH" "$FOREGROUND_STRATEGY" "$(pane_pid_of)"

  [ "$status" -eq 0 ]
  [ "$output" = "/bin/sleep 300" ]
}

@test "bundled ps strategy records nothing for an exec'd pane (the regression)" {
  [ -f "$REAL_PS_STRATEGY" ] || skip "tmux-resurrect plugin not checked out"
  # /bin/sleep, not a bare `sleep`: the nix coreutils multi-call binary reports
  # `coreutils` as the pane command, which would make the assertion PATH-dependent.
  start_private_server 'exec /bin/sleep 300'
  wait_for_pane_command sleep

  run "$REAL_BASH" "$REAL_PS_STRATEGY" "$(pane_pid_of)"

  # An empty command field is what restore.sh filters out, so the pane comes back
  # as a bare shell however good the restore strategy is.
  [ -z "$output" ]
}

@test "foreground strategy records a child process of a shell pane" {
  start_private_server
  local pid
  pid="$(pane_pid_of)"
  "$PRIVATE_TMUX" send-keys '/bin/sleep 300' Enter
  wait_for_pane_command sleep

  run "$REAL_BASH" "$FOREGROUND_STRATEGY" "$pid"

  [ "$status" -eq 0 ]
  [ "$output" = "/bin/sleep 300" ]
}

@test "foreground strategy records nothing for an idle shell pane" {
  start_private_server

  run "$REAL_BASH" "$FOREGROUND_STRATEGY" "$(pane_pid_of)"

  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "foreground strategy records nothing for an empty or unknown pane pid" {
  start_private_server

  run "$REAL_BASH" "$FOREGROUND_STRATEGY" ""
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  run "$REAL_BASH" "$FOREGROUND_STRATEGY" 999999
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Flags-only emitters (resurrect-argv.sh)
# ---------------------------------------------------------------------------

@test "claude flags emitter preserves flag+value pairs" {
  run "$REAL_BASH" -c "source '$ARGV_LIB'; resurrect_argv_claude_flags 'claude --append-system-prompt-file /Users/connorads/.claude/system-append.md --dangerously-skip-permissions'"
  [ "$status" -eq 0 ]
  [ "$output" = "--append-system-prompt-file /Users/connorads/.claude/system-append.md --dangerously-skip-permissions" ]
}

@test "claude flags emitter strips stale resume/continue state" {
  run "$REAL_BASH" -c "source '$ARGV_LIB'; resurrect_argv_claude_flags 'claude --dangerously-skip-permissions --resume 4626672f-1111-2222-3333-444444444444'"
  [ "$status" -eq 0 ]
  [ "$output" = "--dangerously-skip-permissions" ]

  run "$REAL_BASH" -c "source '$ARGV_LIB'; resurrect_argv_claude_flags 'claude -c --dangerously-skip-permissions --resume=old-session -r'"
  [ "$status" -eq 0 ]
  [ "$output" = "--dangerously-skip-permissions" ]
}

@test "claude flags emitter returns nonzero when argv0 is not claude" {
  run "$REAL_BASH" -c "source '$ARGV_LIB'; resurrect_argv_claude_flags 'some-wrapper claude --dangerously-skip-permissions'"
  [ "$status" -eq 1 ]
}

@test "codex flags emitter strips stale resume/last and keeps flags verbatim" {
  run "$REAL_BASH" -c "source '$ARGV_LIB'; resurrect_argv_codex_flags 'codex resume 11111111-2222-3333-4444-555555555555 --model gpt-5'"
  [ "$status" -eq 0 ]
  [ "$output" = "--model gpt-5" ]

  run "$REAL_BASH" -c "source '$ARGV_LIB'; resurrect_argv_codex_flags 'codex resume --last --dangerously-bypass-approvals-and-sandbox'"
  [ "$status" -eq 0 ]
  [ "$output" = "--dangerously-bypass-approvals-and-sandbox" ]
}

@test "codex flags emitter returns nonzero when argv0 is not codex" {
  run "$REAL_BASH" -c "source '$ARGV_LIB'; resurrect_argv_codex_flags 'some-wrapper codex'"
  [ "$status" -eq 1 ]
}

# ---------------------------------------------------------------------------
# Strategies: emit a launcher invocation carrying the kept flags
# ---------------------------------------------------------------------------

@test "claude strategy emits launcher with preserved flags" {
  run "$REAL_BASH" "$CLAUDE_STRATEGY" "claude --append-system-prompt-file /Users/connorads/.claude/system-append.md --dangerously-skip-permissions" "/Users/connorads"
  [ "$status" -eq 0 ]
  [ "$output" = "$CLAUDE_LAUNCH --append-system-prompt-file /Users/connorads/.claude/system-append.md --dangerously-skip-permissions" ]
}

@test "claude strategy emits a bare launcher when no flags remain" {
  run "$REAL_BASH" "$CLAUDE_STRATEGY" "claude --continue" "/Users/connorads"
  [ "$status" -eq 0 ]
  [ "$output" = "$CLAUDE_LAUNCH" ]
}

@test "claude strategy falls back to the bare command when argv0 is not claude" {
  run "$REAL_BASH" "$CLAUDE_STRATEGY" "some-wrapper claude --dangerously-skip-permissions" "/Users/connorads"
  [ "$status" -eq 0 ]
  [ "$output" = "some-wrapper claude --dangerously-skip-permissions" ]
}

@test "codex strategy emits launcher with preserved flags" {
  run "$REAL_BASH" "$CODEX_STRATEGY" "codex --dangerously-bypass-approvals-and-sandbox" "/Users/connorads"
  [ "$status" -eq 0 ]
  [ "$output" = "$CODEX_LAUNCH --dangerously-bypass-approvals-and-sandbox" ]
}

@test "codex strategy emits a bare launcher when no flags remain" {
  run "$REAL_BASH" "$CODEX_STRATEGY" "codex resume --last" "/Users/connorads"
  [ "$status" -eq 0 ]
  [ "$output" = "$CODEX_LAUNCH" ]
}

@test "codex strategy falls back to the bare command when argv0 is not codex" {
  run "$REAL_BASH" "$CODEX_STRATEGY" "some-wrapper codex resume" "/Users/connorads"
  [ "$status" -eq 0 ]
  [ "$output" = "some-wrapper codex resume" ]
}

# ---------------------------------------------------------------------------
# Launchers: resolve session identity INSIDE the restored pane via $TMUX_PANE
# ---------------------------------------------------------------------------

@test "claude launcher resumes the exact pane key with flags and config dir" {
  # Build the config dir via a var so no concrete profile path is committed.
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  jq -n --arg cfg "$cfg" \
    '{version:2,panes:{"main:1.1":{dir:"/Users/connorads",claude:"session-two",claudeConfigDir:$cfg}}}' \
    >"$SESSION_FILE"
  write_tmux_display_stub 'main:1.1'
  write_claude_launch_stub

  TMUX_PANE='%1' run "$REAL_BASH" "$CLAUDE_LAUNCH" --dangerously-skip-permissions

  [ "$status" -eq 0 ]
  [ "$output" = "CFG=$cfg args=--dangerously-skip-permissions --resume session-two" ]
}

@test "claude launcher materialises the restored profile's shared config before exec" {
  local acct=work
  local cfg="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$cfg"
  # Install the real helper at the absolute path the launcher invokes, plus a
  # shared settings.json for it to merge in.
  mkdir -p "$HOME/.config/zsh/functions"
  install -m 755 "$REAL_CLAUDE_MATERIALISE" "$HOME/.config/zsh/functions/claude-profile-materialise"
  cat >"$HOME/.claude/settings.json" <<'EOF'
{"model": "shared-model", "statusLine": {"type": "command", "command": "statusline"}}
EOF
  link_real jq
  jq -n --arg cfg "$cfg" \
    '{version:2,panes:{"main:1.1":{dir:"/Users/connorads",claude:"session-two",claudeConfigDir:$cfg}}}' \
    >"$SESSION_FILE"
  write_tmux_display_stub 'main:1.1'
  write_claude_launch_stub

  TMUX_PANE='%1' run "$REAL_BASH" "$CLAUDE_LAUNCH" --dangerously-skip-permissions

  [ "$status" -eq 0 ]
  [ "$output" = "CFG=$cfg args=--dangerously-skip-permissions --resume session-two" ]
  # The profile inherited shared config and did not leak the base model.
  run jq -r '.statusLine.command' "$cfg/settings.json"
  [ "$output" = "statusline" ]
  run jq -r 'has("model")' "$cfg/settings.json"
  [ "$output" = "false" ]
}

@test "claude launcher exports a config dir containing spaces and quotes safely" {
  local cfg="$HOME/it's a dir"
  jq -n --arg cfg "$cfg" \
    '{version:2,panes:{"main:1.1":{dir:"/Users/connorads",claude:"session-two",claudeConfigDir:$cfg}}}' \
    >"$SESSION_FILE"
  write_tmux_display_stub 'main:1.1'
  write_claude_launch_stub

  TMUX_PANE='%1' run "$REAL_BASH" "$CLAUDE_LAUNCH"

  [ "$status" -eq 0 ]
  [ "$output" = "CFG=$cfg args=--resume session-two" ]
}

@test "claude launcher resumes via unique cwd fallback on exact-key miss" {
  mkdir -p "$HOME/proj"
  cd "$HOME/proj"
  jq -n --arg dir "$PWD" \
    '{version:2,panes:{"main:1.1":{dir:$dir,claude:"cwd-session"}}}' \
    >"$SESSION_FILE"
  # display-message reports a key absent from the file -> exact miss.
  write_tmux_display_stub 'main:9.9'
  write_claude_launch_stub

  TMUX_PANE='%1' run "$REAL_BASH" "$CLAUDE_LAUNCH"

  [ "$status" -eq 0 ]
  [ "$output" = "CFG= args=--resume cwd-session" ]
}

@test "claude launcher continues on ambiguous cwd, never a wrong resume" {
  # Regression guard for the reported bug: two panes share one cwd, exact key
  # misses, so the launcher must NOT guess a session.
  mkdir -p "$HOME/proj"
  cd "$HOME/proj"
  jq -n --arg dir "$PWD" \
    '{version:2,panes:{"main:1.1":{dir:$dir,claude:"s1"},"main:1.2":{dir:$dir,claude:"s2"}}}' \
    >"$SESSION_FILE"
  write_tmux_display_stub 'main:9.9'
  write_claude_launch_stub

  TMUX_PANE='%1' run "$REAL_BASH" "$CLAUDE_LAUNCH"

  [ "$status" -eq 0 ]
  [ "$output" = "CFG= args=--continue" ]
}

@test "claude launcher continues when TMUX_PANE is absent" {
  jq -n '{version:2,panes:{"main:1.1":{dir:"/Users/connorads",claude:"session-two"}}}' \
    >"$SESSION_FILE"
  write_tmux_display_stub 'main:1.1'
  write_claude_launch_stub

  unset TMUX_PANE
  run "$REAL_BASH" "$CLAUDE_LAUNCH"

  [ "$status" -eq 0 ]
  [ "$output" = "CFG= args=--continue" ]
}

@test "claude launcher continues when the session file is absent" {
  rm -f "$SESSION_FILE"
  write_tmux_display_stub 'main:1.1'
  write_claude_launch_stub

  TMUX_PANE='%1' run "$REAL_BASH" "$CLAUDE_LAUNCH" --model fable

  [ "$status" -eq 0 ]
  [ "$output" = "CFG= args=--model fable --continue" ]
}

@test "codex launcher resumes the exact pane key with flags" {
  jq -n '{version:2,panes:{"main:1.1":{dir:"/Users/connorads",codex:"codex-one"}}}' \
    >"$SESSION_FILE"
  write_tmux_display_stub 'main:1.1'
  write_codex_launch_stub

  TMUX_PANE='%1' run "$REAL_BASH" "$CODEX_LAUNCH" --dangerously-bypass-approvals-and-sandbox

  [ "$status" -eq 0 ]
  [ "$output" = "args=resume codex-one --dangerously-bypass-approvals-and-sandbox" ]
}

@test "codex launcher resumes via unique cwd fallback on exact-key miss" {
  mkdir -p "$HOME/proj"
  cd "$HOME/proj"
  jq -n --arg dir "$PWD" \
    '{version:2,panes:{"main:1.1":{dir:$dir,codex:"cwd-codex"}}}' \
    >"$SESSION_FILE"
  write_tmux_display_stub 'main:9.9'
  write_codex_launch_stub

  TMUX_PANE='%1' run "$REAL_BASH" "$CODEX_LAUNCH"

  [ "$status" -eq 0 ]
  [ "$output" = "args=resume cwd-codex" ]
}

@test "codex launcher falls back to --last on ambiguous cwd" {
  mkdir -p "$HOME/proj"
  cd "$HOME/proj"
  jq -n --arg dir "$PWD" \
    '{version:2,panes:{"main:1.1":{dir:$dir,codex:"c1"},"main:1.2":{dir:$dir,codex:"c2"}}}' \
    >"$SESSION_FILE"
  write_tmux_display_stub 'main:9.9'
  write_codex_launch_stub

  TMUX_PANE='%1' run "$REAL_BASH" "$CODEX_LAUNCH" --model gpt-5

  [ "$status" -eq 0 ]
  [ "$output" = "args=resume --last --model gpt-5" ]
}

# ---------------------------------------------------------------------------
# OpenCode (unchanged: no in-pane launcher, still cwd/latest gated at save time)
# ---------------------------------------------------------------------------

@test "save hook records OpenCode session from current database when cwd is unique" {
  mkdir -p "$HOME/.local/share/opencode"
  : >"$HOME/.local/share/opencode/opencode.db"
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\topencode\t/Users/connorads\t/dev/ttys001\n'
	exit 0
fi
exit 1
EOF
  write_stub sqlite3 <<'EOF'
#!/usr/bin/env bash
printf 'ses_current\n'
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes["main:1.1"].opencode' "$SESSION_FILE"
  [ "$output" = "ses_current" ]
  run jq -r '.["/Users/connorads"].opencode' "$SESSION_FILE"
  [ "$output" = "ses_current" ]
}

@test "save hook avoids unsafe OpenCode latest restore when cwd repeats" {
  mkdir -p "$HOME/.local/share/opencode"
  : >"$HOME/.local/share/opencode/opencode.db"
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\topencode\t/Users/connorads\t/dev/ttys001\n'
	printf 'main:1.2\t222\topencode\t/Users/connorads\t/dev/ttys002\n'
	exit 0
fi
exit 1
EOF
  write_stub sqlite3 <<'EOF'
#!/usr/bin/env bash
printf 'ses_current\n'
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  [ ! -f "$SESSION_FILE" ]
}

@test "save hook records OPENCODE_CONFIG_CONTENT via ps -E without leaking other env vars" {
  mkdir -p "$HOME/.local/share/opencode" "$BATS_TEST_TMPDIR/no-proc"
  : >"$HOME/.local/share/opencode/opencode.db"
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\topencode\t/Users/connorads\t/dev/ttys001\n'
	exit 0
fi
exit 1
EOF
  write_stub sqlite3 <<'EOF'
#!/usr/bin/env bash
printf 'ses_current\n'
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*-E*901*)
		printf 'opencode --continue HOME=/Users/connorads OPENCODE_CONFIG_CONTENT={"permission":{"edit":"allow","bash":"allow"}} SECRET_TOKEN=hunter2\n'
		;;
	*ttys001*)
		printf ' 901 S+ opencode\n'
		;;
	*)
		exit 1
		;;
esac
EOF

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/no-proc" \
    run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes["main:1.1"].opencodeEnv' "$SESSION_FILE"
  [ "$output" = '{"permission":{"edit":"allow","bash":"allow"}}' ]
  run jq -r '.["/Users/connorads"].opencodeEnv' "$SESSION_FILE"
  [ "$output" = '{"permission":{"edit":"allow","bash":"allow"}}' ]
  # Only the one var may be persisted - the rest of the env carries real secrets.
  run grep -c 'hunter2' "$SESSION_FILE"
  [ "$output" = "0" ]
}

@test "save hook reads OPENCODE_CONFIG_CONTENT from proc environ when available" {
  mkdir -p "$HOME/.local/share/opencode" "$BATS_TEST_TMPDIR/proc/901"
  : >"$HOME/.local/share/opencode/opencode.db"
  printf 'HOME=/Users/connorads\0OPENCODE_CONFIG_CONTENT={"permission":"allow"}\0SECRET_TOKEN=hunter2\0' \
    >"$BATS_TEST_TMPDIR/proc/901/environ"
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\topencode\t/Users/connorads\t/dev/ttys001\n'
	exit 0
fi
exit 1
EOF
  write_stub sqlite3 <<'EOF'
#!/usr/bin/env bash
printf 'ses_current\n'
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*-E*) exit 1 ;;
	*ttys001*) printf ' 901 S+ opencode\n' ;;
	*) exit 1 ;;
esac
EOF

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/proc" \
    run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes["main:1.1"].opencodeEnv' "$SESSION_FILE"
  [ "$output" = '{"permission":"allow"}' ]
  run grep -c 'hunter2' "$SESSION_FILE"
  [ "$output" = "0" ]
}

@test "OpenCode strategy emits recorded env prefix with preserved flags" {
  cat >"$SESSION_FILE" <<'EOF'
{
  "version": 2,
  "panes": {
    "main:1.1": {"dir": "/Users/connorads", "opencode": "ses_pane", "opencodeEnv": "{\"permission\":\"allow\"}"}
  }
}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "display-message" ]; then
	printf 'main:1.1\n'
	exit 0
fi
exit 1
EOF

  run "$REAL_BASH" "$OPENCODE_STRATEGY" "opencode -s ses_old --model anthropic/claude-opus-4" "/Users/connorads"

  [ "$status" -eq 0 ]
  [ "$output" = "OPENCODE_CONFIG_CONTENT='{\"permission\":\"allow\"}' opencode --model anthropic/claude-opus-4 --session ses_pane" ]
}

@test "OpenCode strategy single-quote-escapes the recorded env value" {
  cat >"$SESSION_FILE" <<'EOF'
{
  "version": 2,
  "panes": {
    "main:1.1": {"dir": "/Users/connorads", "opencode": "ses_pane", "opencodeEnv": "{\"note\":\"it's\"}"}
  }
}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "display-message" ]; then
	printf 'main:1.1\n'
	exit 0
fi
exit 1
EOF

  run "$REAL_BASH" "$OPENCODE_STRATEGY" "opencode" "/Users/connorads"

  [ "$status" -eq 0 ]
  [ "$output" = "OPENCODE_CONFIG_CONTENT='{\"note\":\"it'\\''s\"}' opencode --session ses_pane" ]
}

@test "OpenCode strategy restores by pane key and falls back to legacy cwd mapping" {
  cat >"$SESSION_FILE" <<'EOF'
{
  "version": 2,
  "panes": {
    "main:1.1": {"dir": "/Users/connorads", "opencode": "ses_pane"}
  },
  "/Users/connorads": {"opencode": "ses_legacy"}
}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "display-message" ]; then
	printf 'main:1.1\n'
	exit 0
fi
exit 1
EOF

  run "$REAL_BASH" "$OPENCODE_STRATEGY" "opencode" "/Users/connorads"

  [ "$status" -eq 0 ]
  [ "$output" = "opencode --session ses_pane" ]

  cat >"$SESSION_FILE" <<'EOF'
{
  "/Users/connorads": {"opencode": "ses_legacy"}
}
EOF

  run "$REAL_BASH" "$OPENCODE_STRATEGY" "opencode" "/Users/connorads"

  [ "$status" -eq 0 ]
  [ "$output" = "opencode --session ses_legacy" ]
}
