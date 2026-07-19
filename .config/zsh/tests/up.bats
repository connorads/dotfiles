#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

UP="$FUNCTIONS_DIR/nix/up"

setup() {
  # Darwin-gate for determinism: the dispatch we assert is the macOS branch
  # (mise + brew + flake + drs). Linux paths (apt/nrs/hms) differ.
  [[ "$OSTYPE" == darwin* ]] || skip "macOS only (asserts the darwin up branch)"
  local jq_dir
  jq_dir="$(dirname "$(command -v jq)")" # capture before PATH is isolated
  setup_test_home
  export PATH="$PATH:$jq_dir"

  mkdir -p "$TEST_HOME/.config/mise" "$TEST_HOME/.config/nix"
  : >"$TEST_HOME/.config/mise/mise.lock" # committed lock exists, empty

  # lockfile-audit runs for real (via the shebang) against stubbed
  # osv-scanner/dotfiles, so `up` tests exercise the actual audit wiring.
  ln -s "$FUNCTIONS_DIR/nix/lockfile-audit" "$TEST_BIN/lockfile-audit"
  mkdir -p "$TEST_HOME/project"
  : >"$TEST_HOME/project/pnpm-lock.yaml"

  # osv-scanner: log; OSV_STUB_MODE picks the scenario (clean|mal|cve|offline).
  write_stub osv-scanner <<'EOF'
#!/usr/bin/env bash
echo "osv-scanner $*" >>"$TEST_LOG"
case "${OSV_STUB_MODE:-clean}" in
  clean) echo '{"results":[]}'; exit 0 ;;
  mal)
    echo '{"results":[{"source":{"path":"/x/pnpm-lock.yaml"},"packages":[{"package":{"name":"evil","version":"1.0.0","ecosystem":"npm"},"vulnerabilities":[{"id":"MAL-2026-0001","summary":"malware"}]}]}]}'
    exit 1 ;;
  cve)
    echo '{"results":[{"source":{"path":"/x/pnpm-lock.yaml"},"packages":[{"package":{"name":"esbuild","version":"0.17.0","ecosystem":"npm"},"vulnerabilities":[{"id":"GHSA-xxxx-yyyy-zzzz","aliases":["CVE-2024-0001"],"summary":"vuln"}]}]}]}'
    exit 1 ;;
  offline) echo "connection failed" >&2; exit 127 ;;
esac
EOF

  for cmd in brew drs macup-check tmux-upstream pin-audit \
    claude-channels-patch claude-channels-allowlist-patch \
    claude-computer-use-patch claude-session-reaper-patch \
    claude-telegram-clear-patch; do
    write_stub "$cmd" <<EOF
#!/usr/bin/env bash
echo "$cmd \$*" >>"$TEST_LOG"
exit 0
EOF
  done

  # mise: log; on \`upgrade\`, simulate a tool bump (lockfile change) when
  # MISE_SIMULATE_BUMP is set, so the \`mise lock -g\` refresh gate is exercised.
  write_stub mise <<'EOF'
#!/usr/bin/env bash
echo "mise $*" >>"$TEST_LOG"
if [ "$1" = "upgrade" ] && [ -n "${MISE_SIMULATE_BUMP:-}" ]; then
  echo "bumped" >>"$HOME/.config/mise/mise.lock"
fi
exit 0
EOF

  # nfu: log; write flake.lock so the flake commit branch is exercised.
  write_stub nfu <<'EOF'
#!/usr/bin/env bash
echo "nfu $*" >>"$TEST_LOG"
echo "updated" >>"$HOME/.config/nix/flake.lock"
exit 0
EOF

  # dotfiles: log; `ls-files` feeds lockfile-audit one tracked lockfile;
  # `diff --cached --quiet -- PATH` reports changes (exit 1)
  # only when PATH is a non-empty file, mirroring git so the commit branch
  # fires exactly when that lockfile actually changed.
  write_stub dotfiles <<'EOF'
#!/usr/bin/env bash
echo "dotfiles $*" >>"$TEST_LOG"
if [ "$1" = "ls-files" ]; then
  echo "project/pnpm-lock.yaml"
  exit 0
fi
if [[ "$*" == *"diff --cached --quiet"* ]]; then
  for a in "$@"; do f="$a"; done # last arg = path
  [ -s "$f" ] && exit 1 || exit 0
fi
exit 0
EOF
}

@test "up bumps both lockfiles: commit each, brew, flake; no separate mise lock" {
  MISE_SIMULATE_BUMP=1 run_zsh_function "$UP"
  [ "$status" -eq 0 ]
  grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'mise lock' "$TEST_LOG"    # upgrade auto-locks all platforms; no refresh call
  ! grep -qF 'mise install' "$TEST_LOG" # default path bumps, never frozen-installs
  grep -qF 'dotfiles commit -m chore(mise): update tool lock' "$TEST_LOG"
  grep -qF 'dotfiles commit -m chore(nix): update flake lock' "$TEST_LOG"
  grep -qF 'brew update' "$TEST_LOG"
  grep -qF 'brew upgrade --no-ask' "$TEST_LOG"
  grep -qF 'nfu' "$TEST_LOG"
  grep -qF 'claude-session-reaper-patch --reapply' "$TEST_LOG"
}

@test "up skips the mise commit when the upgrade changed nothing" {
  run_zsh_function "$UP" # no MISE_SIMULATE_BUMP -> lock unchanged
  [ "$status" -eq 0 ]
  grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'update tool lock' "$TEST_LOG"
  # the flake half still runs independently of the mise no-op
  grep -qF 'dotfiles commit -m chore(nix): update flake lock' "$TEST_LOG"
  grep -qF 'brew update' "$TEST_LOG"
  grep -qF 'brew upgrade --no-ask' "$TEST_LOG"
}

@test "up --frozen converges via mise install with no bumps, brew, flake, or commit" {
  run_zsh_function "$UP" --frozen
  [ "$status" -eq 0 ]
  grep -qF 'mise install' "$TEST_LOG"
  grep -qF 'claude-session-reaper-patch --reapply' "$TEST_LOG"
  ! grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'mise lock' "$TEST_LOG"
  ! grep -qF 'brew' "$TEST_LOG"
  ! grep -qF 'nfu' "$TEST_LOG"
  ! grep -qF 'dotfiles commit' "$TEST_LOG"
  # rebuild still proceeds
  grep -qF 'drs' "$TEST_LOG"
}

@test "up -s is an alias for --frozen" {
  run_zsh_function "$UP" -s
  [ "$status" -eq 0 ]
  grep -qF 'mise install' "$TEST_LOG"
  ! grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'nfu' "$TEST_LOG"
}

@test "up --skip-flake is an alias for --frozen" {
  run_zsh_function "$UP" --skip-flake
  [ "$status" -eq 0 ]
  grep -qF 'mise install' "$TEST_LOG"
  ! grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'nfu' "$TEST_LOG"
}

@test "up runs the lockfile audit before bumping" {
  run_zsh_function "$UP"
  [ "$status" -eq 0 ]
  grep -qF 'osv-scanner scan source' "$TEST_LOG"
  # the audit line precedes the first mutation (mise upgrade)
  audit_line=$(grep -nF 'osv-scanner scan source' "$TEST_LOG" | head -1 | cut -d: -f1)
  upgrade_line=$(grep -nF 'mise upgrade' "$TEST_LOG" | head -1 | cut -d: -f1)
  [ "$audit_line" -lt "$upgrade_line" ]
}

@test "up --frozen skips the lockfile audit" {
  run_zsh_function "$UP" --frozen
  [ "$status" -eq 0 ]
  ! grep -qF 'osv-scanner' "$TEST_LOG"
}

@test "up --no-audit skips the audit but still bumps" {
  run_zsh_function "$UP" --no-audit
  [ "$status" -eq 0 ]
  ! grep -qF 'osv-scanner' "$TEST_LOG"
  grep -qF 'mise upgrade' "$TEST_LOG"
}

@test "up aborts before any mutation on a MAL-* finding" {
  OSV_STUB_MODE=mal run_zsh_function "$UP"
  [ "$status" -ne 0 ]
  grep -qF 'osv-scanner scan source' "$TEST_LOG"
  ! grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'dotfiles commit' "$TEST_LOG"
  ! grep -qF 'brew' "$TEST_LOG"
}

@test "up runs the report-only pin-audit on the bump path" {
  run_zsh_function "$UP"
  [ "$status" -eq 0 ]
  grep -qF 'pin-audit' "$TEST_LOG"
}

@test "up --frozen skips pin-audit" {
  run_zsh_function "$UP" --frozen
  [ "$status" -eq 0 ]
  ! grep -qF 'pin-audit' "$TEST_LOG"
}

@test "up proceeds when the scanner is offline (warn-not-block)" {
  OSV_STUB_MODE=offline run_zsh_function "$UP"
  [ "$status" -eq 0 ]
  grep -qF 'mise upgrade' "$TEST_LOG"
  grep -qF 'dotfiles commit -m chore(nix): update flake lock' "$TEST_LOG"
}
