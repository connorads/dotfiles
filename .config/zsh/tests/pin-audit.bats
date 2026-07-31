#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

AUDIT="$FUNCTIONS_DIR/nix/pin-audit"

# Writes the [tools] entries pin-audit reads for its pin inventory. Individual
# tests overwrite these to exercise the pin-removed self-healing branches.
write_configs() {
  mkdir -p "$TEST_HOME/.config/mise"
  cat >"$TEST_HOME/.config/mise/config.toml" <<'EOF'
[tools]
"github:CosineAI/cli" = { version = "2", bin = "cos", prerelease = true }
"npm:@anthropic-ai/sandbox-runtime" = "0.0.62"
"pipx:rembg" = { version = "2.0.69", extras = "cli,cpu" }
EOF
}

# Probe stubs keyed by env vars so each test picks its scenario:
#   SRT_LATEST, COS_JSON; unset any of
#   MISE_OK/GH_OK/NPM_OK to simulate that probe failing (offline).
write_probe_stubs() {
  write_stub mise <<'EOF'
#!/usr/bin/env bash
[ -n "${MISE_OK:-}" ] || exit 1
case "$2" in
  pipx:rembg) echo "${REMBG_LATEST:-2.0.76}" ;;
esac
EOF
  write_stub gh <<'EOF'
#!/usr/bin/env bash
[ -n "${GH_OK:-}" ] || exit 1
case "$2" in
  list) echo "${COS_STABLE:-}" ;;
esac
EOF
  write_stub npm <<'EOF'
#!/usr/bin/env bash
[ -n "${NPM_OK:-}" ] || exit 1
case "$3" in
  version) echo "${SRT_LATEST:-0.0.66}" ;;
esac
EOF
}

setup() {
  # The implementation is TypeScript (~/src/pin-audit), so the suite needs bun
  # on the isolated PATH. Resolve it from the ambient environment first, before
  # setup_test_home rewrites PATH, and prefer `mise which` over `command -v` so
  # a shims-only PATH can't hand back a shim that re-invokes the stubbed mise.
  local bun_bin
  bun_bin=$(mise which bun 2>/dev/null) || bun_bin=$(command -v bun 2>/dev/null) || true
  [ -n "$bun_bin" ] || skip "bun absent (mise install bun)"

  setup_test_home
  # Just bun, not its whole directory: the mise/gh/npm stubs stay the only
  # spelling of those commands.
  ln -s "$bun_bin" "$TEST_BIN/bun"
  # The wrapper resolves its implementation as ~/src/pin-audit, so the isolated
  # home has to carry it too. Zero runtime deps, so the sources are enough.
  mkdir -p "$TEST_HOME/src"
  ln -s "$REAL_HOME/src/pin-audit" "$TEST_HOME/src/pin-audit"
  write_configs
  write_probe_stubs
  export MISE_OK=1 GH_OK=1 NPM_OK=1
}

@test "all conditions holding reports OK/INFO and exits 0" {
  run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"INFO rembg pinned 2.0.69"* ]]
  [[ "$output" == *"OK   sandbox-runtime 0.0.62 - latest 0.0.66 still pre-1.0"* ]]
  [[ "$output" == *"OK   CosineAI/cli - all versioned releases still pre-release"* ]]
  [[ "$output" != *"FLAG"* ]]
}

@test "cleared conditions FLAG each pin but still exit 0" {
  SRT_LATEST=1.0.0 COS_STABLE=v2.1.0 run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"FLAG sandbox-runtime 0.0.62 - 1.0.0 landed"* ]]
  [[ "$output" == *"FLAG CosineAI/cli - stable release v2.1.0 exists"* ]]
}

@test "failed probes degrade to SKIP and exit 0" {
  unset MISE_OK GH_OK NPM_OK
  run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SKIP sandbox-runtime 0.0.62 - npm probe failed"* ]]
  [[ "$output" == *"SKIP CosineAI/cli prerelease=true - gh probe failed"* ]]
  [[ "$output" != *"FLAG"* ]]
}

# `up` calls pin-audit unconditionally, so a missing runtime must degrade, not
# error: no bun means one SKIP line, never a non-zero exit.
@test "bun absent degrades to a SKIP line and still exits 0" {
  rm "$TEST_BIN/bun"
  run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SKIP bun absent"* ]]
}

@test "removed pins self-report as removable checks" {
  : >"$TEST_HOME/.config/mise/config.toml"
  run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK   rembg - exact pin gone"* ]]
  [[ "$output" == *"OK   sandbox-runtime - exact pin gone"* ]]
  [[ "$output" == *"OK   CosineAI/cli - prerelease=true gone"* ]]
}
