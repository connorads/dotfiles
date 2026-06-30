#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

ROOT_DIR="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
ASB="$ROOT_DIR/.local/bin/agent-sandbox"

# Make a real tool (jq/rg) discoverable on the test PATH via TEST_BIN symlink so
# the dispatcher's `command -v` / resolve_* find it under the hermetic HOME.
link_real() {
  local name=$1 real
  real="$(command -v "$name" 2>/dev/null)" || return 0
  ln -sf "$real" "$TEST_BIN/$name"
}

setup() {
  setup_test_home
  unset GH_TOKEN GITHUB_TOKEN AGENT_SANDBOX_REQUIRE AGENT_SANDBOX_ALLOW_WRITE AGENT_SANDBOX_DEBUG
  link_real jq
  link_real rg
  SHADOW="$HOME/.local/share/shadow-bin"
  SHIMS="$HOME/.local/share/mise/shims"
  SRTDIR="$HOME/.config/srt"
  mkdir -p "$SHADOW" "$SHIMS" "$SRTDIR" "$HOME/.local/bin" "$HOME/.cache"
  # shadow-bin/<tool> -> ../../bin/agent-sandbox resolves to $HOME/.local/bin;
  # point that at the real dispatcher under the hermetic HOME.
  ln -sf "$ASB" "$HOME/.local/bin/agent-sandbox"
}

# A minimal valid base.json + overlay with deliberate overlaps and uniques.
write_base() {
  cat >"$SRTDIR/base.json" <<'EOF'
{
  "allowPty": true,
  "network": { "allowedDomains": ["github.com","api.anthropic.com"], "deniedDomains": [] },
  "filesystem": {
    "denyRead": ["~/.ssh"], "allowRead": [],
    "allowWrite": [".","~/.cache/**"], "denyWrite": []
  }
}
EOF
}

write_overlay() {
  local tool=${1:-opencode}
  cat >"$SRTDIR/$tool.overlay.json" <<EOF
{ "allowPty": false,
  "network": { "allowedDomains": ["github.com","example.com"] },
  "filesystem": { "allowWrite": ["~/.config/$tool/**","."] } }
EOF
}

# Fake real tool: prints a marker, its args, and inherited GH_TOKEN.
write_fake_tool() {
  local tool=${1:-opencode}
  write_executable "$SHIMS/$tool" <<EOF
#!/usr/bin/env bash
echo "REAL-$tool args=\$*"
echo "GH_TOKEN=\${GH_TOKEN-}"
exit \${FAKE_TOOL_EXIT:-0}
EOF
}

# Fake srt: echoes exactly what it received plus the env it was handed.
write_fake_srt() {
  write_executable "$SHIMS/srt" <<'EOF'
#!/usr/bin/env bash
echo "SRT args=$*"
echo "GH_TOKEN=${GH_TOKEN-}"
exit 0
EOF
}

# Enrol a tool end to end (policy rendered, shims + shadow symlink in place).
enrol() {
  local tool=${1:-opencode}
  write_base
  write_overlay "$tool"
  write_fake_tool "$tool"
  run "$ASB" sync "$tool"
  [ "$status" -eq 0 ]
  ln -sf "../../bin/agent-sandbox" "$SHADOW/$tool"
}

# ---- jq merge / sync -------------------------------------------------------

@test "sync renders concat+deduped arrays with all four filesystem keys" {
  write_base
  write_overlay opencode
  run "$ASB" sync opencode
  [ "$status" -eq 0 ]

  local p="$SRTDIR/opencode.json"
  run jq -e '.filesystem | has("denyRead") and has("allowRead") and has("allowWrite") and has("denyWrite")' "$p"
  [ "$status" -eq 0 ]
  # github.com appears in both -> deduped to one entry.
  run jq -r '[.network.allowedDomains[] | select(. == "github.com")] | length' "$p"
  [ "$output" = "1" ]
  # union of base + overlay domains.
  run jq -e '.network.allowedDomains | index("example.com") and index("api.anthropic.com")' "$p"
  [ "$status" -eq 0 ]
  # cwd "." in both -> deduped.
  run jq -r '[.filesystem.allowWrite[] | select(. == ".")] | length' "$p"
  [ "$output" = "1" ]
}

@test "sync allowPty is overlay-wins scalar" {
  write_base
  write_overlay opencode # overlay sets allowPty:false
  run "$ASB" sync opencode
  run jq -r '.allowPty' "$SRTDIR/opencode.json"
  [ "$output" = "false" ]
}

@test "sync writes valid JSON" {
  write_base
  write_overlay opencode
  run "$ASB" sync opencode
  run jq -e '.' "$SRTDIR/opencode.json"
  [ "$status" -eq 0 ]
}

@test "sync of a bad overlay keeps the existing committed policy" {
  enrol opencode
  cp "$SRTDIR/opencode.json" "$BATS_TEST_TMPDIR/good.json"
  printf 'not json' >"$SRTDIR/opencode.overlay.json"
  run "$ASB" sync opencode
  [ "$status" -ne 0 ]
  run diff "$BATS_TEST_TMPDIR/good.json" "$SRTDIR/opencode.json"
  [ "$status" -eq 0 ]
}

# ---- resolution ------------------------------------------------------------

@test "wrapped launch resolves the mise shim, not the shadow wrapper" {
  enrol opencode
  write_fake_srt
  run "$SHADOW/opencode" chat hello
  [ "$status" -eq 0 ]
  # srt received the resolved real path = the mise shim (no recursion).
  [[ "$output" == *"SRT args=-s $SRTDIR/opencode.json -- $SHIMS/opencode chat hello"* ]]
}

@test "resolution skips local bin and shadow bin copies" {
  enrol opencode
  write_fake_srt
  # decoys that must never be picked
  write_executable "$HOME/.local/bin/opencode" <<'EOF'
#!/usr/bin/env bash
echo wrong-local-bin; exit 9
EOF
  run "$SHADOW/opencode" go
  [ "$status" -eq 0 ]
  [[ "$output" != *"wrong-local-bin"* ]]
  [[ "$output" == *"$SHIMS/opencode go"* ]]
}

# ---- sandboxed invocation --------------------------------------------------

@test "sandboxed launch invokes srt -s policy -- real args" {
  enrol opencode
  write_fake_srt
  run "$SHADOW/opencode" --flag value
  [ "$status" -eq 0 ]
  [[ "$output" == *"SRT args=-s $SRTDIR/opencode.json -- $SHIMS/opencode --flag value"* ]]
}

@test "GH_TOKEN is stripped before sandboxed launch" {
  enrol opencode
  write_fake_srt
  export GH_TOKEN=secret GITHUB_TOKEN=secret2
  run "$SHADOW/opencode" run
  [ "$status" -eq 0 ]
  [[ "$output" == *"GH_TOKEN="* ]]
  [[ "$output" != *"secret"* ]]
}

@test "AGENT_SANDBOX_ALLOW_WRITE appends paths to a temp policy" {
  enrol opencode
  # srt stub that dumps the policy it was handed so we can inspect it.
  write_executable "$SHIMS/srt" <<'EOF'
#!/usr/bin/env bash
prev=""
for a in "$@"; do [ "$prev" = "-s" ] && cat "$a"; prev="$a"; done
exit 0
EOF
  export AGENT_SANDBOX_ALLOW_WRITE="/work/tree/.git:/extra/path"
  run "$SHADOW/opencode" go
  [ "$status" -eq 0 ]
  [[ "$output" == *"/work/tree/.git"* ]]
  [[ "$output" == *"/extra/path"* ]]
  # committed policy is untouched by the per-launch grant.
  run jq -e '.filesystem.allowWrite | index("/work/tree/.git")' "$SRTDIR/opencode.json"
  [ "$status" -ne 0 ]
}

# ---- fallback / fail-closed ------------------------------------------------

@test "missing srt falls back to running the tool unwrapped" {
  enrol opencode # no srt shim written
  run "$SHADOW/opencode" hello
  [ "$status" -eq 0 ]
  [[ "$output" == *"REAL-opencode args=hello"* ]]
  [[ "$output" == *"UNSANDBOXED"* ]]
}

@test "fallback propagates the tool exit status" {
  enrol opencode
  export FAKE_TOOL_EXIT=37
  run "$SHADOW/opencode" boom
  [ "$status" -eq 37 ]
}

@test "AGENT_SANDBOX_REQUIRE=1 refuses and does not run the tool when srt missing" {
  enrol opencode # no srt
  export AGENT_SANDBOX_REQUIRE=1
  run "$SHADOW/opencode" hello
  [ "$status" -ne 0 ]
  [[ "$output" != *"REAL-opencode"* ]]
  [[ "$output" == *"refusing"* ]]
}

@test "missing policy falls back" {
  write_fake_tool opencode
  write_fake_srt
  ln -sf "../../bin/agent-sandbox" "$SHADOW/opencode"
  # no policy file rendered
  run "$SHADOW/opencode" hi
  [ "$status" -eq 0 ]
  [[ "$output" == *"REAL-opencode args=hi"* ]]
  [[ "$output" == *"policy-missing-or-invalid"* ]]
}

@test "invalid policy (missing required keys) falls back" {
  write_fake_tool opencode
  write_fake_srt
  ln -sf "../../bin/agent-sandbox" "$SHADOW/opencode"
  printf '{"allowPty":true}' >"$SRTDIR/opencode.json"
  run "$SHADOW/opencode" hi
  [ "$status" -eq 0 ]
  [[ "$output" == *"REAL-opencode"* ]]
}

# ---- enable / disable / list ----------------------------------------------

@test "enable scaffolds overlay, renders policy, creates shadow symlink, prints hash -r" {
  write_base
  write_fake_tool opencode
  run "$ASB" enable opencode
  [ "$status" -eq 0 ]
  [ -f "$SRTDIR/opencode.overlay.json" ]
  [ -f "$SRTDIR/opencode.json" ]
  assert_symlink_target "$SHADOW/opencode" "../../bin/agent-sandbox"
  [[ "$output" == *"hash -r"* ]]
}

@test "disable removes the shadow symlink but keeps the policy, prints hash -r" {
  enrol opencode
  run "$ASB" disable opencode
  [ "$status" -eq 0 ]
  [ ! -e "$SHADOW/opencode" ]
  [ -f "$SRTDIR/opencode.json" ]
  [[ "$output" == *"hash -r"* ]]
}

@test "list excludes asb/agent-sandbox self entries" {
  enrol opencode
  # self symlinks that must not be listed as tools
  ln -sf "../../bin/agent-sandbox" "$SHADOW/asb"
  ln -sf "../../bin/agent-sandbox" "$SHADOW/agent-sandbox"
  run "$ASB" list
  [ "$status" -eq 0 ]
  [[ "$output" == *"opencode"* ]]
  # the tool table line for self must not appear
  [[ "$output" != *$'\nasb '* ]]
}
