#!/usr/bin/env bats
#
# The `prose` command: the house prose rules, callable from any repo.
#
# Runs against the REAL ~/.vale.ini, because the whole point of the command is
# that it carries the house config to wherever it is invoked - an isolated $HOME
# would prove nothing about that. Only the fixtures and cwd are throwaway.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

PROSE="$FUNCTIONS_DIR/prose"

setup() {
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
}

@test "flags an em dash in a named file" {
  printf '%s\n' 'The gate blocks the commit — that is the point.' >doc.md
  run "$PROSE" doc.md
  [ "$status" -eq 1 ]
  [[ $output == *Connorads.Dashes* ]]
}

@test "passes house prose" {
  printf '%s\n' 'Commit on the current branch by default - do not branch first.' >doc.md
  run "$PROSE" doc.md
  [ "$status" -eq 0 ]
}

@test "with no arguments lints markdown under the current directory" {
  mkdir -p nested
  printf '%s\n' 'A nested file — with a dash.' >nested/doc.md
  run "$PROSE"
  [ "$status" -eq 1 ]
  [[ $output == *Connorads.Dashes* ]]
}

# --config is what makes the house rules travel: a repo with its own .vale.ini
# would otherwise shadow them, and the command would silently lint against
# whatever that repo happens to enforce.
@test "house rules win over a repo's own .vale.ini" {
  printf '%s\n' 'MinAlertLevel = error' '' '[*.md]' 'BasedOnStyles = ' >.vale.ini
  printf '%s\n' 'The gate blocks the commit — that is the point.' >doc.md

  run vale --no-global doc.md
  [ "$status" -eq 0 ]

  run "$PROSE" doc.md
  [ "$status" -eq 1 ]
  [[ $output == *Connorads.Dashes* ]]
}

# Never brick a caller over a checker it cannot run (ts-typecheck.sh's posture).
@test "warns and passes when vale is absent" {
  printf '%s\n' 'The gate blocks the commit — that is the point.' >doc.md
  PATH=/usr/bin:/bin run "$PROSE" doc.md
  [ "$status" -eq 0 ]
  [[ $output == *"vale absent"* ]]
}

# Resolving is not running. mise plants a shim on PATH for every tool in its
# registry, so `command -v vale` succeeds on a machine where no vale version is
# set - and the shim then exits 1 instead of running. Guarding on the name alone
# turns this warn-and-skip into a hard failure for every caller.
@test "warns and passes when vale's shim resolves but cannot run" {
  printf '%s\n' 'The gate blocks the commit — that is the point.' >doc.md
  mkdir -p "$BATS_TEST_TMPDIR/shims"
  cat >"$BATS_TEST_TMPDIR/shims/vale" <<'EOF'
#!/usr/bin/env bash
echo "mise ERROR No version is set for shim: vale" >&2
exit 1
EOF
  chmod +x "$BATS_TEST_TMPDIR/shims/vale"

  PATH="$BATS_TEST_TMPDIR/shims:/usr/bin:/bin" run "$PROSE" doc.md
  [ "$status" -eq 0 ]
  [[ $output == *"vale absent"* ]]
}
