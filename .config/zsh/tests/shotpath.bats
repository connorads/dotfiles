#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

setup() {
  setup_test_home
  export TEST_CLIPBOARD="$BATS_TEST_TMPDIR/clipboard.txt"
  export TMPDIR="$BATS_TEST_TMPDIR/tmp"
  mkdir -p "$TMPDIR"
  ln -s "$FUNCTIONS_DIR/sendshot" "$TEST_BIN/sendshot"
  ln -s "$FUNCTIONS_DIR/shotpath" "$TEST_BIN/shotpath"

  write_stub date <<'EOF'
#!/usr/bin/env bash
echo 1234567890
EOF
  write_stub pbcopy <<'EOF'
#!/usr/bin/env bash
cat >"$TEST_CLIPBOARD"
EOF
}

write_successful_pngpaste() {
  write_stub pngpaste <<'EOF'
#!/usr/bin/env bash
printf 'PNG' >"$1"
EOF
}

write_remote_stubs() {
  write_stub ssh <<'EOF'
#!/usr/bin/env bash
printf 'ssh %s\n' "$*" >>"$TEST_LOG"
EOF
  write_stub scp <<'EOF'
#!/usr/bin/env bash
printf 'scp %s\n' "$*" >>"$TEST_LOG"
EOF
}

@test "sendshot uploads clipboard image and copies remote path on request" {
  write_successful_pngpaste
  write_remote_stubs

  run_zsh_function "$FUNCTIONS_DIR/sendshot" --copy --host dev

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "/tmp/screenshots/sendshot-1234567890.png" ]
  [ "$(cat "$TEST_CLIPBOARD")" = "/tmp/screenshots/sendshot-1234567890.png" ]
  grep -F "ssh dev mkdir -p '/tmp/screenshots' && chmod 700 '/tmp/screenshots'" "$TEST_LOG"
  grep -F "scp -q $TMPDIR/sendshot-" "$TEST_LOG"
  grep -F "dev:/tmp/screenshots/sendshot-1234567890.png" "$TEST_LOG"
  grep -F "ssh dev chmod 600 '/tmp/screenshots/sendshot-1234567890.png'" "$TEST_LOG"
}

@test "shotpath without host saves local image path and copies it" {
  write_successful_pngpaste

  run_zsh_function "$FUNCTIONS_DIR/shotpath"

  [ "$status" -eq 0 ]
  local expected="$TMPDIR/screenshots/shotpath-1234567890.png"
  [ "${lines[0]}" = "$expected" ]
  [ -s "$expected" ]
  [ "$(cat "$TEST_CLIPBOARD")" = "$expected" ]
}

@test "shotpath remote uses SENDSHOT_HOST without hardcoding a host" {
  write_successful_pngpaste
  write_remote_stubs
  export SENDSHOT_HOST=rpi5

  run_zsh_function "$FUNCTIONS_DIR/shotpath" --remote

  [ "$status" -eq 0 ]
  [[ "$output" == *"/tmp/screenshots/sendshot-1234567890.png"* ]]
  [ "$(cat "$TEST_CLIPBOARD")" = "/tmp/screenshots/sendshot-1234567890.png" ]
  grep -F "ssh rpi5 mkdir -p '/tmp/screenshots' && chmod 700 '/tmp/screenshots'" "$TEST_LOG"
}

@test "shotpath explicit host uploads and copies remote path" {
  write_successful_pngpaste
  write_remote_stubs

  run_zsh_function "$FUNCTIONS_DIR/shotpath" dev

  [ "$status" -eq 0 ]
  [[ "$output" == *"/tmp/screenshots/sendshot-1234567890.png"* ]]
  [ "$(cat "$TEST_CLIPBOARD")" = "/tmp/screenshots/sendshot-1234567890.png" ]
  grep -F "ssh dev mkdir -p '/tmp/screenshots' && chmod 700 '/tmp/screenshots'" "$TEST_LOG"
}

@test "shotpath remote offers ssh config hosts through fzf when interactive" {
  write_successful_pngpaste
  write_remote_stubs
  mkdir -p "$HOME/.ssh"
  cat >"$HOME/.ssh/config" <<'EOF'
Host dev
  HostName dev.example
Host rpi5 *.ignored
  HostName rpi5.example
EOF
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
printf 'fzf %s\n' "$*" >>"$TEST_LOG"
grep -Fx rpi5
EOF

  run_in_tty "SHOTPATH_PICKER=1 shotpath --remote"

  [ "$status" -eq 0 ]
  [[ "$output" == *"/tmp/screenshots/sendshot-1234567890.png"* ]]
  [ "$(cat "$TEST_CLIPBOARD")" = "/tmp/screenshots/sendshot-1234567890.png" ]
  grep -F "fzf --prompt=Upload screenshot to host:  --height=40% --reverse --query=" "$TEST_LOG"
  grep -F "ssh rpi5 mkdir -p '/tmp/screenshots' && chmod 700 '/tmp/screenshots'" "$TEST_LOG"
}

@test "shotpath remote fails clearly when no host is available non-interactively" {
  write_successful_pngpaste

  run_zsh_function "$FUNCTIONS_DIR/shotpath" --remote

  [ "$status" -eq 1 ]
  [[ "$output" == *"host required for --remote"* ]]
}

@test "shotpath --list-hosts prints ssh config aliases, skipping wildcards, no image needed" {
  mkdir -p "$HOME/.ssh"
  cat >"$HOME/.ssh/config" <<'EOF'
Host dev
  HostName dev.example
Host rpi5 *.ignored
  HostName rpi5.example
Host mini
EOF

  run_zsh_function "$FUNCTIONS_DIR/shotpath" --list-hosts

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "dev" ]
  [ "${lines[1]}" = "rpi5" ]
  [ "${lines[2]}" = "mini" ]
  [ "${#lines[@]}" -eq 3 ]
}

@test "shotpath --list-hosts dedups repeated aliases, first-seen order" {
  mkdir -p "$HOME/.ssh"
  cat >"$HOME/.ssh/config" <<'EOF'
Host dev
Host rpi5
Host dev
EOF

  run_zsh_function "$FUNCTIONS_DIR/shotpath" --list-hosts

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "dev" ]
  [ "${lines[1]}" = "rpi5" ]
  [ "${#lines[@]}" -eq 2 ]
}

@test "shotpath --list-hosts succeeds with empty output when no ssh config" {
  run_zsh_function "$FUNCTIONS_DIR/shotpath" --list-hosts

  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}
