#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-hibernate.sh"

# Real private tmux server + isolated HOME (agent-cli.bats socket pattern).
#
# The fake claude is a symlink to $BASH5 running an idle script, and both halves
# of that are load-bearing:
#   - a *binary* (not a script), because `ps -o comm=` reports a script's
#     INTERPRETER, so agent_foreground_pid_for_tty would see "sh"/"bash" and
#     never match "claude"; through a symlink, comm reports the symlink path,
#     whose basename is claude.
#   - a *nix* binary, not /usr/bin/tail: macOS withholds the environment of a
#     SIP-protected process from `ps -E`, so claude_config_dir_for_pid would
#     read no CLAUDE_CONFIG_DIR - an artefact of the fixture, since the real
#     claude is a nix/mise binary whose env `ps -E` shows in full.
# The idle script plus `-f /dev/null` also double as the flag set the record
# must carry verbatim.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  setup_test_home
  unset CLAUDE_CONFIG_DIR
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"

  # Seams exported BEFORE the server starts, so respawned pane processes (the
  # parked thawer) and run-shell jobs inherit them too.
  export AGENT_HIBERNATE_DIR="$BATS_TEST_TMPDIR/hib"
  export AGENT_HIBERNATE_SESSION_FILE="$BATS_TEST_TMPDIR/session_ids.json"
  export AGENT_JOURNAL_DIR="$BATS_TEST_TMPDIR/journal"
  export AGENT_HIBERNATE_KILL_WAIT=1
  export AGENT_HIBERNATE_MATERIALISE=/nonexistent

  # Physical path: tmux reports #{pane_current_path} with symlinks resolved
  # (/var -> /private/var on macOS), and the record stores what tmux reports.
  mkdir -p "$BATS_TEST_TMPDIR/proj"
  PROJ="$(cd "$BATS_TEST_TMPDIR/proj" && pwd -P)"
  # Set here, not in launch_claude_pane: that runs in a command substitution,
  # so its assignments never reach the test body.
  IDLE="$BATS_TEST_TMPDIR/idle.sh"
  FAKE_COMM="$(basename "$(readlink -f "$BASH5" 2>/dev/null || echo "$BASH5")")"
  SOCK="agenthib_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 120 -y 24 -c "$PROJ"
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
}

teardown() {
  stop_private_server
}

# Pane bootstrap: self-register the live-session file keyed by the pane's own
# pid (survives the exec), print a screen marker, become claude.
write_boot() {
  write_executable "$BATS_TEST_TMPDIR/boot.sh" <<'EOF'
#!/bin/sh
mkdir -p "$CLAUDE_REG_DIR"
printf '{"sessionId":"%s","cwd":"%s"}\n' "$SID" "$PWD" >"$CLAUDE_REG_DIR/$$.json"
printf 'MARKER-SCREEN\n'
exec claude "$IDLE" -f /dev/null
EOF
  write_executable "$BATS_TEST_TMPDIR/idle.sh" <<'EOF'
while :; do sleep 1; done
EOF
}

# launch_claude_pane [reg_dir] [extra respawn args...] — turn session s's pane
# into a fake claude and echo its pane id.
launch_claude_pane() {
  local reg_dir="${1:-$HOME/.claude/sessions}"
  shift 2>/dev/null || true
  ln -sf "$BASH5" "$TEST_BIN/claude"
  write_boot
  local pane
  pane=$(tx display-message -p -t s '#{pane_id}')
  tx respawn-pane -k -t "$pane" -c "$PROJ" \
    -e SID=sid-test -e IDLE="$IDLE" -e CLAUDE_REG_DIR="$reg_dir" "$@" \
    "$BATS_TEST_TMPDIR/boot.sh"
  # tmux reports the resolved binary name, not the symlink ps sees: the fake
  # claude therefore shows up here as $FAKE_COMM.
  wait_until -d 'tx display-message -p -t "$pane" "#{pane_current_command}"' \
    '[ "$(tx display-message -p -t "$pane" "#{pane_current_command}")" = "$FAKE_COMM" ]'
  printf '%s\n' "$pane"
}

# The thaw-side claude: a recorder stub that logs its env + argv.
write_claude_recorder() {
  write_stub claude <<'EOF'
#!/bin/sh
printf 'CFG=%s args=%s\n' "${CLAUDE_CONFIG_DIR:-}" "$*" >>"$CLAUDE_OUT"
exec tail -f /dev/null
EOF
}

record() { printf '%s\n' "$AGENT_HIBERNATE_DIR/sid-test.json"; }
pstate() { tx show-options -pqv -t "$1" @agent_state; }

@test "hibernate refuses a working pane with exit 6 and leaves it alive" {
  pane=$(launch_claude_pane)
  tx set-option -p -t "$pane" @agent_state working
  run -6 "$SCRIPT" hibernate "$pane"
  [[ "$output" == *"refusing"* ]]
  [ "$(tx display-message -p -t "$pane" '#{pane_current_command}')" = "$FAKE_COMM" ]
  [ ! -f "$(record)" ]
}

@test "hibernate refuses an untracked (empty-state) pane without --force" {
  pane=$(launch_claude_pane)
  run -6 "$SCRIPT" hibernate "$pane"
  [[ "$output" == *"untracked"* ]]
}

@test "hibernate --force takes an untracked pane (the silent-batch shape)" {
  pane=$(launch_claude_pane)
  run "$SCRIPT" hibernate "$pane" --force
  [ "$status" -eq 0 ]
  [ -f "$(record)" ]
}

@test "hibernate with no resolvable session refuses rather than falling back" {
  # Registry pointed at an empty dir: no sessions/<pid>.json, resolver finds
  # nothing in the isolated HOME - must refuse, never --continue.
  pane=$(launch_claude_pane "$BATS_TEST_TMPDIR/empty-reg")
  rm -f "$BATS_TEST_TMPDIR/empty-reg"/*.json
  tx set-option -p -t "$pane" @agent_state idle
  run -1 "$SCRIPT" hibernate "$pane"
  [[ "$output" == *"cannot resolve"* ]]
  [ "$(tx display-message -p -t "$pane" '#{pane_current_command}')" = "$FAKE_COMM" ]
  [ ! -f "$(record)" ]
}

@test "hibernate kills claude, writes the record, parks the thawer" {
  pane=$(launch_claude_pane)
  tx set-option -p -t "$pane" @agent_state idle
  run "$SCRIPT" hibernate "$pane"
  [ "$status" -eq 0 ]
  [[ "$output" == *"freed"* ]]

  # Record contents.
  [ -f "$(record)" ]
  [ "$(jq -r '.sessionId' "$(record)")" = sid-test ]
  [ "$(jq -r '.pane' "$(record)")" = "$pane" ]
  [ "$(jq -r '.cwd' "$(record)")" = "$PROJ" ]
  [ "$(jq -r '.paneKey' "$(record)")" = "$(tx display-message -p -t "$pane" '#{session_name}:#{window_index}.#{pane_index}')" ]
  # Launch flags survive verbatim (stale resume state would be stripped).
  [ "$(jq -c '.flags' "$(record)")" = "[\"$IDLE\",\"-f\",\"/dev/null\"]" ]
  jq -e '.rssKb >= 0' "$(record)"
  [ -f "$AGENT_HIBERNATE_DIR/sid-test.screen.txt" ]
  grep -q 'MARKER-SCREEN' "$AGENT_HIBERNATE_DIR/sid-test.screen.txt"

  # State + park: claude gone, thawer re-prints the screen and shows the banner.
  [ "$(pstate "$pane")" = hibernated ]
  wait_until -d 'tx capture-pane -p -t "$pane"' \
    'tx capture-pane -p -t "$pane" | grep -q "Enter to thaw"'
  tx capture-pane -p -t "$pane" | grep -q 'MARKER-SCREEN'
}

@test "hibernate records the pane's ccp account (CLAUDE_CONFIG_DIR)" {
  acct=work
  cfg="$HOME/.claude-profiles/code/$acct"
  pane=$(launch_claude_pane "$cfg/sessions" -e CLAUDE_CONFIG_DIR="$cfg")
  tx set-option -p -t "$pane" @agent_state idle
  run "$SCRIPT" hibernate "$pane"
  [ "$status" -eq 0 ]
  [ "$(jq -r '.configDir' "$(record)")" = "$cfg" ]
}

@test "thaw respawns claude with --resume, the flags and the account, then cleans up" {
  acct=work
  cfg="$HOME/.claude-profiles/code/$acct"
  pane=$(launch_claude_pane "$cfg/sessions" -e CLAUDE_CONFIG_DIR="$cfg")
  tx set-option -p -t "$pane" @agent_state idle
  run "$SCRIPT" hibernate "$pane"
  [ "$status" -eq 0 ]

  export CLAUDE_OUT="$BATS_TEST_TMPDIR/claude.out"
  tx set-environment -g CLAUDE_OUT "$CLAUDE_OUT"
  rm -f "$TEST_BIN/claude"
  write_claude_recorder
  run "$SCRIPT" thaw "$pane"
  [ "$status" -eq 0 ]
  wait_until -d 'cat "$CLAUDE_OUT" 2>/dev/null' '[ -s "$CLAUDE_OUT" ]'
  grep -q -- '--resume sid-test' "$CLAUDE_OUT"
  grep -q -- '-f /dev/null --resume' "$CLAUDE_OUT"
  grep -q "CFG=$cfg" "$CLAUDE_OUT"
  [ ! -f "$(record)" ]
  [ ! -f "$AGENT_HIBERNATE_DIR/sid-test.screen.txt" ]
  [ "$(pstate "$pane")" = idle ]
}

@test "Enter in the parked pane thaws it (the whole round trip)" {
  pane=$(launch_claude_pane)
  tx set-option -p -t "$pane" @agent_state idle
  run "$SCRIPT" hibernate "$pane"
  [ "$status" -eq 0 ]
  wait_until 'tx capture-pane -p -t "$pane" | grep -q "Enter to thaw"'

  export CLAUDE_OUT="$BATS_TEST_TMPDIR/claude.out"
  tx set-environment -g CLAUDE_OUT "$CLAUDE_OUT"
  rm -f "$TEST_BIN/claude"
  write_claude_recorder
  tx send-keys -t "$pane" Enter
  wait_until -t 15 -d 'cat "$CLAUDE_OUT" 2>/dev/null' '[ -s "$CLAUDE_OUT" ]'
  grep -q -- '--resume sid-test' "$CLAUDE_OUT"
  wait_until '[ ! -f "$(record)" ]'
}

@test "park re-addresses a drifted record via unique cwd and re-arms the state" {
  pane=$(launch_claude_pane)
  tx set-option -p -t "$pane" @agent_state idle
  run "$SCRIPT" hibernate "$pane"
  [ "$status" -eq 0 ]
  # Simulate a restore: stale addresses in the record, fresh park in the pane.
  jq '.pane = "%999" | .paneKey = "gone:9.9"' "$(record)" >"$(record).new"
  mv "$(record).new" "$(record)"
  tx set-option -pu -t "$pane" @agent_state
  tx respawn-pane -k -t "$pane" -c "$PROJ" "$SCRIPT" park
  wait_until -d 'tx capture-pane -p -t "$pane"' \
    'tx capture-pane -p -t "$pane" | grep -q "Enter to thaw"'
  [ "$(jq -r '.pane' "$(record)")" = "$pane" ]
  [ "$(pstate "$pane")" = hibernated ]
}

@test "park resolves through the session_ids.json hibernated entry" {
  pane=$(launch_claude_pane)
  tx set-option -p -t "$pane" @agent_state idle
  run "$SCRIPT" hibernate "$pane"
  [ "$status" -eq 0 ]
  key=$(tx display-message -p -t "$pane" '#{session_name}:#{window_index}.#{pane_index}')
  # Stale addresses AND a decoy record in the same cwd, so neither the direct
  # nor the cwd rung can resolve - only the session_ids route can.
  jq '.pane = "%999" | .paneKey = "gone:9.9"' "$(record)" >"$(record).new"
  mv "$(record).new" "$(record)"
  jq '.sessionId = "sid-decoy" | .pane = "%998"' "$(record)" \
    >"$AGENT_HIBERNATE_DIR/sid-decoy.json"
  jq -n --arg k "$key" --arg dir "$PROJ" \
    '{version: 2, panes: {($k): {dir: $dir, claude: "sid-test", hibernated: true}}}' \
    >"$AGENT_HIBERNATE_SESSION_FILE"
  tx set-option -pu -t "$pane" @agent_state
  tx respawn-pane -k -t "$pane" -c "$PROJ" "$SCRIPT" park
  wait_until 'tx capture-pane -p -t "$pane" | grep -q "Enter to thaw"'
  [ "$(jq -r '.pane' "$(record)")" = "$pane" ]
  [ "$(jq -r '.pane' "$AGENT_HIBERNATE_DIR/sid-decoy.json")" = '%998' ]
}

@test "park with no resolvable record holds as an orphan" {
  mkdir -p "$AGENT_HIBERNATE_DIR"
  pane=$(tx display-message -p -t s '#{pane_id}')
  tx respawn-pane -k -t "$pane" -c "$PROJ" "$SCRIPT" park
  wait_until 'tx capture-pane -p -t "$pane" | grep -q "orphaned hibernation"'
}

@test "list marks live parked panes parked and dead ones orphan" {
  pane=$(launch_claude_pane)
  tx set-option -p -t "$pane" @agent_state idle
  run "$SCRIPT" hibernate "$pane"
  [ "$status" -eq 0 ]
  jq '.sessionId = "sid-dead" | .pane = "%999"' "$(record)" \
    >"$AGENT_HIBERNATE_DIR/sid-dead.json"
  run "$SCRIPT" list
  [ "$status" -eq 0 ]
  [[ "$output" == *"sid-test	parked"* ]]
  [[ "$output" == *"sid-dead	orphan"* ]]
}

@test "thaw of an orphan record opens a new window in the recorded cwd" {
  mkdir -p "$AGENT_HIBERNATE_DIR"
  jq -n --arg cwd "$PROJ" \
    '{sessionId: "sid-test", pane: "%999", paneKey: "gone:9.9", cwd: $cwd,
      configDir: "", flags: [], name: "", hibernatedAt: "2026-01-01T00:00:00Z",
      rssKb: 0}' >"$(record)"
  export CLAUDE_OUT="$BATS_TEST_TMPDIR/claude.out"
  tx set-environment -g CLAUDE_OUT "$CLAUDE_OUT"
  write_claude_recorder
  run "$SCRIPT" thaw sid-test
  [ "$status" -eq 0 ]
  wait_until -d 'cat "$CLAUDE_OUT" 2>/dev/null' '[ -s "$CLAUDE_OUT" ]'
  grep -q -- '--resume sid-test' "$CLAUDE_OUT"
  [ "$(tx list-windows -t s | wc -l | tr -d ' ')" = 2 ]
  [ ! -f "$(record)" ]
}

@test "thaw with an unknown target exits 3" {
  mkdir -p "$AGENT_HIBERNATE_DIR"
  run -3 "$SCRIPT" thaw nosuchsid
  [[ "$output" == *"no hibernation record"* ]]
}
