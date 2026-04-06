#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CLEANUP="$FUNCTIONS_DIR/cleanup"

setup() {
  setup_test_home
  export CLEANUP_TMPDIR_ROOT="$HOME/tmp-root"
  mkdir -p \
    "$HOME/.bun/install/cache/pkg" \
    "$HOME/.cache/.bun/install/cache/pkg" \
    "$HOME/.local/share/pnpm/store/v10/pkg" \
    "$HOME/.cache/pnpm/pkg" \
    "$HOME/.npm/cache" \
    "$HOME/.cache/pip/http-v2" \
    "$HOME/.cache/uv/archive" \
    "$HOME/.cargo/registry/cache" \
    "$HOME/.cache/nvim/state" \
    "$HOME/.cache/ms-playwright/browser" \
    "$HOME/.cache/puppeteer/browser" \
    "$HOME/.cache/camoufox/browser" \
    "$CLEANUP_TMPDIR_ROOT/old-dir" \
    "$CLEANUP_TMPDIR_ROOT/new-dir"

  touch "$HOME/.bun/install/cache/pkg/data"
  touch "$HOME/.cache/.bun/install/cache/pkg/data"
  touch "$HOME/.local/share/pnpm/store/v10/pkg/data"
  touch "$HOME/.cache/pnpm/pkg/data"
  touch "$HOME/.npm/cache/data"
  touch "$HOME/.cache/pip/http-v2/data"
  touch "$HOME/.cache/uv/archive/data"
  touch "$HOME/.cargo/registry/cache/data"
  touch "$HOME/.cache/nvim/state/data"
  touch "$HOME/.cache/ms-playwright/browser/data"
  touch "$HOME/.cache/puppeteer/browser/data"
  touch "$HOME/.cache/camoufox/browser/data"
  touch "$CLEANUP_TMPDIR_ROOT/old-dir/data"
  touch "$CLEANUP_TMPDIR_ROOT/new-dir/data"
  touch -d '10 days ago' "$CLEANUP_TMPDIR_ROOT/old-dir"
  touch -d '10 days ago' "$CLEANUP_TMPDIR_ROOT/old-dir/data"

  write_stub bun <<'EOF'
#!/usr/bin/env bash
echo "bun $*" >>"$TEST_LOG"
if [ "${1:-}" = "pm" ] && [ "${2:-}" = "cache" ] && [ "${3:-}" = "rm" ]; then
  [ -n "${BUN_PM_CACHE_FAIL:-}" ] && exit 1
  exit 0
fi
exit 0
EOF

  write_stub pnpm <<'EOF'
#!/usr/bin/env bash
echo "pnpm $*" >>"$TEST_LOG"
if [ "${1:-}" = "store" ] && [ "${2:-}" = "path" ]; then
  printf '%s\n' "$HOME/.local/share/pnpm/store/v10"
  exit 0
fi
if [ "${1:-}" = "store" ] && [ "${2:-}" = "prune" ]; then
  exit 0
fi
exit 0
EOF

  write_stub npm <<'EOF'
#!/usr/bin/env bash
echo "npm $*" >>"$TEST_LOG"
exit 0
EOF

  write_stub pip <<'EOF'
#!/usr/bin/env bash
echo "pip $*" >>"$TEST_LOG"
exit 0
EOF

  write_stub uv <<'EOF'
#!/usr/bin/env bash
echo "uv $*" >>"$TEST_LOG"
exit 0
EOF

  write_stub docker <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >>"$TEST_LOG"
if [ "${1:-}" = "info" ]; then
  exit 0
fi
if [ "${1:-}" = "system" ] && [ "${2:-}" = "df" ]; then
  printf 'Images|2GB (100%%)\n'
  printf 'Containers|0B (0%%)\n'
  printf 'Local Volumes|1GB (100%%)\n'
  printf 'Build Cache|512MB\n'
  exit 0
fi
if [ "${1:-}" = "system" ] && [ "${2:-}" = "prune" ]; then
  exit 0
fi
exit 0
EOF

  write_stub nix-collect-garbage <<'EOF'
#!/usr/bin/env bash
echo "nix-collect-garbage $*" >>"$TEST_LOG"
exit 0
EOF

  write_stub nix-store <<'EOF'
#!/usr/bin/env bash
echo "nix-store $*" >>"$TEST_LOG"
exit 0
EOF
}

@test "non-interactive cleanup refuses execution without --yes" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP"

  [ "$status" -eq 1 ]
  [[ "$output" == *"error: non-interactive execution requires --yes"* ]]
  [[ "$(cat "$TEST_LOG")" != *"pnpm store prune"* ]]
  [[ "$(cat "$TEST_LOG")" != *"npm cache clean --force"* ]]
  [[ "$(cat "$TEST_LOG")" != *"docker system prune -af"* ]]
}

@test "default cleanup with --yes executes the default target set" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes

  [ "$status" -eq 0 ]
  grep -F "bun pm cache rm" "$TEST_LOG"
  grep -F "pnpm store prune" "$TEST_LOG"
  grep -F "npm cache clean --force" "$TEST_LOG"
  grep -F "pip cache purge" "$TEST_LOG"
  grep -F "uv cache clean" "$TEST_LOG"
  grep -F "docker system prune -af" "$TEST_LOG"
  grep -F "nix-collect-garbage --delete-older-than 30d" "$TEST_LOG"
  [ ! -e "$CLEANUP_TMPDIR_ROOT/old-dir" ]
  [ -e "$CLEANUP_TMPDIR_ROOT/new-dir" ]
}

@test "selector flags replace the default target set" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --bun

  [ "$status" -eq 0 ]
  [[ "$output" != *"Probing cleanup targets"* ]]
  [[ "$output" == *"bun        Bun caches"* ]]
  [[ "$output" != *"pnpm       pnpm store and cache"* ]]
  [[ "$output" != *"docker     Docker unused images and build cache"* ]]
}

@test "json dry-run emits machine-readable target data" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --json --bun

  [ "$status" -eq 0 ]
  [[ "$output" != *"Probing cleanup targets"* ]]
  [[ "$output" == *'"mode":"dry-run"'* ]]
  [[ "$output" == *'"id":"bun"'* ]]
  [[ "$output" == *'"command":"bun pm cache rm (fallback: rm -rf Bun cache roots)"'* ]]
}

@test "tty dry-run shows probe progress before the final plan" {
  run_in_tty "env HOME='$HOME' PATH='$PATH' TEST_LOG='$TEST_LOG' CLEANUP_TMPDIR_ROOT='$CLEANUP_TMPDIR_ROOT' zsh --no-rcs '$CLEANUP' --dry-run --bun --pnpm"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Probing cleanup targets 1/2: Bun caches"* ]]
  [[ "$output" == *"Probing cleanup targets 2/2: pnpm store and cache"* ]]
  [[ "$output" == *"Cleanup plan (dry-run):"* ]]
}

@test "bun fallback removes both cache roots when bun cache command fails" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" BUN_PM_CACHE_FAIL=1 zsh --no-rcs "$CLEANUP" --yes --bun

  [ "$status" -eq 0 ]
  grep -F "bun pm cache rm" "$TEST_LOG"
  [ ! -e "$HOME/.bun/install/cache" ]
  [ ! -e "$HOME/.cache/.bun/install/cache" ]
}

@test "temp cleanup only removes stale user-owned entries older than seven days" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --temp

  [ "$status" -eq 0 ]
  [ ! -e "$CLEANUP_TMPDIR_ROOT/old-dir" ]
  [ -e "$CLEANUP_TMPDIR_ROOT/new-dir" ]
}

@test "ui mode errors cleanly when fzf is unavailable" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" PATH="$TEST_BIN" "$(command -v zsh)" --no-rcs "$CLEANUP" ui

  [ "$status" -eq 1 ]
  [[ "$output" == *"fzf required"* ]]
}

@test "--volumes requires docker cleanup to be selected" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --volumes --bun

  [ "$status" -eq 1 ]
  [[ "$output" == *"error: --volumes requires Docker cleanup"* ]]
}
