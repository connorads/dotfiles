#!/usr/bin/env bats
#
# The Connorads Vale style's proof of life.
#
# Two of its three rules have zero hits in this corpus, so a clean `vale` run
# over the tree says nothing about whether they load. Worse, Vale's extension
# points default to `level: warning` and ~/.vale.ini sets MinAlertLevel = error,
# so a rule that loses its `level: error` line becomes a silent no-op rather
# than an error. These fixtures are the only thing between a working ratchet and
# a dead one, so they run against the REAL ~/.vale.ini and the REAL style dir -
# an isolated $HOME would test a copy nothing gates on.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CONFIG="$REAL_HOME/.vale.ini"

setup() {
  if ! command -v vale >/dev/null 2>&1; then
    skip "vale not installed"
  fi
  FIXTURE="$BATS_TEST_TMPDIR/fixture.md"
}

# Lint a fixture through the deployed config. --no-global matches the hk step,
# so the global styles dir cannot mask a broken tracked style.
lint() {
  printf '%s\n' "$1" >"$FIXTURE"
  run vale --no-global --config "$CONFIG" --output=line "$FIXTURE"
}

@test "config loads the Connorads style" {
  run vale --no-global --config "$CONFIG" ls-config
  [ "$status" -eq 0 ]
  [[ $output == *Connorads* ]]
}

@test "Dashes flags an em dash in prose" {
  lint 'The gate blocks the commit — that is the point.'
  [ "$status" -eq 1 ]
  [[ $output == *Connorads.Dashes* ]]
}

@test "Dashes flags an en dash in prose" {
  lint 'The window is 10 – 15 minutes.'
  [ "$status" -eq 1 ]
  [[ $output == *Connorads.Dashes* ]]
}

@test "Dashes ignores a dash inside a code span" {
  lint 'The log line is `foreground is not Claude — skipping` verbatim.'
  [ "$status" -eq 0 ]
}

@test "Dashes ignores a dash inside a fenced block" {
  printf '%s\n' 'Prose with no dash.' '' '```text' 'tree — diagram' '```' >"$FIXTURE"
  run vale --no-global --config "$CONFIG" --output=line "$FIXTURE"
  [ "$status" -eq 0 ]
}

@test "PlainWord flags a long word with a short replacement" {
  lint 'We utilize the lockfile to pin every tool.'
  [ "$status" -eq 1 ]
  [[ $output == *Connorads.PlainWord* ]]
}

@test "PlainWord flags a padded phrase" {
  lint 'The step runs in order to catch the drift.'
  [ "$status" -eq 1 ]
  [[ $output == *Connorads.PlainWord* ]]
}

@test "Spellings flags a miscapitalised product name" {
  lint 'Push the branch to Github and open a PR.'
  [ "$status" -eq 1 ]
  [[ $output == *Connorads.Spellings* ]]
}

@test "Spellings accepts the correct capitalisation" {
  lint 'Push the branch to GitHub and open a PR, in TypeScript or JavaScript.'
  [ "$status" -eq 0 ]
}

@test "house prose passes clean" {
  lint 'Commit on the current branch by default - do not branch first unless asked.'
  [ "$status" -eq 0 ]
}
