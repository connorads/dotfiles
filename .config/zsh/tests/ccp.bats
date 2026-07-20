#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CCP="$FUNCTIONS_DIR/ccp"
REAL_CLAUDE_CODE_PROFILE="$FUNCTIONS_DIR/claude-code-profile"

setup() {
  setup_test_home
}

# Log every arg on its own line so tests can assert exact forwarding.
stub_arg_logger() {
  write_stub "$1" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" >"$TEST_LOG"
EOF
}

@test "forwards a named account and its args to the profile launcher" {
  stub_arg_logger claude-code-profile

  run_zsh_function "$CCP" acme --model fable

  [ "$status" -eq 0 ]
  run cat "$TEST_LOG"
  [ "${lines[0]}" = "acme" ]
  [ "${lines[1]}" = "--model" ]
  [ "${lines[2]}" = "fable" ]
}

@test "-y injects the cy flags ahead of a named account's args" {
  stub_arg_logger claude-code-profile

  run_zsh_function "$CCP" -y acme --model fable

  [ "$status" -eq 0 ]
  run cat "$TEST_LOG"
  [ "${lines[0]}" = "acme" ]
  [ "${lines[1]}" = "--append-system-prompt-file" ]
  [ "${lines[2]}" = "$HOME/.claude/system-append.md" ]
  [ "${lines[3]}" = "--dangerously-skip-permissions" ]
  [ "${lines[4]}" = "--model" ]
  [ "${lines[5]}" = "fable" ]
}

@test "--yolo injects the cy flags on the default account" {
  write_stub claude <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" >"$TEST_LOG"
EOF

  run_zsh_function "$CCP" --yolo default --resume abc

  [ "$status" -eq 0 ]
  run cat "$TEST_LOG"
  [ "${lines[0]}" = "--append-system-prompt-file" ]
  [ "${lines[1]}" = "$HOME/.claude/system-append.md" ]
  [ "${lines[2]}" = "--dangerously-skip-permissions" ]
  [ "${lines[3]}" = "--resume" ]
  [ "${lines[4]}" = "abc" ]
}

@test "-y with no account picks via fzf then injects the cy flags" {
  # Build the path via a var so no concrete profile path is committed.
  local acct=acme
  mkdir -p "$HOME/.claude-profiles/code/$acct"
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf 'acme\n'
EOF
  stub_arg_logger claude-code-profile

  run_zsh_function "$CCP" -y

  [ "$status" -eq 0 ]
  run cat "$TEST_LOG"
  [ "${lines[0]}" = "acme" ]
  [ "${lines[1]}" = "--append-system-prompt-file" ]
  [ "${lines[2]}" = "$HOME/.claude/system-append.md" ]
  [ "${lines[3]}" = "--dangerously-skip-permissions" ]
  [ "${#lines[@]}" -eq 4 ]
}

@test "default launches bare claude on the plain config" {
  stub_arg_logger claude

  run_zsh_function "$CCP" default --resume abc

  [ "$status" -eq 0 ]
  run cat "$TEST_LOG"
  [ "${lines[0]}" = "--resume" ]
  [ "${lines[1]}" = "abc" ]
}

@test "no argument and no fzf errors with usage" {
  # zsh and fzf share the nix profile bin on this host, so the default test
  # PATH always finds fzf. Use the system zsh with a PATH that excludes nix to
  # exercise the no-picker branch.
  local sys_zsh
  sys_zsh=$(PATH=/bin:/usr/bin command -v zsh)
  [ -n "$sys_zsh" ] || skip "no system zsh outside nix profile"

  PATH="$TEST_BIN:/bin:/usr/bin" run "$sys_zsh" --no-rcs "$CCP"

  [ "$status" -eq 2 ]
  [[ "$output" == *"fzf is unavailable"* ]]
  [[ "$output" == *"usage: ccp"* ]]
}

@test "picker selects a profile and delegates to the profile launcher" {
  # Build the path via a var so no concrete profile path is committed.
  local acct=acme
  mkdir -p "$HOME/.claude-profiles/code/$acct"
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf 'acme\n'
EOF
  stub_arg_logger claude-code-profile

  run_zsh_function "$CCP"

  [ "$status" -eq 0 ]
  run cat "$TEST_LOG"
  [ "${lines[0]}" = "acme" ]
  [ "${#lines[@]}" -eq 1 ]
}

@test "picker selecting default launches bare claude" {
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf 'default\n'
EOF
  write_stub claude <<EOF
#!/usr/bin/env bash
printf 'claude-called:%s\n' "\$*" >"$TEST_LOG"
EOF

  run_zsh_function "$CCP"

  [ "$status" -eq 0 ]
  run cat "$TEST_LOG"
  [ "${lines[0]}" = "claude-called:" ]
}

@test "picker cancelled (empty selection) exits without launching" {
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
exit 130
EOF
  write_stub claude-code-profile <<EOF
#!/usr/bin/env bash
printf 'should-not-run\n' >"$TEST_LOG"
EOF

  run_zsh_function "$CCP"

  [ "$status" -eq 130 ]
  [ ! -s "$TEST_LOG" ]
}

@test "an invalid account name is rejected by claude-code-profile" {
  cp "$REAL_CLAUDE_CODE_PROFILE" "$TEST_BIN/claude-code-profile"
  chmod +x "$TEST_BIN/claude-code-profile"
  # Guard: claude must never be reached for an invalid name.
  write_stub claude <<EOF
#!/usr/bin/env bash
printf 'claude-ran\n' >"$TEST_LOG"
EOF

  run_zsh_function "$CCP" ../evil

  [ "$status" -eq 2 ]
  [[ "$output" == *"profile name must match"* ]]
  [ ! -s "$TEST_LOG" ]
}
