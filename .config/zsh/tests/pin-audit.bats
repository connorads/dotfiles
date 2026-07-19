#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

AUDIT="$FUNCTIONS_DIR/nix/pin-audit"

# Writes the config lines pin-audit greps for its pin inventory. Individual
# tests overwrite these to exercise the pin-removed self-healing branches.
write_configs() {
  mkdir -p "$TEST_HOME/.config/mise" "$TEST_HOME/.config/aube"
  cat >"$TEST_HOME/.config/mise/config.toml" <<'EOF'
fnox = "1.27.1"
"github:CosineAI/cli" = { version = "2", bin = "cos", prerelease = true }
"npm:@anthropic-ai/sandbox-runtime" = "0.0.62"
"pipx:rembg" = { version = "2.0.69", extras = "cli,cpu" }
EOF
  cat >"$TEST_HOME/.config/aube/config.toml" <<'EOF'
trustPolicyExclude = [
  "@mariozechner/clipboard-*",
]
EOF
}

# Probe stubs keyed by env vars so each test picks its scenario:
#   FNOX_LATEST / FNOX_ASSETS, CLIP_ATT, SRT_LATEST, COS_JSON; unset any of
#   MISE_OK/GH_OK/NPM_OK to simulate that probe failing (offline).
write_probe_stubs() {
  write_stub mise <<'EOF'
#!/usr/bin/env bash
[ -n "${MISE_OK:-}" ] || exit 1
case "$2" in
  fnox) echo "${FNOX_LATEST:-1.27.1}" ;;
  pipx:rembg) echo "${REMBG_LATEST:-2.0.76}" ;;
esac
EOF
  write_stub gh <<'EOF'
#!/usr/bin/env bash
[ -n "${GH_OK:-}" ] || exit 1
case "$2" in
  view) echo "${FNOX_ASSETS:-0}" ;;
  list) echo "${COS_STABLE:-}" ;;
esac
EOF
  write_stub npm <<'EOF'
#!/usr/bin/env bash
[ -n "${NPM_OK:-}" ] || exit 1
case "$3" in
  dist.attestations) echo "${CLIP_ATT:-}" ;;
  version) echo "${SRT_LATEST:-0.0.66}" ;;
esac
EOF
}

setup() {
  setup_test_home
  write_configs
  write_probe_stubs
  export MISE_OK=1 GH_OK=1 NPM_OK=1
}

@test "all conditions holding reports OK/INFO and exits 0" {
  run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK   fnox 1.27.1 - still the newest"* ]]
  [[ "$output" == *"OK   clipboard trustPolicyExclude - still no attestations"* ]]
  [[ "$output" == *"INFO rembg pinned 2.0.69"* ]]
  [[ "$output" == *"OK   sandbox-runtime 0.0.62 - latest 0.0.66 still pre-1.0"* ]]
  [[ "$output" == *"OK   CosineAI/cli - all versioned releases still pre-release"* ]]
  [[ "$output" != *"FLAG"* ]]
}

@test "cleared conditions FLAG each pin but still exit 0" {
  FNOX_LATEST=1.30.0 FNOX_ASSETS=8 CLIP_ATT='{"p":1}' SRT_LATEST=1.0.0 \
    COS_STABLE=v2.1.0 run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"FLAG fnox 1.27.1 - 1.30.0 ships 8 assets"* ]]
  [[ "$output" == *"FLAG clipboard trustPolicyExclude"* ]]
  [[ "$output" == *"FLAG sandbox-runtime 0.0.62 - 1.0.0 landed"* ]]
  [[ "$output" == *"FLAG CosineAI/cli - stable release v2.1.0 exists"* ]]
}

@test "newer fnox without assets keeps the pin (OK)" {
  FNOX_LATEST=1.31.0 FNOX_ASSETS=0 run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK   fnox 1.27.1 - newer 1.31.0 still ships no assets"* ]]
}

@test "failed probes degrade to SKIP and exit 0" {
  unset MISE_OK GH_OK NPM_OK
  run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SKIP fnox 1.27.1 - version probe failed"* ]]
  [[ "$output" == *"SKIP clipboard trustPolicyExclude - npm probe failed"* ]]
  [[ "$output" == *"SKIP sandbox-runtime 0.0.62 - npm probe failed"* ]]
  [[ "$output" == *"SKIP CosineAI/cli prerelease=true - gh probe failed"* ]]
  [[ "$output" != *"FLAG"* ]]
}

@test "removed pins self-report as removable checks" {
  : >"$TEST_HOME/.config/mise/config.toml"
  : >"$TEST_HOME/.config/aube/config.toml"
  run_zsh_function "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK   fnox - exact pin gone"* ]]
  [[ "$output" == *"OK   clipboard trustPolicyExclude - gone"* ]]
  [[ "$output" == *"OK   rembg - exact pin gone"* ]]
  [[ "$output" == *"OK   sandbox-runtime - exact pin gone"* ]]
  [[ "$output" == *"OK   CosineAI/cli - prerelease=true gone"* ]]
}
