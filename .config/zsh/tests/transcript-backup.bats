#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

TB="$FUNCTIONS_DIR/transcript-backup"

OLD=202601010000
UUID_A=11111111-1111-4111-8111-111111111111
UUID_B=22222222-2222-4222-8222-222222222222
UUID_C=33333333-3333-4333-8333-333333333333

link_tool() {
  local tool=$1 real
  real=$(PATH="$ORIG_PATH" command -v "$tool") || skip "$tool not installed"
  ln -sf "$real" "$TEST_BIN/$tool"
}

setup() {
  ORIG_PATH=$PATH
  setup_test_home
  for tool in age age-keygen zstd rclone; do link_tool "$tool"; done
  REAL_RCLONE_BIN=$(PATH="$ORIG_PATH" command -v rclone)
  export REAL_RCLONE_BIN

  mkdir -p "$HOME/.config/transcript-backup" "$HOME/.local/state/agent-hibernate"
  age-keygen -o "$BATS_TEST_TMPDIR/identity" 2>/dev/null
  age-keygen -y "$BATS_TEST_TMPDIR/identity" >"$HOME/.config/transcript-backup/recipients.txt"

  export TRANSCRIPT_BACKUP_REMOTE="$BATS_TEST_TMPDIR/remote"
  export AGENT_HIBERNATE_DIR="$HOME/.local/state/agent-hibernate"

  P="$HOME/.claude/projects/-Users-me-proj"
  mkdir -p "$P/$UUID_A/subagents" "$P/memory" "$HOME/.codex/archived_sessions"
  printf 'old session a\n' >"$P/$UUID_A.jsonl"
  printf 'sidecar a\n' >"$P/$UUID_A/subagents/agent-1.jsonl"
  printf 'recent session b\n' >"$P/$UUID_B.jsonl"
  printf 'hibernated session c\n' >"$P/$UUID_C.jsonl"
  printf 'remember this\n' >"$P/memory/MEMORY.md"
  printf 'old codex\n' >"$HOME/.codex/archived_sessions/rollout-2026-01-01T00-00-00-x.jsonl"
  for f in "$P/$UUID_A.jsonl" "$P/$UUID_A/subagents/agent-1.jsonl" "$P/$UUID_C.jsonl" \
    "$P/memory/MEMORY.md" "$HOME/.codex/archived_sessions/rollout-2026-01-01T00-00-00-x.jsonl"; do
    touch -t "$OLD" "$f"
  done
  printf '{"sessionId":"%s"}\n' "$UUID_C" >"$AGENT_HIBERNATE_DIR/$UUID_C.json"
}

# Replace the rclone symlink with a wrapper. Unlink first: write_executable's
# `cat >` would otherwise follow the symlink into the real binary.
fake_rclone() {
  rm -f "$TEST_BIN/rclone"
  write_executable "$TEST_BIN/rclone"
}

remote_archive() {
  find "$TRANSCRIPT_BACKUP_REMOTE" -name '*.tar.zst.age' -type f | head -1
}

restore_listing() {
  age -d -i "$BATS_TEST_TMPDIR/identity" "$(remote_archive)" | zstd -dq | tar -tf - | sort
}

@test "backs up idle sessions, verifies them, then deletes the originals" {
  run "$TB"
  [ "$status" -eq 0 ]

  run restore_listing
  [ "$status" -eq 0 ]
  [[ "$output" == *".claude/projects/-Users-me-proj/$UUID_A.jsonl"* ]]
  [[ "$output" == *".claude/projects/-Users-me-proj/$UUID_A/subagents/agent-1.jsonl"* ]]
  [[ "$output" == *".codex/archived_sessions/rollout-2026-01-01T00-00-00-x.jsonl"* ]]

  [ ! -e "$P/$UUID_A.jsonl" ]
  [ ! -e "$P/$UUID_A" ]
  [ ! -e "$HOME/.codex/archived_sessions/rollout-2026-01-01T00-00-00-x.jsonl" ]
}

@test "restored bytes match the originals" {
  cp "$P/$UUID_A.jsonl" "$BATS_TEST_TMPDIR/expected"
  run "$TB"
  [ "$status" -eq 0 ]
  mkdir "$BATS_TEST_TMPDIR/out"
  age -d -i "$BATS_TEST_TMPDIR/identity" "$(remote_archive)" | zstd -dq | tar -xf - -C "$BATS_TEST_TMPDIR/out"
  cmp "$BATS_TEST_TMPDIR/expected" "$BATS_TEST_TMPDIR/out/.claude/projects/-Users-me-proj/$UUID_A.jsonl"
}

@test "never touches recent sessions, hibernated sessions or memory" {
  run "$TB"
  [ "$status" -eq 0 ]
  run restore_listing
  [[ "$output" != *"$UUID_B"* ]]
  [[ "$output" != *"$UUID_C"* ]]
  [[ "$output" != *"MEMORY.md"* ]]
  [ -e "$P/$UUID_B.jsonl" ]
  [ -e "$P/$UUID_C.jsonl" ]
  [ -e "$P/memory/MEMORY.md" ]
}

@test "--no-prune uploads but keeps every original" {
  run "$TB" --no-prune
  [ "$status" -eq 0 ]
  [ -n "$(remote_archive)" ]
  [ -e "$P/$UUID_A.jsonl" ]
  [ -e "$HOME/.codex/archived_sessions/rollout-2026-01-01T00-00-00-x.jsonl" ]
}

@test "--dry-run lists candidates and changes nothing" {
  run "$TB" --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"$UUID_A.jsonl"* ]]
  [ -z "$(find "$TRANSCRIPT_BACKUP_REMOTE" -type f 2>/dev/null)" ]
  [ -e "$P/$UUID_A.jsonl" ]
}

@test "a failed upload deletes nothing and exits non-zero" {
  fake_rclone <<'EOF'
#!/bin/sh
[ "$1" = copyto ] && { echo "upload refused" >&2; exit 7; }
exec "$REAL_RCLONE_BIN" "$@"
EOF
  run "$TB"
  [ "$status" -ne 0 ]
  [ -e "$P/$UUID_A.jsonl" ]
  [ -e "$HOME/.codex/archived_sessions/rollout-2026-01-01T00-00-00-x.jsonl" ]
}

@test "a failed run removes its staging archive" {
  fake_rclone <<'EOF2'
#!/bin/sh
[ "$1" = copyto ] && exit 7
exec "$REAL_RCLONE_BIN" "$@"
EOF2
  export TMPDIR="$BATS_TEST_TMPDIR/stage"
  mkdir -p "$TMPDIR"
  run "$TB"
  [ "$status" -ne 0 ]
  [ -z "$(find "$TMPDIR" -mindepth 1 -print)" ]
}

@test "a remote checksum that does not match deletes nothing" {
  fake_rclone <<'EOF'
#!/bin/sh
[ "$1" = lsjson ] && { printf '[{"Name":"x","Hashes":{"sha1":"0000000000000000000000000000000000000000"}}]'; exit 0; }
exec "$REAL_RCLONE_BIN" "$@"
EOF
  run "$TB"
  [ "$status" -ne 0 ]
  [[ "$output" == *"verification failed"* ]]
  [ -e "$P/$UUID_A.jsonl" ]
}

@test "a missing remote checksum deletes nothing" {
  fake_rclone <<'EOF'
#!/bin/sh
[ "$1" = lsjson ] && { printf '[]'; exit 0; }
exec "$REAL_RCLONE_BIN" "$@"
EOF
  run "$TB"
  [ "$status" -ne 0 ]
  [ -e "$P/$UUID_A.jsonl" ]
}

@test "verification never downloads the archive" {
  fake_rclone <<'EOF'
#!/bin/sh
[ "$1" = cat ] && { echo "download attempted" >&2; exit 9; }
exec "$REAL_RCLONE_BIN" "$@"
EOF
  run "$TB"
  [ "$status" -eq 0 ]
  [ ! -e "$P/$UUID_A.jsonl" ]
}

@test "a session that changes during the upload is kept" {
  fake_rclone <<'EOF'
#!/bin/sh
[ "$1" = copyto ] && printf 'resumed\n' >>"$CHANGED_FILE"
exec "$REAL_RCLONE_BIN" "$@"
EOF
  export CHANGED_FILE="$P/$UUID_A.jsonl"
  run "$TB"
  [ "$status" -eq 0 ]
  [ -e "$P/$UUID_A.jsonl" ]
  [ ! -e "$HOME/.codex/archived_sessions/rollout-2026-01-01T00-00-00-x.jsonl" ]
}

@test "an unreadable hibernation record stops the run before anything moves" {
  printf 'not json' >"$AGENT_HIBERNATE_DIR/broken.json"
  run "$TB"
  [ "$status" -ne 0 ]
  [ -z "$(find "$TRANSCRIPT_BACKUP_REMOTE" -type f 2>/dev/null)" ]
  [ -e "$P/$UUID_A.jsonl" ]
}

@test "a missing recipients file stops the run before anything moves" {
  rm "$HOME/.config/transcript-backup/recipients.txt"
  run "$TB"
  [ "$status" -ne 0 ]
  [[ "$output" == *"recipients"* ]]
  [ -e "$P/$UUID_A.jsonl" ]
}

@test "nothing idle means no archive and success" {
  touch "$P/$UUID_A.jsonl" "$P/$UUID_A/subagents/agent-1.jsonl" \
    "$HOME/.codex/archived_sessions/rollout-2026-01-01T00-00-00-x.jsonl"
  run "$TB"
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing to back up"* ]]
  [ -z "$(find "$TRANSCRIPT_BACKUP_REMOTE" -type f 2>/dev/null)" ]
}
