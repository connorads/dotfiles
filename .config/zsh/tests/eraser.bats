#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

ERASER="$FUNCTIONS_DIR/shell/eraser"

setup() {
  setup_test_home
  # The CLI stubbed as an argv recorder. The contract under test is what the
  # wrapper hands the CLI, so nothing here needs a browser or the network.
  write_stub eraser-diagrams <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$TEST_LOG"
printf 'CHROMIUM_PATH=%s\n' "${CHROMIUM_PATH-<unset>}" >>"$TEST_LOG"
EOF
}

argv() {
  run_zsh_function "$ERASER" "$@"
}

# The recorded argv, one element per line, so a test asserts on exact adjacency
# rather than a substring of a joined string.
recorded() {
  cat "$TEST_LOG"
}

@test "injects --no-config immediately after the subcommand" {
  argv render diagram.json -o out.png
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$TEST_LOG")" = "render" ]
  [ "$(sed -n 2p "$TEST_LOG")" = "--no-config" ]
  [ "$(sed -n 3p "$TEST_LOG")" = "diagram.json" ]
}

# The flag must not be appended: inputs beginning with `-` are passed after
# `--`, so a trailing --no-config would arrive as a positional input file.
@test "injects before -- so the flag never lands in the input list" {
  argv render -- -weird-name.json
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$TEST_LOG")" = "render" ]
  [ "$(sed -n 2p "$TEST_LOG")" = "--no-config" ]
  [ "$(sed -n 3p "$TEST_LOG")" = "--" ]
  [ "$(sed -n 4p "$TEST_LOG")" = "-weird-name.json" ]
}

@test "injects for every config-reading subcommand, validate included" {
  local cmd
  for cmd in render validate registry schema init; do
    argv "$cmd"
    [ "$status" -eq 0 ]
    [ "$(sed -n 1p "$TEST_LOG")" = "$cmd" ]
    [ "$(sed -n 2p "$TEST_LOG")" = "--no-config" ]
  done
}

@test "leaves an explicit -c alone rather than conflicting with it" {
  argv render -c ./mine.json diagram.json
  [ "$status" -eq 0 ]
  ! grep -qx -- '--no-config' "$TEST_LOG"
}

@test "leaves an explicit --config= alone" {
  argv validate --config=./mine.json diagram.json
  [ "$status" -eq 0 ]
  ! grep -qx -- '--no-config' "$TEST_LOG"
}

@test "does not double up when the caller already passed --no-config" {
  argv render --no-config diagram.json
  [ "$status" -eq 0 ]
  [ "$(grep -cx -- '--no-config' "$TEST_LOG")" -eq 1 ]
}

@test "ERASER_ALLOW_CONFIG=1 restores config discovery" {
  ERASER_ALLOW_CONFIG=1 run_zsh_function "$ERASER" render diagram.json
  [ "$status" -eq 0 ]
  ! grep -qx -- '--no-config' "$TEST_LOG"
}

# A `--config` appearing after `--` is an input filename, not a flag, so it must
# not suppress the injection.
@test "a --config after -- is an input name and does not suppress injection" {
  argv render -- --config
  [ "$status" -eq 0 ]
  [ "$(sed -n 2p "$TEST_LOG")" = "--no-config" ]
}

@test "passes --version through untouched, with no subcommand to inject after" {
  argv --version
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$TEST_LOG")" = "--version" ]
  ! grep -qx -- '--no-config' "$TEST_LOG"
}

@test "passes --help through untouched" {
  argv --help
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$TEST_LOG")" = "--help" ]
  ! grep -qx -- '--no-config' "$TEST_LOG"
}

@test "an unknown first word is forwarded for the CLI to reject" {
  argv frobnicate
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$TEST_LOG")" = "frobnicate" ]
  ! grep -qx -- '--no-config' "$TEST_LOG"
}

@test "exits 127 with an install hint when the CLI is absent" {
  rm -f "$TEST_BIN/eraser-diagrams"
  run -127 zsh --no-rcs "$ERASER" render diagram.json
  [[ "$output" == *"not found on PATH"* ]]
  [[ "$output" == *"npm:@eraserlabs/diagrams-cli"* ]]
}

@test "pins CHROMIUM_PATH to the highest Playwright revision present" {
  local pw="$TEST_HOME/Library/Caches/ms-playwright"
  local rev
  # Deliberately out of lexical order: chromium-1099 sorts after chromium-1237
  # as a string, so a name sort would pick the wrong one.
  for rev in 1099 1237; do
    mkdir -p "$pw/chromium-$rev/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS"
    write_executable \
      "$pw/chromium-$rev/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
      <<<'#!/usr/bin/env bash'
  done
  argv render diagram.json
  [ "$status" -eq 0 ]
  grep -q "CHROMIUM_PATH=.*chromium-1237.*Google Chrome for Testing$" "$TEST_LOG"
}

# The revision is a number, not a string: a lexical sort puts chromium-999
# above chromium-1000, and keying a hyphen-split of the path lands on
# `ms-playwright` rather than the revision at all.
@test "picks the highest revision numerically, not lexically" {
  local pw="$TEST_HOME/Library/Caches/ms-playwright"
  local rev
  for rev in 999 1000; do
    mkdir -p "$pw/chromium-$rev/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS"
    write_executable \
      "$pw/chromium-$rev/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
      <<<'#!/usr/bin/env bash'
  done
  argv render diagram.json
  [ "$status" -eq 0 ]
  grep -q "CHROMIUM_PATH=.*chromium-1000/" "$TEST_LOG"
}

@test "the headless shell dir is not mistaken for a chromium revision" {
  local pw="$TEST_HOME/Library/Caches/ms-playwright"
  mkdir -p "$pw/chromium_headless_shell-9999/chrome-mac-arm64"
  mkdir -p "$pw/chromium-1000/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS"
  write_executable \
    "$pw/chromium-1000/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
    <<<'#!/usr/bin/env bash'
  argv render diagram.json
  [ "$status" -eq 0 ]
  grep -q "CHROMIUM_PATH=.*chromium-1000" "$TEST_LOG"
}

@test "an existing CHROMIUM_PATH is left untouched" {
  CHROMIUM_PATH=/somewhere/mine run_zsh_function "$ERASER" render diagram.json
  [ "$status" -eq 0 ]
  grep -qx 'CHROMIUM_PATH=/somewhere/mine' "$TEST_LOG"
}

# No Chromium anywhere: the wrapper must still run so the browser-free
# subcommands work, and so the CLI reports the missing browser itself.
#
# The system fallbacks are absolute paths outside $HOME, so setup_test_home
# cannot hide them - this asserts the no-browser path only on a host that has
# none. Skipped rather than deleted so it still covers CI and bare Linux.
@test "runs without CHROMIUM_PATH when no Chromium is found" {
  local candidate
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    /usr/bin/chromium \
    /usr/bin/chromium-browser \
    /usr/bin/google-chrome; do
    [ -x "$candidate" ] && skip "a system Chromium exists at $candidate"
  done
  argv validate diagram.json
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$TEST_LOG")" = "validate" ]
  grep -qx 'CHROMIUM_PATH=<unset>' "$TEST_LOG"
}
