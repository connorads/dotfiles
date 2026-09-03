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
  : >"$TEST_HOME/.config/nix/flake.lock" # committed lock exists, empty

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

  # drs: log; DRS_FAIL exits non-zero, the shape of a rebuild that can't build
  # the freshly bumped flake.lock.
  write_stub drs <<'EOF'
#!/usr/bin/env bash
echo "drs $*" >>"$TEST_LOG"
[ -n "${DRS_FAIL:-}" ] && exit 1
exit 0
EOF

  write_stub sudo <<'EOF'
#!/usr/bin/env bash
echo "sudo $*" >>"$TEST_LOG"
if [ -n "${UP_SUDO_KEEPALIVE:-}" ]; then
  echo "sudo-keepalive-parent=$PPID" >>"$TEST_LOG"
fi
[ -n "${SUDO_FAIL:-}" ] && exit 1
exit 0
EOF

  for cmd in brew macup-check tmux-upstream pin-audit \
    claude-channels-patch claude-channels-allowlist-patch \
    claude-computer-use-patch claude-session-reaper-patch \
    claude-telegram-clear-patch; do
    write_stub "$cmd" <<EOF
#!/usr/bin/env bash
echo "$cmd \$*" >>"$TEST_LOG"
[ "$cmd" = "tmux-upstream" ] && [ -n "\${TMUX_UPSTREAM_FAIL:-}" ] && exit 1
exit 0
EOF
  done

  # mise: log; on \`upgrade\`, simulate a tool bump (lockfile change) when
  # MISE_SIMULATE_BUMP is set, so the \`mise lock -g\` refresh gate is exercised.
  # MISE_FAIL_UPGRADE exits non-zero *after* mutating the lock — the real shape
  # of a partial failure (lock rewritten, one tool's install refused).
  write_stub mise <<'EOF'
#!/usr/bin/env bash
echo "mise $*" >>"$TEST_LOG"
[ -n "${MISE_DELAY:-}" ] && sleep "$MISE_DELAY"
if [ "$1" = "upgrade" ] && [ -n "${MISE_SIMULATE_BUMP:-}" ]; then
  echo "bumped" >>"$HOME/.config/mise/mise.lock"
fi
if [ "$1" = "upgrade" ] && [ -n "${MISE_FAIL_UPGRADE:-}" ]; then
  exit 1
fi
[ "$1" = "install" ] && [ -n "${MISE_FAIL_INSTALL:-}" ] && exit 1
exit 0
EOF

  # nfu: log; write flake.lock so the flake commit branch is exercised.
  write_stub nfu <<'EOF'
#!/usr/bin/env bash
echo "nfu $*" >>"$TEST_LOG"
echo "updated" >>"$HOME/.config/nix/flake.lock"
[ -n "${NFU_FAIL:-}" ] && exit 1
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
[ "$1" = "commit" ] && [ -n "${DOTFILES_FAIL_COMMIT:-}" ] && exit 1
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
  grep -qF "dotfiles commit -m chore(mise): update tool lock -- $TEST_HOME/.config/mise/mise.lock" "$TEST_LOG"
  grep -qF "dotfiles commit -m chore(nix): update flake lock -- $TEST_HOME/.config/nix/flake.lock" "$TEST_LOG"
  grep -qF 'brew update' "$TEST_LOG"
  grep -qF 'brew upgrade --no-ask' "$TEST_LOG"
  grep -qF 'nfu' "$TEST_LOG"
  grep -qF 'claude-session-reaper-patch --reapply' "$TEST_LOG"
  [[ "$output" == *"=> up summary (update)"* ]] || false
  [[ "$output" == *"=> done"* ]]
}

@test "up puts the gh wrapper ahead of a stale mise shim for Homebrew" {
  mkdir -p "$HOME/.local/bin" "$HOME/.local/share/mise/shims"
  write_executable "$HOME/.local/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "wrapper gh"
EOF
  write_executable "$HOME/.local/share/mise/shims/gh" <<'EOF'
#!/usr/bin/env bash
echo "stale mise gh"
EOF
  export PATH="$HOME/.local/share/mise/shims:$PATH"
  write_stub brew <<'EOF'
#!/usr/bin/env bash
echo "brew $*" >>"$TEST_LOG"
command -v gh >>"$TEST_LOG"
exit 0
EOF

  run_zsh_function "$UP" --no-audit

  [ "$status" -eq 0 ]
  grep -qFx "$HOME/.local/bin/gh" "$TEST_LOG"
  ! grep -qFx "$HOME/.local/share/mise/shims/gh" "$TEST_LOG"
}

@test "up lock commits leave unrelated staged files alone" {
  local git_dir="$TEST_HOME/git/dotfiles"
  mkdir -p "$git_dir" "$TEST_HOME/.config/mise" "$TEST_HOME/.config/nix"
  git init --bare -q "$git_dir"
  git --git-dir="$git_dir" --work-tree="$TEST_HOME" config user.name "up test"
  git --git-dir="$git_dir" --work-tree="$TEST_HOME" config user.email "up-test@users.noreply.github.com"
  git --git-dir="$git_dir" --work-tree="$TEST_HOME" config commit.gpgsign false

  echo "mise-initial" >"$TEST_HOME/.config/mise/mise.lock"
  echo "flake-initial" >"$TEST_HOME/.config/nix/flake.lock"
  echo "keep me staged" >"$TEST_HOME/unrelated.txt"
  git --git-dir="$git_dir" --work-tree="$TEST_HOME" add \
    "$TEST_HOME/.config/mise/mise.lock" \
    "$TEST_HOME/.config/nix/flake.lock" \
    "$TEST_HOME/unrelated.txt"
  git --git-dir="$git_dir" --work-tree="$TEST_HOME" commit -qm initial
  echo "unrelated change" >>"$TEST_HOME/unrelated.txt"
  git --git-dir="$git_dir" --work-tree="$TEST_HOME" add "$TEST_HOME/unrelated.txt"

  write_stub dotfiles <<'EOF'
#!/usr/bin/env bash
echo "dotfiles $*" >>"$TEST_LOG"
git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" "$@"
EOF

  MISE_SIMULATE_BUMP=1 run_zsh_function "$UP" --no-audit
  [ "$status" -eq 0 ]
  [ "$(git --git-dir="$git_dir" --work-tree="$TEST_HOME" log -2 --name-only --format= | grep -c '^unrelated.txt$')" -eq 0 ]
  [ "$(git --git-dir="$git_dir" --work-tree="$TEST_HOME" diff --cached --name-only)" = "unrelated.txt" ]
}

@test "up refuses dirty locks before mutation" {
  echo "local edit" >>"$TEST_HOME/.config/mise/mise.lock"

  run_zsh_function "$UP"
  [ "$status" -ne 0 ]
  [[ "$output" == *"refusing to update a missing or dirty lock: .config/mise/mise.lock"* ]] || false
  [[ "$output" == *"preflight"*"FAILED"* ]] || false
  ! grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'brew' "$TEST_LOG"
  ! grep -qF 'nfu' "$TEST_LOG"
}

@test "up --frozen rejects dirty mise.lock but permits dirty flake.lock" {
  echo "local edit" >>"$TEST_HOME/.config/mise/mise.lock"
  run_zsh_function "$UP" --frozen
  [ "$status" -ne 0 ]
  ! grep -qF 'mise install' "$TEST_LOG"

  : >"$TEST_LOG"
  : >"$TEST_HOME/.config/mise/mise.lock"
  echo "failed bump" >"$TEST_HOME/.config/nix/flake.lock"
  run_zsh_function "$UP" --frozen
  [ "$status" -eq 0 ]
  grep -qF 'mise install' "$TEST_LOG"
  grep -qF 'drs' "$TEST_LOG"
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

@test "up does not commit the lock when the upgrade failed" {
  MISE_SIMULATE_BUMP=1 MISE_FAIL_UPGRADE=1 run_zsh_function "$UP"
  [ "$status" -ne 0 ]
  ! grep -qF 'update tool lock' "$TEST_LOG" # the commit that must not happen
  [[ "$output" == *"NOT committing mise.lock"* ]] || false
  [[ "$output" == *"mise"*"FAILED"* ]] || false
  [[ "$output" != *"next: up -s"* ]] || false
  # the unrelated halves still run: a failing tool doesn't abort the rest
  grep -qF 'brew update' "$TEST_LOG"
  grep -qF 'dotfiles commit -m chore(nix): update flake lock' "$TEST_LOG"
}

@test "up does not commit flake.lock when the rebuild failed" {
  MISE_SIMULATE_BUMP=1 DRS_FAIL=1 run_zsh_function "$UP"
  [ "$status" -ne 0 ]
  grep -qF 'nfu' "$TEST_LOG"
  ! grep -qF 'update flake lock' "$TEST_LOG" # the commit that must not happen
  [[ "$output" == *"NOT committing flake.lock"* ]] || false
  [[ "$output" == *"rebuild"*"FAILED"* ]] || false
  [[ "$output" == *"next: up -s"* ]] || false
  # the mise half is unaffected: its own lock still commits
  grep -qF 'dotfiles commit -m chore(mise): update tool lock' "$TEST_LOG"
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

@test "up rejects unknown arguments before running anything" {
  run_zsh_function "$UP" --dry-run
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown argument: --dry-run"* ]] || false
  [[ "$output" == *"usage: up"* ]] || false
  [ ! -s "$TEST_LOG" ]

  run_zsh_function "$UP" --frozn
  [ "$status" -eq 2 ]
  [ ! -s "$TEST_LOG" ]
}

@test "up --help reports usage without running anything" {
  run_zsh_function "$UP" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"usage: up"* ]] || false
  [ ! -s "$TEST_LOG" ]
}

@test "up fails before mutation when non-interactive sudo validation fails" {
  SUDO_FAIL=1 run_zsh_function "$UP"
  [ "$status" -ne 0 ]
  grep -qF 'osv-scanner scan source' "$TEST_LOG"
  grep -qF 'sudo -n -v' "$TEST_LOG"
  ! grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'brew' "$TEST_LOG"
  [[ "$output" == *"sudo"*"FAILED"*"authentication unavailable"* ]] || false
  [[ "$output" == *"next: rerun up in an interactive terminal"* ]]
}

@test "up keeps sudo alive during work and reaps the helper" {
  UP_SUDO_REFRESH_CENTISECONDS=1 MISE_DELAY=0.2 run_zsh_function "$UP" --frozen
  [ "$status" -eq 0 ]
  local keepalive_pid
  keepalive_pid=$(sed -n 's/^sudo-keepalive-parent=//p' "$TEST_LOG" | head -1)
  [ -n "$keepalive_pid" ]
  ! kill -0 "$keepalive_pid" 2>/dev/null
  [[ "$output" == *"sudo"*"DONE"*"ticket held for privileged phases"* ]]
}

@test "up validates sudo interactively when stdin is a TTY" {
  run /usr/bin/script -q /dev/null "$UP" --frozen
  [ "$status" -eq 0 ]
  grep -qF 'sudo -v' "$TEST_LOG"
}

@test "up reaps the sudo helper when interrupted" {
  UP_SUDO_REFRESH_CENTISECONDS=1 MISE_DELAY=5 run timeout -s TERM 1 zsh --no-rcs "$UP" --frozen
  [ "$status" -eq 124 ]
  local keepalive_pid
  keepalive_pid=$(sed -n 's/^sudo-keepalive-parent=//p' "$TEST_LOG" | head -1)
  [ -n "$keepalive_pid" ]
  ! kill -0 "$keepalive_pid" 2>/dev/null
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
  [[ "$output" == *"audit"*"FAILED"* ]] || false
  [[ "$output" == *"=> failed (exit 1)"* ]]
}

@test "up never commits flake.lock when its update failed" {
  NFU_FAIL=1 run_zsh_function "$UP"
  [ "$status" -ne 0 ]
  grep -qF 'nfu' "$TEST_LOG"
  grep -qF 'drs' "$TEST_LOG"
  ! grep -qF 'update flake lock' "$TEST_LOG"
  [[ "$output" == *"flake update"*"FAILED"* ]] || false
  [[ "$output" == *"flake lock"*"SKIPPED"*"flake update failed"* ]]
}

@test "up reports commit failures and exits non-zero" {
  MISE_SIMULATE_BUMP=1 DOTFILES_FAIL_COMMIT=1 run_zsh_function "$UP"
  [ "$status" -ne 0 ]
  [[ "$output" == *"mise lock"*"FAILED"*"commit failed"* ]] || false
  [[ "$output" == *"next: dhk check"* ]] || false
  [[ "$output" == *"=> failed (exit 1)"* ]]
}

@test "up advisory failures warn without failing the run" {
  TMUX_UPSTREAM_FAIL=1 run_zsh_function "$UP"
  [ "$status" -eq 0 ]
  [[ "$output" == *"tmux"*"WARN"*"exit 1"* ]] || false
  [[ "$output" == *"=> done"* ]]
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
