#!/usr/bin/env bats
# Tests for skill-patch: declarative patches for vendored skills.
# Fixtures build a fake vendor root under the isolated $HOME
# ($HOME/.config/skills/vendor) - the engine's default root.

load test_helper

SKILL_PATCH=""

setup() {
  setup_test_home
  SKILL_PATCH="$FUNCTIONS_DIR/patch/skill-patch"
  VENDOR="$TEST_HOME/.config/skills/vendor"
  mkdir -p "$VENDOR/patches"
}

run_skill_patch() {
  run zsh --no-rcs "$SKILL_PATCH" "$@"
}

# Minimal single-hunk patch: strip an upstream self-update line, leave a marker.
make_simple_patch() {
  local dir="$VENDOR/patches/strip-line"
  mkdir -p "$dir" "$VENDOR/.agents/skills/demo"
  cat >"$dir/patch.json" <<'EOF'
{
  "reason": "upstream self-update line removed.",
  "files": [".agents/skills/demo/SKILL.md"]
}
EOF
  printf '> keep this fresh: run update now\n' >"$dir/01-find.md"
  printf '{{marker}}\n' >"$dir/01-replace.md"
}

write_pending_target() {
  printf '# Demo\n\n> keep this fresh: run update now\n\nBody text.\n' \
    >"$VENDOR/.agents/skills/demo/SKILL.md"
}

write_applied_target() {
  printf '# Demo\n\n<!-- LOCAL PATCH (connorads dotfiles): upstream self-update line removed. -->\n\nBody text.\n' \
    >"$VENDOR/.agents/skills/demo/SKILL.md"
}

@test "check: all applied exits 0 silently" {
  make_simple_patch
  write_applied_target
  run_skill_patch check
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "apply: all applied is a no-op (exit 0, bytes untouched)" {
  make_simple_patch
  write_applied_target
  before=$(cat "$VENDOR/.agents/skills/demo/SKILL.md")
  run_skill_patch apply
  [ "$status" -eq 0 ]
  [ "$(cat "$VENDOR/.agents/skills/demo/SKILL.md")" = "$before" ]
}

@test "apply: pending hunk produces byte-expected content with generated marker" {
  make_simple_patch
  write_pending_target
  run_skill_patch apply
  [ "$status" -eq 0 ]
  expected='# Demo

<!-- LOCAL PATCH (connorads dotfiles): upstream self-update line removed. -->

Body text.'
  [ "$(cat "$VENDOR/.agents/skills/demo/SKILL.md")" = "$expected" ]
}

@test "apply: second apply is a no-op" {
  make_simple_patch
  write_pending_target
  run_skill_patch apply
  [ "$status" -eq 0 ]
  after_first=$(cat "$VENDOR/.agents/skills/demo/SKILL.md")
  run_skill_patch apply
  [ "$status" -eq 0 ]
  [ "$(cat "$VENDOR/.agents/skills/demo/SKILL.md")" = "$after_first" ]
}

@test "check: pending exits 1 and names patch, target, remediation" {
  make_simple_patch
  write_pending_target
  run_skill_patch check
  [ "$status" -eq 1 ]
  [[ "$output" == *"strip-line"* ]]
  [[ "$output" == *".agents/skills/demo/SKILL.md"* ]]
  [[ "$output" == *"pending"* ]]
  [[ "$output" == *"skill-patch apply"* ]]
}

@test "broken drift: check exits 1 naming the find hunk to re-derive" {
  make_simple_patch
  printf '# Demo\n\n> upstream rewrote this line entirely\n\nBody text.\n' \
    >"$VENDOR/.agents/skills/demo/SKILL.md"
  run_skill_patch check
  [ "$status" -eq 1 ]
  [[ "$output" == *"broken"* ]]
  [[ "$output" == *"patches/strip-line/01-find.md"* ]]
}

@test "broken drift: apply exits 1 with a banner, leaves target untouched" {
  make_simple_patch
  printf '# Demo\n\n> upstream rewrote this line entirely\n\nBody text.\n' \
    >"$VENDOR/.agents/skills/demo/SKILL.md"
  before=$(cat "$VENDOR/.agents/skills/demo/SKILL.md")
  run_skill_patch apply
  [ "$status" -eq 1 ]
  [[ "$output" == *"CANNOT APPLY"* ]]
  [[ "$output" == *"broken"* ]]
  [[ "$output" == *"strip-line"* ]]
  [ "$(cat "$VENDOR/.agents/skills/demo/SKILL.md")" = "$before" ]
}

@test "vars cross-product expands {{skill}} in paths and hunk text" {
  local dir="$VENDOR/patches/multi-skill"
  mkdir -p "$dir" "$VENDOR/.agents/skills/alpha" "$VENDOR/.agents/skills/beta"
  cat >"$dir/patch.json" <<'EOF'
{
  "reason": "strip per-skill update line.",
  "files": [".agents/skills/{{skill}}/SKILL.md"],
  "vars": {"skill": ["alpha", "beta"]}
}
EOF
  printf 'run update {{skill}} now\n' >"$dir/01-find.md"
  printf '{{marker}}\n' >"$dir/01-replace.md"
  printf 'intro\nrun update alpha now\noutro\n' >"$VENDOR/.agents/skills/alpha/SKILL.md"
  printf 'intro\nrun update beta now\noutro\n' >"$VENDOR/.agents/skills/beta/SKILL.md"

  run_skill_patch apply
  [ "$status" -eq 0 ]
  expected_alpha='intro
<!-- LOCAL PATCH (connorads dotfiles): strip per-skill update line. -->
outro'
  [ "$(cat "$VENDOR/.agents/skills/alpha/SKILL.md")" = "$expected_alpha" ]
  [[ "$(cat "$VENDOR/.agents/skills/beta/SKILL.md")" == *"LOCAL PATCH"* ]]

  run_skill_patch check
  [ "$status" -eq 0 ]
}

@test "vars cross-product: one skill clobbered -> check names only that target" {
  local dir="$VENDOR/patches/multi-skill"
  mkdir -p "$dir" "$VENDOR/.agents/skills/alpha" "$VENDOR/.agents/skills/beta"
  cat >"$dir/patch.json" <<'EOF'
{
  "reason": "strip per-skill update line.",
  "files": [".agents/skills/{{skill}}/SKILL.md"],
  "vars": {"skill": ["alpha", "beta"]}
}
EOF
  printf 'run update {{skill}} now\n' >"$dir/01-find.md"
  printf '{{marker}}\n' >"$dir/01-replace.md"
  printf 'intro\n<!-- LOCAL PATCH (connorads dotfiles): strip per-skill update line. -->\noutro\n' \
    >"$VENDOR/.agents/skills/alpha/SKILL.md"
  printf 'intro\nrun update beta now\noutro\n' >"$VENDOR/.agents/skills/beta/SKILL.md"

  run_skill_patch check
  [ "$status" -eq 1 ]
  [[ "$output" == *"beta"* ]]
  [[ "$output" != *"alpha"* ]]
}

@test "ambiguous: find matching twice is refused" {
  make_simple_patch
  printf '> keep this fresh: run update now\n> keep this fresh: run update now\n' \
    >"$VENDOR/.agents/skills/demo/SKILL.md"
  before=$(cat "$VENDOR/.agents/skills/demo/SKILL.md")
  run_skill_patch apply
  [ "$status" -eq 1 ]
  [[ "$output" == *"ambiguous"* ]]
  [ "$(cat "$VENDOR/.agents/skills/demo/SKILL.md")" = "$before" ]
}

@test "missing target: exit 1 naming the state" {
  make_simple_patch
  rm -rf "$VENDOR/.agents/skills/demo"
  run_skill_patch check
  [ "$status" -eq 1 ]
  [[ "$output" == *"missing-target"* ]]
}

@test "malformed patch.json exits 2" {
  local dir="$VENDOR/patches/bad-json"
  mkdir -p "$dir"
  printf '{ not json\n' >"$dir/patch.json"
  printf 'x\n' >"$dir/01-find.md"
  printf 'y\n' >"$dir/01-replace.md"
  run_skill_patch check
  [ "$status" -eq 2 ]
  [[ "$output" == *"bad-json"* ]]
}

@test "unpaired hunk file exits 2" {
  make_simple_patch
  write_applied_target
  rm "$VENDOR/patches/strip-line/01-replace.md"
  run_skill_patch check
  [ "$status" -eq 2 ]
  [[ "$output" == *"01-replace.md"* ]]
}

@test "{{marker}} in a find hunk exits 2" {
  make_simple_patch
  write_applied_target
  printf '{{marker}}\n' >"$VENDOR/patches/strip-line/01-find.md"
  run_skill_patch check
  [ "$status" -eq 2 ]
  [[ "$output" == *"marker"* ]]
}

@test "mixed multi-hunk file: applied + pending -> check 1, apply fixes both states" {
  local dir="$VENDOR/patches/two-hunks"
  mkdir -p "$dir" "$VENDOR/.agents/skills/demo"
  cat >"$dir/patch.json" <<'EOF'
{
  "reason": "two edits in one file.",
  "files": [".agents/skills/demo/SKILL.md"]
}
EOF
  printf 'first upstream line\n' >"$dir/01-find.md"
  printf '{{marker}}\n' >"$dir/01-replace.md"
  printf 'second upstream para\n' >"$dir/02-find.md"
  printf 'local replacement para\n' >"$dir/02-replace.md"
  # Hunk 01 already applied, hunk 02 still pending.
  printf '<!-- LOCAL PATCH (connorads dotfiles): two edits in one file. -->\nmiddle\nsecond upstream para\nend\n' \
    >"$VENDOR/.agents/skills/demo/SKILL.md"

  run_skill_patch check
  [ "$status" -eq 1 ]
  [[ "$output" == *"hunk 02"* ]]
  [[ "$output" != *"hunk 01"* ]]

  run_skill_patch apply
  [ "$status" -eq 0 ]
  expected='<!-- LOCAL PATCH (connorads dotfiles): two edits in one file. -->
middle
local replacement para
end'
  [ "$(cat "$VENDOR/.agents/skills/demo/SKILL.md")" = "$expected" ]
}

@test "patch-name argument scopes the run; unknown name exits 2" {
  make_simple_patch
  write_pending_target
  local dir="$VENDOR/patches/other"
  mkdir -p "$dir" "$VENDOR/.agents/skills/other"
  cat >"$dir/patch.json" <<'EOF'
{"reason": "other patch.", "files": [".agents/skills/other/SKILL.md"]}
EOF
  printf 'aaa\n' >"$dir/01-find.md"
  printf 'bbb\n' >"$dir/01-replace.md"
  printf 'bbb\n' >"$VENDOR/.agents/skills/other/SKILL.md"

  run_skill_patch check other # applied -> clean despite strip-line pending
  [ "$status" -eq 0 ]
  run_skill_patch check strip-line
  [ "$status" -eq 1 ]
  run_skill_patch check no-such-patch
  [ "$status" -eq 2 ]
  [[ "$output" == *"no-such-patch"* ]]
}

@test "list: names + reasons" {
  make_simple_patch
  run_skill_patch list
  [ "$status" -eq 0 ]
  [[ "$output" == *"strip-line"* ]]
  [[ "$output" == *"upstream self-update line removed."* ]]
}

@test "status: one row per (patch, target, hunk) with state" {
  make_simple_patch
  write_pending_target
  run_skill_patch status
  [ "$status" -eq 1 ]
  [[ "$output" == *"pending"* ]]
  [[ "$output" == *"strip-line"* ]]
  [[ "$output" == *"hunk 01"* ]]
}

@test "usage: no mode exits 2, unknown mode exits 2, --help exits 0" {
  run_skill_patch
  [ "$status" -eq 2 ]
  run_skill_patch frobnicate
  [ "$status" -eq 2 ]
  run_skill_patch --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"usage:"* ]]
}
