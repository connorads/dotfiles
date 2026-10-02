#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# tmux-bind-lint precedent: no setup_test_home. The positive case asserts the
# REAL tracked tmux scripts conform, so it runs against the real $HOME; the
# failure cases cd into $BATS_TEST_TMPDIR and build a fixture tree that the
# checker's cwd-relative resolve picks up instead.
CHECK="$HOME/.hk-hooks/bash5-preamble.py"
REAL_SCRIPTS="$HOME/.config/tmux/scripts"

# fixture_tree — a minimal but conforming copy of the three script dirs, seeded
# from the real files so the fixtures track the shipped preamble text rather
# than a hand-copy that could drift.
fixture_tree() {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p .config/tmux/scripts/lib .config/tmux/strategies .config/tmux/save_command_strategies
  cp "$REAL_SCRIPTS/status-right.sh" .config/tmux/scripts/entry.sh
  cp "$REAL_SCRIPTS/lib/claude-plan.sh" .config/tmux/scripts/lib/alib.sh
  cp "$REAL_SCRIPTS/agent-state.sh" .config/tmux/scripts/posix.sh
  chmod +x .config/tmux/scripts/entry.sh .config/tmux/scripts/posix.sh
}

# strip_block FILE START END — delete an inclusive line range matched by two
# literal markers.
strip_block() {
  python3 - "$@" <<'PY'
import re, sys
path, start, end = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
out = re.sub(re.escape(start) + r'.*?' + re.escape(end) + r'\n', '', s, flags=re.S)
assert out != s, f"marker pair not found in {path}"
open(path, 'w').write(out)
PY
}

@test "the real tmux scripts all conform today" {
  cd "$HOME"
  run python3 "$CHECK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "a conforming fixture tree passes" {
  fixture_tree
  run python3 "$CHECK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "an executable bash entry point without the preamble blocks" {
  fixture_tree
  strip_block .config/tmux/scripts/entry.sh \
    '# --- bash5 re-exec preamble:' '# --- end bash5 preamble ---'
  run python3 "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *"entry.sh"* ]]
  [[ "$output" == *"missing the bash5 re-exec preamble"* ]]
}

@test "deleting only the guard unset blocks (it is load-bearing, not tidiness)" {
  fixture_tree
  # This exact edit is the silent-failure bug: a re-exec'd parent would leave
  # TMUX_BASH5_REEXEC=1 in the environment and suppress its child's own re-exec.
  python3 - <<'PY'
p = '.config/tmux/scripts/entry.sh'
s = open(p).read()
assert 'unset TMUX_BASH5_REEXEC _b5' in s
open(p, 'w').write(s.replace('unset TMUX_BASH5_REEXEC _b5', 'unset _b5'))
PY
  run python3 "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *"entry.sh"* ]]
}

@test "a sourced lib without the bash5 assert blocks" {
  fixture_tree
  strip_block .config/tmux/scripts/lib/alib.sh \
    '# Under bash this needs bash >= 5' 'fi'
  run python3 "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *"alib.sh"* ]]
  [[ "$output" == *"missing the \`bash >= 5\` assert"* ]]
}

@test "a sourced lib that re-execs instead of asserting blocks" {
  fixture_tree
  # exec from a sourced file replaces the CALLER's process - never right in a lib.
  printf '# --- bash5 re-exec preamble: wrong half of the contract\n' \
    >>.config/tmux/scripts/lib/alib.sh
  run python3 "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *"must assert, not re-exec"* ]]
}

@test "an sh-shebang script carrying the preamble blocks" {
  fixture_tree
  printf '# --- bash5 re-exec preamble: not for sh\n' >>.config/tmux/scripts/posix.sh
  run python3 "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *"posix.sh"* ]]
  [[ "$output" == *"must not carry the bash5 preamble"* ]]
}

@test "a non-executable bash script is not treated as an entry point" {
  fixture_tree
  # Only the exec bit makes a bash file an entry point; a plain data/helper file
  # dropped in the dir must not be forced to re-exec.
  printf '#!/usr/bin/env bash\necho hi\n' >.config/tmux/scripts/notexec.sh
  run python3 "$CHECK"
  [ "$status" -eq 0 ]
}

@test "an empty tree fails rather than silently passing" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p empty/.config/tmux/scripts && cd empty
  # Guards against the checker finding nothing and reporting success - the
  # failure mode a wrong path or a dir rename would produce.
  run python3 "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *"found no files to check"* ]]
}
