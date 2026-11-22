#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

JANITOR="$FUNCTIONS_DIR/disk-janitor"

setup() {
  setup_test_home
  export DISK_JANITOR_LOG="$HOME/.cache/disk-janitor.log"
  export DISK_JANITOR_CLEANUP_BIN="$TEST_BIN/fake-cleanup"
  export DISK_JANITOR_BACKUP_BIN="$TEST_BIN/fake-backup"
  export DISK_JANITOR_NOTIFY_BIN="$TEST_BIN/fake-notify"
  export NOTIFY_LOG="$BATS_TEST_TMPDIR/notify.log"

  write_stub fake-cleanup <<'EOF'
#!/usr/bin/env bash
echo "cleanup $*" >>"$TEST_LOG"
exit "${FAKE_CLEANUP_RC:-0}"
EOF

  write_stub fake-backup <<'EOF'
#!/usr/bin/env bash
echo "backup $*" >>"$TEST_LOG"
exit "${FAKE_BACKUP_RC:-0}"
EOF

  write_stub fake-notify <<'EOF'
#!/usr/bin/env bash
printf '%s|%s\n' "$1" "$2" >>"$NOTIFY_LOG"
EOF

  write_stub df <<'EOF'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/test 483183820 383183820 %s 80%% /\n' "${FAKE_AVAIL_KB:-104857600}"
EOF
}

@test "runs cleanup --yes and transcript-backup silently when disk is healthy" {
  run zsh --no-rcs "$JANITOR"
  [ "$status" -eq 0 ]
  grep -Fx "cleanup --yes" "$TEST_LOG"
  grep -Fx "backup " "$TEST_LOG"
  [ ! -e "$NOTIFY_LOG" ]
}

@test "notifies when free space stays below threshold after cleanup" {
  # 25 GiB free (< default 40 GiB threshold)
  run env FAKE_AVAIL_KB=$((25 * 1048576)) zsh --no-rcs "$JANITOR"
  [ "$status" -eq 0 ]
  [ -f "$NOTIFY_LOG" ]
  grep -Fx "Low disk space|25G free after cleanup" "$NOTIFY_LOG"
}

@test "runs transcript-backup even if cleanup fails and notifies on failure" {
  run env FAKE_CLEANUP_RC=1 zsh --no-rcs "$JANITOR"
  [ "$status" -eq 1 ]
  grep -Fx "cleanup --yes" "$TEST_LOG"
  grep -Fx "backup " "$TEST_LOG"
  grep -F "Disk janitor failed|" "$NOTIFY_LOG"
}

@test "notifies and exits non-zero when transcript-backup fails" {
  run env FAKE_BACKUP_RC=7 zsh --no-rcs "$JANITOR"
  [ "$status" -eq 1 ]
  grep -F "Disk janitor failed|" "$NOTIFY_LOG"
}
