#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

AUDIT="$FUNCTIONS_DIR/nix/lockfile-audit"

setup() {
  local jq_dir
  jq_dir="$(dirname "$(command -v jq)")" # capture before PATH is isolated
  setup_test_home
  export PATH="$PATH:$jq_dir"

  mkdir -p "$TEST_HOME/project"
  : >"$TEST_HOME/project/pnpm-lock.yaml"

  write_stub dotfiles <<'EOF'
#!/usr/bin/env bash
echo "dotfiles $*" >>"$TEST_LOG"
if [ "$1" = "ls-files" ]; then
  echo "project/pnpm-lock.yaml"
  echo "project/README.md"
fi
exit 0
EOF

  write_stub osv-scanner <<'EOF'
#!/usr/bin/env bash
echo "osv-scanner $*" >>"$TEST_LOG"
case "${OSV_STUB_MODE:-clean}" in
  clean) echo '{"results":[]}'; exit 0 ;;
  mal)
    echo '{"results":[{"source":{"path":"/x/pnpm-lock.yaml"},"packages":[{"package":{"name":"evil","version":"1.0.0","ecosystem":"npm"},"vulnerabilities":[{"id":"MAL-2026-0001","summary":"malware"}]}]}]}'
    exit 1 ;;
  mal-alias)
    echo '{"results":[{"source":{"path":"/x/pnpm-lock.yaml"},"packages":[{"package":{"name":"evil","version":"1.0.0","ecosystem":"npm"},"vulnerabilities":[{"id":"GHSA-aaaa-bbbb-cccc","aliases":["MAL-2026-0002"],"summary":"malware"}]}]}]}'
    exit 1 ;;
  cve)
    echo '{"results":[{"source":{"path":"/x/pnpm-lock.yaml"},"packages":[{"package":{"name":"esbuild","version":"0.17.0","ecosystem":"npm"},"vulnerabilities":[{"id":"GHSA-xxxx-yyyy-zzzz","aliases":["CVE-2024-0001"],"summary":"vuln"}]}]}]}'
    exit 1 ;;
  offline) echo "connection failed" >&2; exit 127 ;;
esac
EOF
}

@test "clean scan exits 0 with a one-line summary" {
  run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 lockfiles clean"* ]]
  # only lockfiles from ls-files become -L args (README.md filtered out)
  grep -qF -- '-L '"$TEST_HOME"'/project/pnpm-lock.yaml' "$TEST_LOG"
  ! grep -qF 'README.md' "$TEST_LOG"
}

@test "CVE findings report but do not block" {
  OSV_STUB_MODE=cve run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"esbuild@0.17.0"* ]]
  [[ "$output" == *"non-blocking"* ]]
}

@test "--block-cves turns CVE findings into a failure" {
  OSV_STUB_MODE=cve run_zsh_function "$AUDIT" --block-cves
  [ "$status" -eq 1 ]
}

@test "MAL-* advisory id blocks with a package summary" {
  OSV_STUB_MODE=mal run_zsh_function "$AUDIT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"MALWARE"* ]]
  [[ "$output" == *"evil@1.0.0"* ]]
}

@test "MAL-* as an alias of a GHSA id also blocks" {
  OSV_STUB_MODE=mal-alias run_zsh_function "$AUDIT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"evil@1.0.0"* ]]
}

@test "scanner error (offline, rc=127) warns and exits 0" {
  OSV_STUB_MODE=offline run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"skipping audit"* ]]
}

@test "no tracked lockfiles exits 0 without invoking the scanner" {
  write_stub dotfiles <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no tracked lockfiles"* ]]
  ! grep -qF 'osv-scanner' "$TEST_LOG"
}

@test "tracked-but-missing lockfiles are skipped" {
  rm "$TEST_HOME/project/pnpm-lock.yaml"
  run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no tracked lockfiles"* ]]
}

@test "--quiet silences clean and CVE report output but not MAL blocks" {
  run_zsh_function "$AUDIT" --quiet
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  OSV_STUB_MODE=cve run_zsh_function "$AUDIT" --quiet
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  OSV_STUB_MODE=mal run_zsh_function "$AUDIT" --quiet
  [ "$status" -eq 1 ]
  [[ "$output" == *"MALWARE"* ]]
}
