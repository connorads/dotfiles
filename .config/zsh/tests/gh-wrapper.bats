#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

ROOT_DIR="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
GH_WRAPPER="$ROOT_DIR/.local/bin/gh"

setup() {
  setup_test_home
  unset GH_TOKEN GITHUB_TOKEN
  export REAL_GH_DIR="$BATS_TEST_TMPDIR/real-gh"
  mkdir -p "$REAL_GH_DIR" "$HOME/.local/bin" "$HOME/.local/share/mise/shims"
  write_executable "$REAL_GH_DIR/gh" <<'EOF'
#!/usr/bin/env bash
printf 'GH_TOKEN=%s\n' "${GH_TOKEN-}"
printf 'args=%s\n' "$*"
exit "${REAL_GH_EXIT:-0}"
EOF
  export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$REAL_GH_DIR:/usr/bin:/bin:/usr/sbin:/sbin"
}

write_token_config() {
  mkdir -p "$HOME/.config/gh-gate"
}

@test "unmanaged hosts preserve caller GH_TOKEN" {
  export GH_TOKEN="caller-token"

  run "$GH_WRAPPER" pr view 123

  [ "$status" -eq 0 ]
  [[ "$output" == *"GH_TOKEN=caller-token"* ]]
  [[ "$output" == *"args=pr view 123"* ]]
}

@test "readonly token is used when no active token exists" {
  write_token_config
  printf 'readonly-token' >"$HOME/.config/gh-gate/readonly-token"
  export GH_TOKEN="caller-token"

  run "$GH_WRAPPER" issue list

  [ "$status" -eq 0 ]
  [[ "$output" == *"GH_TOKEN=readonly-token"* ]]
}

@test "unexpired active token wins over readonly token" {
  write_token_config
  printf 'active-token' >"$HOME/.config/gh-gate/active-token"
  printf 'readonly-token' >"$HOME/.config/gh-gate/readonly-token"
  printf '%s' "$(($(date +%s) + 3600))" >"$HOME/.config/gh-gate/active-token-expires"

  run "$GH_WRAPPER" api user

  [ "$status" -eq 0 ]
  [[ "$output" == *"GH_TOKEN=active-token"* ]]
}

@test "expired active token falls back to readonly token" {
  write_token_config
  printf 'active-token' >"$HOME/.config/gh-gate/active-token"
  printf 'readonly-token' >"$HOME/.config/gh-gate/readonly-token"
  printf '%s' "$(($(date +%s) - 60))" >"$HOME/.config/gh-gate/active-token-expires"

  run "$GH_WRAPPER" api user

  [ "$status" -eq 0 ]
  [[ "$output" == *"GH_TOKEN=readonly-token"* ]]
}

@test "active token without expiry unsets caller token and does not invent one" {
  write_token_config
  printf 'active-token' >"$HOME/.config/gh-gate/active-token"
  export GH_TOKEN="caller-token"

  run "$GH_WRAPPER" api user

  [ "$status" -eq 0 ]
  [[ "$output" == *"GH_TOKEN="* ]]
  [[ "$output" != *"caller-token"* ]]
}

@test "malformed active expiry falls back to readonly token" {
  write_token_config
  printf 'active-token' >"$HOME/.config/gh-gate/active-token"
  printf 'readonly-token' >"$HOME/.config/gh-gate/readonly-token"
  printf 'not-a-number' >"$HOME/.config/gh-gate/active-token-expires"

  run "$GH_WRAPPER" api user

  [ "$status" -eq 0 ]
  [[ "$output" == *"GH_TOKEN=readonly-token"* ]]
}

@test "real gh lookup skips local bin and mise shims" {
  write_executable "$HOME/.local/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo 'wrong local gh'
exit 42
EOF
  write_executable "$HOME/.local/share/mise/shims/gh" <<'EOF'
#!/usr/bin/env bash
echo 'wrong mise shim gh'
exit 43
EOF

  run "$GH_WRAPPER" status

  [ "$status" -eq 0 ]
  [[ "$output" == *"args=status"* ]]
  [[ "$output" != *"wrong local gh"* ]]
  [[ "$output" != *"wrong mise shim gh"* ]]
}

@test "wrapper propagates real gh exit status" {
  export REAL_GH_EXIT=37

  run "$GH_WRAPPER" auth status

  [ "$status" -eq 37 ]
  [[ "$output" == *"args=auth status"* ]]
}

@test "missing real gh exits 127 when no fallback gh is available" {
  local gh_user="${USER:-${HOME##*/}}"
  local fallback
  for fallback in \
    "/etc/profiles/per-user/$gh_user/bin/gh" \
    "$HOME/.nix-profile/bin/gh" \
    "/run/current-system/sw/bin/gh" \
    /opt/homebrew/bin/gh \
    /usr/local/bin/gh \
    /usr/bin/gh; do
    [ -x "$fallback" ] && skip "real gh fallback exists at $fallback"
  done
  rm -f "$REAL_GH_DIR/gh"

  run env PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:/usr/bin:/bin:/usr/sbin:/sbin" "$GH_WRAPPER" status

  [ "$status" -eq 127 ]
  [[ "$output" == *"gh wrapper: cannot find real gh in PATH"* ]]
}
