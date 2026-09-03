#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

source "$BATS_TEST_DIRNAME/test_helper.bash"

CLEANUP="$FUNCTIONS_DIR/cleanup"

# Sparseness is a filesystem property, not something the fixture can assert into
# being, so confirm the file really is sparse before testing the probe that keys
# on it. BSD `stat -f` only: GNU stat reads -f as "filesystem" and echoes the
# format verbatim, which reads as non-numeric here.
require_sparse() {
  local apparent blocks
  apparent=$(stat -f '%z' "$1" 2>/dev/null) || true
  blocks=$(stat -f '%b' "$1" 2>/dev/null) || true
  case "${apparent}:${blocks}" in
  *[!0-9:]* | :* | *:) skip "BSD stat unavailable; cannot detect sparse files" ;;
  esac
  [ "$((blocks * 512))" -lt "$apparent" ] || skip "filesystem does not create sparse files"
}

setup() {
  setup_test_home
  export CLEANUP_TMPDIR_ROOT="$HOME/tmp-root"
  export CLEANUP_CLAUDE_TMP_ROOT="$HOME/claude-tmp"
  export CLEANUP_CLAUDE_PROFILES_ROOT="$HOME/claude-profiles"
  export AGENT_HIBERNATE_DIR="$HOME/agent-hibernate"
  export CLEANUP_WORKTREE_ROOT="$HOME/trees"
  mkdir -p \
    "$HOME/.bun/install/cache/pkg" \
    "$HOME/.cache/.bun/install/cache/pkg" \
    "$HOME/.local/share/pnpm/store/v10/pkg" \
    "$HOME/Library/Caches/pnpm/pkg" \
    "$HOME/.cache/pnpm/pkg" \
    "$HOME/.npm/cache" \
    "$HOME/.cache/pip/http-v2" \
    "$HOME/.cache/uv/archive" \
    "$HOME/.cargo/registry/cache" \
    "$HOME/.local/share/aube/store/cas" \
    "$HOME/.cache/aube/virtual-store/pkg" \
    "$HOME/.cache/aube/packuments-full-v1" \
    "$HOME/.cache/aube/primer" \
    "$HOME/.local/share/yarn/berry/cache" \
    "$HOME/.cache/yarn/pkg" \
    "$HOME/.cache/node-gyp/22" \
    "$HOME/Library/Caches/node-gyp/24" \
    "$HOME/.rustup/toolchains/override-named-unmarked/bin" \
    "$HOME/.rustup/toolchains/remove-unmarked/bin" \
    "$HOME/git/realcrate/target/debug" \
    "$HOME/git/no-manifest/target" \
    "$HOME/git/data-dir/target" \
    "$HOME/.cache/nvim/state" \
    "$HOME/.cache/ms-playwright/browser" \
    "$HOME/.cache/puppeteer/browser" \
    "$HOME/.cache/camoufox/browser" \
    "$CLEANUP_TMPDIR_ROOT/old-dir" \
    "$CLEANUP_TMPDIR_ROOT/new-dir"

  touch "$HOME/.bun/install/cache/pkg/data"
  touch "$HOME/.cache/.bun/install/cache/pkg/data"
  touch "$HOME/.local/share/pnpm/store/v10/pkg/data"
  touch "$HOME/Library/Caches/pnpm/pkg/data"
  touch "$HOME/.cache/pnpm/pkg/data"
  touch "$HOME/.npm/cache/data"
  touch "$HOME/.cache/pip/http-v2/data"
  touch "$HOME/.cache/uv/archive/data"
  touch "$HOME/.cargo/registry/cache/data"
  touch "$HOME/.local/share/aube/store/cas/data"
  touch "$HOME/.cache/aube/virtual-store/pkg/data"
  touch "$HOME/.cache/aube/packuments-full-v1/data"
  # A mise npm-backend tool bin symlinked into virtual-store (real topology):
  # the aube target must not dangle it. See _cleanup_run_target aube case.
  mkdir -p "$HOME/.cache/aube/virtual-store/foo@1.0.0/node_modules/foo/bin" \
    "$HOME/.local/share/mise/installs/npm-foo/1.0.0/bin"
  touch "$HOME/.cache/aube/virtual-store/foo@1.0.0/node_modules/foo/bin/foo"
  ln -s "$HOME/.cache/aube/virtual-store/foo@1.0.0/node_modules/foo/bin/foo" \
    "$HOME/.local/share/mise/installs/npm-foo/1.0.0/bin/foo"
  # aube re-provisions tool installs on next use, so the cache is disposable;
  # virtual-store next to it is not. See _cleanup_run_target aube case.
  mkdir -p "$HOME/.cache/aube/tools/node-gyp/v12/node_modules/.aube"
  touch "$HOME/.cache/aube/tools/node-gyp/v12/package.json"
  touch "$HOME/.cache/aube/primer/data"
  touch "$HOME/.cache/aube/adaptive-state.json"
  touch "$HOME/.local/share/yarn/berry/cache/data"
  touch "$HOME/.cache/yarn/pkg/data"
  touch "$HOME/.cache/node-gyp/22/data"
  touch "$HOME/Library/Caches/node-gyp/24/data"
  touch "$HOME/.rustup/toolchains/override-named-unmarked/bin/rustc"
  touch "$HOME/.rustup/toolchains/remove-unmarked/bin/rustc"
  # Cargo build dirs are identified by CACHEDIR.TAG *and* a sibling Cargo.toml.
  # The two decoys hold one marker each, so either check alone would destroy one
  # of them: `no-manifest` is an orphaned tag, `data-dir/target` is user data in
  # a crate that has simply never been built.
  printf '[package]\nname = "realcrate"\n' >"$HOME/git/realcrate/Cargo.toml"
  printf 'Signature: 8a477f597d28d172789f06886806bc55\n' >"$HOME/git/realcrate/target/CACHEDIR.TAG"
  touch "$HOME/git/realcrate/target/debug/data"
  printf 'Signature: 8a477f597d28d172789f06886806bc55\n' >"$HOME/git/no-manifest/target/CACHEDIR.TAG"
  printf '[package]\nname = "data-dir"\n' >"$HOME/git/data-dir/Cargo.toml"
  touch "$HOME/git/data-dir/target/notes.txt"
  touch "$HOME/.cache/nvim/state/data"
  touch "$HOME/.cache/ms-playwright/browser/data"
  touch "$HOME/.cache/puppeteer/browser/data"
  touch "$HOME/.cache/camoufox/browser/data"
  touch "$CLEANUP_TMPDIR_ROOT/old-dir/data"
  touch "$CLEANUP_TMPDIR_ROOT/new-dir/data"
  # A fixed past timestamp, not a relative date: `touch -d` is GNU-only, while
  # `-t [[CC]YY]MMDDhhmm` is POSIX. The reaper's threshold is `-mtime +7`, so
  # any long-past date serves; the test only needs "older than the threshold".
  touch -t 202001010000 "$CLEANUP_TMPDIR_ROOT/old-dir"
  touch -t 202001010000 "$CLEANUP_TMPDIR_ROOT/old-dir/data"

  write_stub cargo <<'EOF'
#!/usr/bin/env bash
echo "cargo $*" >>"$TEST_LOG"
[ -n "${CARGO_CLEAN_FAIL:-}" ] && exit 1
# Real `cargo clean` empties the dir it owns; mimic that so the fallback in
# _cleanup_run_target is only exercised when the stub is made to fail.
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--manifest-path" ]; then
    rm -rf "$(dirname "$2")/target"
    break
  fi
  shift
done
exit 0
EOF

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

  # Stable by default so successful cleanup tests do not depend on concurrent
  # writes to the host volume. Individual accounting tests replace this stub.
  write_stub df <<'EOF'
#!/usr/bin/env bash
echo "df $*" >>"$TEST_LOG"
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/test 1000000 900000 100000 90%% /\n'
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

  write_stub aube <<'EOF'
#!/usr/bin/env bash
echo "aube $*" >>"$TEST_LOG"
exit 0
EOF

  # Synthetic, role-describing names (not real versions) so the fixture is
  # self-documenting. Covers all three keep-markers plus the anchoring edge
  # case: "override-named-unmarked" is named with a marker word but has no
  # "(...)" marker, so it must still be removed.
  write_stub rustup <<'EOF'
#!/usr/bin/env bash
echo "rustup $*" >>"$TEST_LOG"
if [ "${1:-}" = "toolchain" ] && [ "${2:-}" = "list" ]; then
  printf 'keep-marked-default (default)\n'
  printf 'keep-marked-active (active)\n'
  printf 'keep-marked-override (overridden by environment variable RUSTUP_TOOLCHAIN)\n'
  printf 'override-named-unmarked\n'
  printf 'remove-unmarked\n'
  exit 0
fi
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

  # Reproduces brew's real dry-run wording; the probe parses this sentence, and
  # the `brew probe` test below pins it so an upstream rewording fails loudly
  # rather than silently zeroing the estimate.
  write_stub brew <<'EOF'
#!/usr/bin/env bash
echo "brew $*" >>"$TEST_LOG"
if [ "${1:-}" = "cleanup" ] && [ "${*: -1}" = "-n" ]; then
  printf 'Would remove: %s/Library/Caches/Homebrew/downloads/abc--kitty.dmg (48.7MB)\n' "$HOME"
  printf '==> This operation would free approximately 7.3GB of disk space.\n'
  exit 0
fi
exit 0
EOF

  # Real mise would prune the tester's own tool versions and cache, so stub it
  # unconditionally rather than only where a test asserts on it.
  write_stub mise <<'EOF'
#!/usr/bin/env bash
echo "mise $*" >>"$TEST_LOG"
if [ "${1:-}" = "prune" ] && [ "${2:-}" = "--dry-run" ]; then
  printf '   remove %s/.local/share/mise/installs/dummy/1.0.0\n' "$HOME"
  exit 0
fi
if [ "${1:-}" = "cache" ] && [ "${2:-}" = "clear" ]; then
  [ -n "${MISE_CACHE_CLEAR_FAIL:-}" ] && exit 1
  exit 0
fi
exit 0
EOF

  # Chrome absent by default: the real pgrep would make the chrome target's
  # applicability depend on whether the tester happens to be browsing.
  write_stub pgrep <<'EOF'
#!/usr/bin/env bash
echo "pgrep $*" >>"$TEST_LOG"
exit 1
EOF

  write_stub claude <<'EOF'
#!/usr/bin/env bash
echo "claude ${CLAUDE_CONFIG_DIR:-} $*" >>"$TEST_LOG"
if [ "${1:-}" = "agents" ] && [ "${2:-}" = "--json" ]; then
  state="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agents.json"
  if [ -n "${CLAUDE_AGENTS_FAIL_CONFIG:-}" ] && [ "${CLAUDE_CONFIG_DIR:-}" = "$CLAUDE_AGENTS_FAIL_CONFIG" ]; then
    exit 1
  fi
  if [ -f "$state" ]; then
    cat "$state"
  else
    printf '[]\n'
  fi
  exit 0
fi
exit 1
EOF

  write_stub nix-collect-garbage <<'EOF'
#!/usr/bin/env bash
echo "nix-collect-garbage $*" >>"$TEST_LOG"
exit 0
EOF

  write_stub nix-store <<'EOF'
#!/usr/bin/env bash
echo "nix-store $*" >>"$TEST_LOG"
if [ "${1:-}" = "--gc" ] && [ "${2:-}" = "--print-dead" ]; then
  printf '/nix/store/aaa\n/nix/store/bbb\n'
  exit 0
fi
if [ "${1:-}" = "-q" ] && [ "${2:-}" = "--size" ]; then
  shift 2
  # 1 MiB per dead path → two dead paths estimate to 2.0M
  for _ in "$@"; do echo 1048576; done
  exit 0
fi
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
  grep -F "aube cache prune --age-days 0" "$TEST_LOG"
  grep -Fx "brew cleanup --prune=all" "$TEST_LOG"
  [ ! -e "$HOME/.local/share/yarn/berry/cache" ]
  [ ! -e "$HOME/.cache/yarn" ]
  [ ! -e "$HOME/.cache/node-gyp" ]
  # rustup is opt-in: must NOT auto-uninstall toolchains in the default set.
  [[ "$(cat "$TEST_LOG")" != *"rustup toolchain uninstall"* ]]
  [ ! -e "$CLEANUP_TMPDIR_ROOT/old-dir" ]
  [ -e "$CLEANUP_TMPDIR_ROOT/new-dir" ]
}

@test "pnpm estimate counts cache roots but not the selectively-pruned store" {
  dd if=/dev/zero of="$HOME/.local/share/pnpm/store/v10/pkg/data" bs=1024 count=8192 2>/dev/null
  dd if=/dev/zero of="$HOME/Library/Caches/pnpm/pkg/data" bs=1024 count=1024 2>/dev/null
  dd if=/dev/zero of="$HOME/.cache/pnpm/pkg/data" bs=1024 count=1024 2>/dev/null
  local cache_kb
  cache_kb=$(du -sk "$HOME/Library/Caches/pnpm" "$HOME/.cache/pnpm" | awk '{ total += $1 } END { print total }')

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --json --pnpm

  [ "$status" -eq 0 ]
  [[ "$output" == *'"estimate_kind":"partial"'* ]]
  [[ "$output" == *"\"size_kb\":$cache_kb"* ]]
  [[ "$output" == *'"has_unknown_estimates":true'* ]]
  [[ "$output" == *'pnpm store prune has unknown additional reclaim'* ]]
}

@test "human plan labels candidates and warns that physical reclaim may be lower" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --pnpm

  [ "$status" -eq 0 ]
  [[ "$output" == *"known candidate total:"* ]]
  [[ "$output" == *"excludes selective cleanup with unknown size"* ]]
  [[ "$output" == *"logical/tool estimates; physical reclaim may be lower"* ]]
  [[ "$output" != *"total estimate:"* ]]
}

@test "pnpm cleanup prunes the store and removes macOS and XDG cache roots" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --pnpm

  [ "$status" -eq 0 ]
  grep -Fx "pnpm store prune" "$TEST_LOG"
  [ ! -e "$HOME/Library/Caches/pnpm" ]
  [ ! -e "$HOME/.cache/pnpm" ]
  [ -e "$HOME/.local/share/pnpm/store/v10/pkg/data" ]
  [[ "$output" == *"Observed volume free-space change: +0K"* ]]
}

@test "pnpm store prune still runs when its known cache candidate is empty" {
  rm -rf "$HOME/Library/Caches/pnpm" "$HOME/.cache/pnpm"

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --pnpm

  [ "$status" -eq 0 ]
  grep -Fx "pnpm store prune" "$TEST_LOG"
}

@test "aube cleanup flushes caches but preserves the durable store" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --aube

  [ "$status" -eq 0 ]
  grep -F "aube cache prune --age-days 0" "$TEST_LOG"
  [ ! -e "$HOME/.cache/aube/packuments-full-v1" ]
  [ ! -e "$HOME/.cache/aube/tools" ]
  # virtual-store is preserved: it holds live working set for mise npm tools,
  # and a `rm -rf` here would dangle every `npm:*` tool bin symlinked into it.
  [ -e "$HOME/.cache/aube/virtual-store/pkg/data" ]
  [ -e "$HOME/.local/share/mise/installs/npm-foo/1.0.0/bin/foo" ] # symlink still resolves
  [ -e "$HOME/.local/share/aube/store/cas/data" ]
  [ -e "$HOME/.cache/aube/primer/data" ]
  [ -e "$HOME/.cache/aube/adaptive-state.json" ]
}

@test "yarn cleanup removes caches without invoking yarn" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --yarn

  [ "$status" -eq 0 ]
  [ ! -e "$HOME/.local/share/yarn/berry/cache" ]
  [ ! -e "$HOME/.cache/yarn" ]
  [[ "$(cat "$TEST_LOG")" != *"yarn "* ]]
}

@test "node-gyp cleanup removes its cache directory on both platforms" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --node-gyp

  [ "$status" -eq 0 ]
  # env-paths puts the cache under ~/Library/Caches on macOS and ~/.cache on
  # Linux, so the target must claim both regardless of the host it runs on.
  [ ! -e "$HOME/Library/Caches/node-gyp" ]
  [ ! -e "$HOME/.cache/node-gyp" ]
}

@test "rustup cleanup uninstalls only unmarked toolchains" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --rustup

  [ "$status" -eq 0 ]
  # Unmarked toolchains are removed — including one literally named with a
  # marker word, proving the keep-filter keys on the "(" marker, not the word
  # (and that "overridden" is correctly kept, not mistaken for unmarked).
  grep -F "toolchain uninstall remove-unmarked" "$TEST_LOG"
  grep -F "toolchain uninstall override-named-unmarked" "$TEST_LOG"
  # default / active / overridden are kept.
  [[ "$(cat "$TEST_LOG")" != *"uninstall keep-marked-default"* ]]
  [[ "$(cat "$TEST_LOG")" != *"uninstall keep-marked-active"* ]]
  [[ "$(cat "$TEST_LOG")" != *"uninstall keep-marked-override"* ]]
}

@test "rustup cleanup skips when no removable toolchains exist" {
  write_stub rustup <<'EOF'
#!/usr/bin/env bash
echo "rustup $*" >>"$TEST_LOG"
if [ "${1:-}" = "toolchain" ] && [ "${2:-}" = "list" ]; then
  printf 'keep-marked-default (default)\n'
  printf 'keep-marked-active (active)\n'
  exit 0
fi
exit 0
EOF

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --rustup

  [ "$status" -eq 0 ]
  [[ "$output" == *"skip: not available on this host"* ]]

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --rustup
  [ "$status" -eq 0 ]
  [[ "$(cat "$TEST_LOG")" != *"toolchain uninstall"* ]]
}

@test "cargo-target cleanup reclaims build dirs via cargo and spares lookalikes" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" CLEANUP_CARGO_ROOTS="$HOME/git" \
    zsh --no-rcs "$CLEANUP" --yes --cargo-target

  [ "$status" -eq 0 ]
  grep -F -- "clean --manifest-path $HOME/git/realcrate/Cargo.toml" "$TEST_LOG"
  [ ! -d "$HOME/git/realcrate/target" ]
  # Neither decoy is a build dir, so neither is touched or even passed to cargo.
  [ -f "$HOME/git/no-manifest/target/CACHEDIR.TAG" ]
  [ -f "$HOME/git/data-dir/target/notes.txt" ]
  [[ "$(cat "$TEST_LOG")" != *"no-manifest"* ]]
  [[ "$(cat "$TEST_LOG")" != *"data-dir"* ]]
}

@test "cargo-target falls back to removing the tree when cargo clean fails" {
  # A crate whose manifest no longer parses must not strand its build dir.
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" CLEANUP_CARGO_ROOTS="$HOME/git" \
    CARGO_CLEAN_FAIL=1 zsh --no-rcs "$CLEANUP" --yes --cargo-target

  [ "$status" -eq 0 ]
  [ ! -d "$HOME/git/realcrate/target" ]
  [ -f "$HOME/git/data-dir/target/notes.txt" ]
}

@test "cargo-target is opt-in and absent from the default run" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" CLEANUP_CARGO_ROOTS="$HOME/git" \
    zsh --no-rcs "$CLEANUP" --dry-run

  [ "$status" -eq 0 ]
  [[ "$output" != *"cargo-target"* ]]
  # The plain `cargo` registry-cache target is still in the default set.
  [[ "$output" == *"Cargo registry cache"* ]]
  [ -d "$HOME/git/realcrate/target" ]
}

@test "nix estimate reflects dead store paths, not the whole /nix/store" {
  # Regression: the probe used to `du -sk /nix/store`, reporting the ENTIRE
  # store as reclaimable when GC only removes paths unreachable from a live
  # root. The estimate must come from the dead-path set instead — here two
  # 1 MiB dead paths → 2.0M, regardless of the host's real /nix/store size.
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --nix

  [ "$status" -eq 0 ]
  grep -F -- "nix-store --gc --print-dead" "$TEST_LOG"
  [[ "$output" == *"2.0M"* ]]
  [[ "$output" == *"nix"* ]]
}

@test "brew probe parses homebrew's own dry-run estimate" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --brew

  [ "$status" -eq 0 ]
  grep -F -- "brew cleanup --prune=all -n" "$TEST_LOG"
  [[ "$output" == *"7.3G"* ]]
  [[ "$output" == *"Homebrew download cache"* ]]
}

@test "brew cleanup prunes all cached downloads" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --brew

  [ "$status" -eq 0 ]
  # Exact line: the probe logs the `-n` variant too, so only a whole-line match
  # proves the cleanup itself ran.
  grep -Fx -- "brew cleanup --prune=all" "$TEST_LOG"
  # autoremove uninstalls dependencies (a tooling state change) and fights the
  # nix-darwin `cleanup = "zap"` model, so this target must never invoke it.
  [[ "$(cat "$TEST_LOG")" != *"autoremove"* ]]
}

@test "brew skips when nothing is cached" {
  write_stub brew <<'EOF'
#!/usr/bin/env bash
echo "brew $*" >>"$TEST_LOG"
exit 0
EOF

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --brew

  [ "$status" -eq 0 ]
  [[ "$output" == *"skip: not available on this host"* ]]

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --brew
  [ "$status" -eq 0 ]
  ! grep -Fx -- "brew cleanup --prune=all" "$TEST_LOG"
}

# A registry with one live install pinning chromium 1234, one superseded
# revision, and a .links entry whose install has been deleted.
seed_playwright_registry() {
  local root=$1 install=$2
  mkdir -p "$root/.links" "$root/chromium-1234" "$root/chromium_headless_shell-1234" \
    "$root/.settings" "$install"
  touch "$root/chromium-1234/data" "$root/chromium_headless_shell-1234/data" \
    "$root/.settings/data"
  cat >"$install/browsers.json" <<'JSON'
{
  "browsers": [
    { "name": "chromium", "revision": "1234", "installByDefault": true },
    { "name": "chromium-headless-shell", "revision": "1234", "installByDefault": true }
  ]
}
JSON
  printf '%s\n' "$install" >"$root/.links/live"
}

@test "playwright prunes only revisions no live playwright-core references" {
  local root="$HOME/pw" install="$HOME/repo/node_modules/playwright-core"
  seed_playwright_registry "$root" "$install"
  mkdir -p "$root/chromium-1200"
  touch "$root/chromium-1200/data"
  printf '%s\n' "$HOME/repo/node_modules/deleted" >"$root/.links/stale"

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" PLAYWRIGHT_BROWSERS_PATH="$root" \
    zsh --no-rcs "$CLEANUP" --yes --playwright

  [ "$status" -eq 0 ]
  [ ! -e "$root/chromium-1200" ]
  # The install this link named is gone, so the link is leftover bookkeeping.
  [ ! -e "$root/.links/stale" ]
  [ -e "$root/chromium-1234/data" ]
  # browsers.json spells the name with hyphens; on disk it is underscores. Get
  # that mapping wrong and a live revision is deleted for a re-download.
  [ -e "$root/chromium_headless_shell-1234/data" ]
  # Registry furniture is not a revision dir.
  [ -e "$root/.settings/data" ]
  [ -e "$root/.links/live" ]
}

@test "playwright reports 0K when every revision on disk is referenced" {
  local root="$HOME/pw" install="$HOME/repo/node_modules/playwright-core"
  seed_playwright_registry "$root" "$install"

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" PLAYWRIGHT_BROWSERS_PATH="$root" \
    zsh --no-rcs "$CLEANUP" --dry-run --json --playwright

  [ "$status" -eq 0 ]
  [[ "$output" == *'"id":"playwright"'* ]]
  [[ "$output" == *'"applicable":true'* ]]
  # Several revisions side by side is the normal state, not stale build-up.
  [[ "$output" == *'"size_kb":0'* ]]
}

@test "browsers no longer claims the shared playwright registry" {
  # The target probes itself out when its roots measure 0K, and an empty file
  # occupies no blocks, so give the fixture real bytes.
  dd if=/dev/zero of="$HOME/.cache/puppeteer/browser/data" bs=1024 count=32 2>/dev/null
  dd if=/dev/zero of="$HOME/.cache/camoufox/browser/data" bs=1024 count=32 2>/dev/null

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --browsers

  [ "$status" -eq 0 ]
  [ ! -e "$HOME/.cache/puppeteer" ]
  [ ! -e "$HOME/.cache/camoufox" ]
  # Wholesale deletion is the wrong contract for a registry shared between
  # installs; the playwright target prunes it selectively instead.
  [ -e "$HOME/.cache/ms-playwright/browser/data" ]
}

seed_chrome_cache() {
  mkdir -p "$HOME/Library/Caches/Google/Chrome/Default/Cache" \
    "$HOME/Library/Application Support/Google/Chrome/Default"
  dd if=/dev/zero of="$HOME/Library/Caches/Google/Chrome/Default/Cache/data" \
    bs=1024 count=32 2>/dev/null
  touch "$HOME/Library/Application Support/Google/Chrome/Default/Cookies"
}

@test "chrome clears the http cache and leaves the profile alone" {
  seed_chrome_cache

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --chrome

  [ "$status" -eq 0 ]
  [ ! -e "$HOME/Library/Caches/Google" ]
  # Profiles, cookies and history sit in Application Support, not Caches.
  [ -e "$HOME/Library/Application Support/Google/Chrome/Default/Cookies" ]
}

@test "chrome is not applicable while the browser is running" {
  seed_chrome_cache
  write_stub pgrep <<'EOF'
#!/usr/bin/env bash
echo "pgrep $*" >>"$TEST_LOG"
if [ "${2:-}" = "Google Chrome" ]; then
  echo 4242
  exit 0
fi
exit 1
EOF

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --chrome
  [ "$status" -eq 0 ]
  [[ "$output" == *"skip: not available on this host"* ]]

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --chrome
  [ "$status" -eq 0 ]
  [ -e "$HOME/Library/Caches/Google/Chrome/Default/Cache/data" ]
}

@test "mise-cache clears the cache root, distinct from mise prune" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --mise-cache

  [ "$status" -eq 0 ]
  grep -Fx "mise cache clear" "$TEST_LOG"
  [[ "$(cat "$TEST_LOG")" != *"mise prune"* ]]
}

@test "mise-cache falls back to path removal when mise cache clear fails" {
  mkdir -p "$HOME/Library/Caches/mise/downloads"
  touch "$HOME/Library/Caches/mise/downloads/node-24.tar.gz"

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" MISE_CACHE_CLEAR_FAIL=1 \
    zsh --no-rcs "$CLEANUP" --yes --mise-cache

  [ "$status" -eq 0 ]
  grep -Fx "mise cache clear" "$TEST_LOG"
  [ ! -e "$HOME/Library/Caches/mise" ]
}

@test "the mise target prunes tool versions and never the cache root" {
  mkdir -p "$HOME/Library/Caches/mise/downloads"
  touch "$HOME/Library/Caches/mise/downloads/node-24.tar.gz"

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --mise

  [ "$status" -eq 0 ]
  grep -Fx "mise prune --yes" "$TEST_LOG"
  # The split is the point: `mise prune` never reached the 3.5G cache root.
  [[ "$(cat "$TEST_LOG")" != *"cache clear"* ]]
  [ -e "$HOME/Library/Caches/mise/downloads/node-24.tar.gz" ]
}

@test "docker estimate is zeroed when the daemon sits on a sparse VM disk" {
  local disk="$HOME/vm/_disks/colima/datadisk"
  mkdir -p "${disk%/*}"
  # 100 MiB apparent, zero blocks written: the shape of a colima datadisk.
  dd if=/dev/zero of="$disk" bs=1 count=0 seek=100m 2>/dev/null
  require_sparse "$disk"

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" \
    CLEANUP_VM_DISK_ROOTS="$HOME/vm/_disks/*/datadisk" \
    zsh --no-rcs "$CLEANUP" --dry-run --json --docker

  [ "$status" -eq 0 ]
  [[ "$output" == *'"id":"docker"'* ]]
  # docker system df still reports 2.5G reclaimable, but none of it is host
  # space: the prune frees blocks inside a file that only ever grows.
  [[ "$output" == *'"size_kb":0'* ]]
  [[ "$output" == *"host disk unchanged"* ]]
  [[ "$output" == *"frees 2.5G inside the VM only"* ]]
}

@test "docker sparse detection survives a GNU stat shadowing the BSD one" {
  # Regression: nix coreutils is ahead of /usr/bin on the login PATH, and GNU
  # stat reads -f as --file-system. A bare `stat` therefore found nothing
  # sparse in real use while passing under the tests' native-first PATH.
  local disk="$HOME/vm/_disks/colima/datadisk"
  mkdir -p "${disk%/*}"
  dd if=/dev/zero of="$disk" bs=1 count=0 seek=100m 2>/dev/null
  require_sparse "$disk"
  write_stub stat <<'EOF'
#!/usr/bin/env bash
echo "stat $*" >>"$TEST_LOG"
if [ "${1:-}" = "-f" ]; then
  echo "stat: cannot read file system information for '$2'" >&2
  exit 1
fi
exec /usr/bin/stat "$@"
EOF

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" \
    CLEANUP_VM_DISK_ROOTS="$HOME/vm/_disks/*/datadisk" \
    zsh --no-rcs "$CLEANUP" --dry-run --json --docker

  [ "$status" -eq 0 ]
  [[ "$output" == *'"size_kb":0'* ]]
  [[ "$output" == *"host disk unchanged"* ]]
}

@test "docker estimate is unchanged when the backing disk is fully allocated" {
  local disk="$HOME/vm/_disks/plain/datadisk"
  mkdir -p "${disk%/*}"
  dd if=/dev/zero of="$disk" bs=1024 count=64 2>/dev/null

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" \
    CLEANUP_VM_DISK_ROOTS="$HOME/vm/_disks/*/datadisk" \
    zsh --no-rcs "$CLEANUP" --dry-run --json --docker

  [ "$status" -eq 0 ]
  [[ "$output" == *'"size_kb":2621440'* ]]
  [[ "$output" != *"host disk unchanged"* ]]
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
  [[ "$output" == *'"estimate_kind":"logical-candidate"'* ]]
  [[ "$output" == *'"candidate_total_kb":'* ]]
  [[ "$output" == *'"candidate_total_human":'* ]]
  [[ "$output" == *'"has_unknown_estimates":false'* ]]
  [[ "$output" == *'"command":"bun pm cache rm (fallback: rm -rf Bun cache roots)"'* ]]
}

@test "completed cleanup reports the whole-volume available-space increase" {
  write_stub df <<'EOF'
#!/usr/bin/env bash
state="$TEST_LOG.df-count"
count=$(cat "$state" 2>/dev/null || echo 0)
count=$((count + 1))
printf '%s\n' "$count" >"$state"
available=100000
[ "$count" -gt 1 ] && available=110240
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/test 1000000 900000 %s 90%% /\n' "$available"
EOF

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --json --bun

  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":1'* ]]
  [[ "$output" == *'"volume_available_before_kb":100000'* ]]
  [[ "$output" == *'"volume_available_after_kb":110240'* ]]
  [[ "$output" == *'"volume_available_delta_kb":10240'* ]]
}

@test "completed cleanup reports zero and negative volume changes literally" {
  write_stub df <<'EOF'
#!/usr/bin/env bash
state="$TEST_LOG.df-count"
count=$(cat "$state" 2>/dev/null || echo 0)
count=$((count + 1))
printf '%s\n' "$count" >"$state"
available=100000
[ "$count" -gt 1 ] && available="${DF_AFTER_KB:-100000}"
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/test 1000000 900000 %s 90%% /\n' "$available"
EOF

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" DF_AFTER_KB=100000 \
    zsh --no-rcs "$CLEANUP" --yes --json --bun
  [ "$status" -eq 0 ]
  [[ "$output" == *'"volume_available_delta_kb":0'* ]]

  rm -f "$TEST_LOG.df-count"
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" DF_AFTER_KB=97952 \
    zsh --no-rcs "$CLEANUP" --yes --json --bun
  [ "$status" -eq 0 ]
  [[ "$output" == *'"volume_available_delta_kb":-2048'* ]]
}

@test "failed space measurement is non-fatal and emits null result fields" {
  write_stub df <<'EOF'
#!/usr/bin/env bash
printf 'not a df result\n'
EOF

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --json --bun

  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":1'* ]]
  [[ "$output" == *'"volume_available_before_kb":null'* ]]
  [[ "$output" == *'"volume_available_after_kb":null'* ]]
  [[ "$output" == *'"volume_available_delta_kb":null'* ]]
}

@test "target failure still measures the ending volume and reports failure" {
  write_stub df <<'EOF'
#!/usr/bin/env bash
state="$TEST_LOG.df-count"
count=$(cat "$state" 2>/dev/null || echo 0)
count=$((count + 1))
printf '%s\n' "$count" >"$state"
available=100000
[ "$count" -gt 1 ] && available=101024
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/test 1000000 900000 %s 90%% /\n' "$available"
EOF
  write_stub brew <<'EOF'
#!/usr/bin/env bash
echo "brew $*" >>"$TEST_LOG"
if [ "${*: -1}" = "-n" ]; then
  printf '==> This operation would free approximately 1MB of disk space.\n'
  exit 0
fi
exit 7
EOF

  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --yes --json --brew

  [ "$status" -eq 1 ]
  [[ "$output" == *'"ok":0'* ]]
  [[ "$output" == *'"volume_available_after_kb":101024'* ]]
  [[ "$output" == *'"volume_available_delta_kb":1024'* ]]
}

@test "dry-run never invokes the volume measurement" {
  run env CLEANUP_TMPDIR_ROOT="$CLEANUP_TMPDIR_ROOT" zsh --no-rcs "$CLEANUP" --dry-run --json --bun

  [ "$status" -eq 0 ]
  ! grep -F "df " "$TEST_LOG"
  [[ "$output" != *'volume_available_delta_kb'* ]]
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

setup_claude_temp_fixture() {
  local live_default="11111111-1111-4111-8111-111111111111"
  local live_profile="22222222-2222-4222-8222-222222222222"
  local hibernated="33333333-3333-4333-8333-333333333333"
  local inactive="44444444-4444-4444-8444-444444444444"
  local recent="55555555-5555-4555-8555-555555555555"

  mkdir -p \
    "$HOME/.claude" \
    "$CLEANUP_CLAUDE_PROFILES_ROOT/code/work" \
    "$AGENT_HIBERNATE_DIR" \
    "$CLEANUP_CLAUDE_TMP_ROOT/project/$live_default/scratchpad" \
    "$CLEANUP_CLAUDE_TMP_ROOT/project/$live_profile/scratchpad" \
    "$CLEANUP_CLAUDE_TMP_ROOT/project/$hibernated/scratchpad" \
    "$CLEANUP_CLAUDE_TMP_ROOT/project/$inactive/scratchpad" \
    "$CLEANUP_CLAUDE_TMP_ROOT/project/$recent/scratchpad" \
    "$CLEANUP_CLAUDE_TMP_ROOT/project/not-a-session/scratchpad"

  printf '[{"sessionId":"%s"}]\n' "$live_default" >"$HOME/.claude/agents.json"
  printf '[{"sessionId":"%s"}]\n' "$live_profile" >"$CLEANUP_CLAUDE_PROFILES_ROOT/code/work/agents.json"
  printf '{"sessionId":"%s","cwd":"%s"}\n' "$hibernated" "$HOME/project" \
    >"$AGENT_HIBERNATE_DIR/$hibernated.json"

  touch "$CLEANUP_CLAUDE_TMP_ROOT/project/$inactive/scratchpad/data"
  touch -t 202001010000 \
    "$CLEANUP_CLAUDE_TMP_ROOT/project/$live_default" \
    "$CLEANUP_CLAUDE_TMP_ROOT/project/$live_profile" \
    "$CLEANUP_CLAUDE_TMP_ROOT/project/$hibernated" \
    "$CLEANUP_CLAUDE_TMP_ROOT/project/$inactive"
}

@test "claude-temp removes only old inactive session scratch" {
  setup_claude_temp_fixture

  run env CLEANUP_CLAUDE_TMP_ROOT="$CLEANUP_CLAUDE_TMP_ROOT" \
    AGENT_HIBERNATE_DIR="$AGENT_HIBERNATE_DIR" \
    zsh --no-rcs "$CLEANUP" --yes --claude-temp

  [ "$status" -eq 0 ]
  [ ! -e "$CLEANUP_CLAUDE_TMP_ROOT/project/44444444-4444-4444-8444-444444444444" ]
  [ -d "$CLEANUP_CLAUDE_TMP_ROOT/project/11111111-1111-4111-8111-111111111111" ]
  [ -d "$CLEANUP_CLAUDE_TMP_ROOT/project/22222222-2222-4222-8222-222222222222" ]
  [ -d "$CLEANUP_CLAUDE_TMP_ROOT/project/33333333-3333-4333-8333-333333333333" ]
  [ -d "$CLEANUP_CLAUDE_TMP_ROOT/project/55555555-5555-4555-8555-555555555555" ]
  [ -d "$CLEANUP_CLAUDE_TMP_ROOT/project/not-a-session" ]
}

@test "claude-temp dry-run reports candidates without deleting them" {
  setup_claude_temp_fixture

  run env CLEANUP_CLAUDE_TMP_ROOT="$CLEANUP_CLAUDE_TMP_ROOT" \
    AGENT_HIBERNATE_DIR="$AGENT_HIBERNATE_DIR" \
    zsh --no-rcs "$CLEANUP" --dry-run --json --claude-temp

  [ "$status" -eq 0 ]
  grep -F '"id":"claude-temp"' <<<"$output"
  grep -F '1 inactive session dir(s)' <<<"$output"
  [ -d "$CLEANUP_CLAUDE_TMP_ROOT/project/44444444-4444-4444-8444-444444444444" ]
}

@test "claude-temp fails closed when hibernation state is malformed" {
  setup_claude_temp_fixture
  printf '{broken\n' >"$AGENT_HIBERNATE_DIR/broken.json"

  run env CLEANUP_CLAUDE_TMP_ROOT="$CLEANUP_CLAUDE_TMP_ROOT" \
    AGENT_HIBERNATE_DIR="$AGENT_HIBERNATE_DIR" \
    zsh --no-rcs "$CLEANUP" --yes --claude-temp

  [ "$status" -ne 0 ]
  grep -F 'cannot read hibernation record' <<<"$output"
  [ -d "$CLEANUP_CLAUDE_TMP_ROOT/project/44444444-4444-4444-8444-444444444444" ]
}

setup_worktree_build_fixture() {
  mkdir -p "$CLEANUP_WORKTREE_ROOT/active/node_modules/pkg" \
    "$CLEANUP_WORKTREE_ROOT/parked/.next/cache" \
    "$CLEANUP_WORKTREE_ROOT/inactive/apps/web/node_modules/pkg" \
    "$CLEANUP_WORKTREE_ROOT/inactive/coverage" "$AGENT_HIBERNATE_DIR"
  printf '[{"path":"%s"},{"path":"%s"},{"path":"%s"}]\n' \
    "$CLEANUP_WORKTREE_ROOT/active" "$CLEANUP_WORKTREE_ROOT/parked" \
    "$CLEANUP_WORKTREE_ROOT/inactive" >"$HOME/worktrees.json"
  printf '[{"cwd":"%s"}]\n' "$CLEANUP_WORKTREE_ROOT/active/apps/web" >"$HOME/agents.json"
  printf '{"sessionId":"33333333-3333-4333-8333-333333333333","cwd":"%s"}\n' \
    "$CLEANUP_WORKTREE_ROOT/parked" >"$AGENT_HIBERNATE_DIR/parked.json"

  write_stub wt-status <<'EOF'
#!/usr/bin/env bash
[ "$*" = "--all --json" ] || exit 1
cat "$HOME/worktrees.json"
EOF
  write_stub agent <<'EOF'
#!/usr/bin/env bash
[ "$*" = "ls --json" ] || exit 1
cat "$HOME/agents.json"
EOF
  write_stub git <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *tracked-output*) printf 'tracked-output/file\n' ;;
esac
EOF
}

@test "worktree-build removes exact artefacts only from unused managed worktrees" {
  setup_worktree_build_fixture
  mkdir -p "$CLEANUP_WORKTREE_ROOT/inactive/notes" "$CLEANUP_WORKTREE_ROOT/inactive/dist"

  run zsh --no-rcs "$CLEANUP" --yes --worktree-build

  [ "$status" -eq 0 ]
  [ ! -e "$CLEANUP_WORKTREE_ROOT/inactive/apps/web/node_modules" ]
  [ ! -e "$CLEANUP_WORKTREE_ROOT/inactive/coverage" ]
  [ -d "$CLEANUP_WORKTREE_ROOT/inactive/notes" ]
  [ -d "$CLEANUP_WORKTREE_ROOT/inactive/dist" ]
  [ -d "$CLEANUP_WORKTREE_ROOT/active/node_modules" ]
  [ -d "$CLEANUP_WORKTREE_ROOT/parked/.next" ]
}

@test "worktree-build preserves artefacts containing tracked files" {
  setup_worktree_build_fixture
  mkdir -p "$CLEANUP_WORKTREE_ROOT/inactive/tracked-output/node_modules"
  mv "$CLEANUP_WORKTREE_ROOT/inactive/apps/web/node_modules" \
    "$CLEANUP_WORKTREE_ROOT/inactive/tracked-output/node_modules"

  run zsh --no-rcs "$CLEANUP" --yes --worktree-build

  [ "$status" -eq 0 ]
  [ -d "$CLEANUP_WORKTREE_ROOT/inactive/tracked-output/node_modules" ]
}

@test "worktree-build fails closed when live agent state is unreadable" {
  setup_worktree_build_fixture
  printf '{broken\n' >"$HOME/agents.json"

  run zsh --no-rcs "$CLEANUP" --yes --worktree-build

  [ "$status" -ne 0 ]
  grep -F 'cannot read live agent state' <<<"$output"
  [ -d "$CLEANUP_WORKTREE_ROOT/inactive/apps/web/node_modules" ]
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
