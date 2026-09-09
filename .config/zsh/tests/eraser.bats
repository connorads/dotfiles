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

# The orientation block is half the contract here: asserting only the
# passthrough would keep passing if the block were deleted.
@test "passes --help through untouched, behind the orientation block" {
  argv --help
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$TEST_LOG")" = "--help" ]
  ! grep -qx -- '--no-config' "$TEST_LOG"
  [[ "$output" == *"no auto-layout"* ]]
  [[ "$output" == *"eraser icons"* ]]
  [[ "$output" == *"skl eraser-diagrams"* ]]
}

@test "a subcommand's own --help gets no orientation block" {
  argv render --help
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$TEST_LOG")" = "render" ]
  [[ "$output" != *"no auto-layout"* ]]
}

@test "an unknown first word is forwarded for the CLI to reject" {
  argv frobnicate
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$TEST_LOG")" = "frobnicate" ]
  ! grep -qx -- '--no-config' "$TEST_LOG"
}

# --- icons -----------------------------------------------------------------
#
# The catalogue is a GCS bucket listing, so every case here drives the indexed
# `curl` stub: page N of the fixture is served on the Nth call, and an index
# left unset falls through to the stub's default (exit 7) to stand for a dead
# network.

ICON_CACHE_REL=".cache/eraser/icon-names.txt"

# A GCS listing page: nextPageToken (empty = last page) then object names,
# each relative to the canvas-icons/ prefix. Prints the file path.
page_file() {
  local path="$BATS_TEST_TMPDIR/page-$1.json"
  local token=$2
  shift 2

  {
    printf '{'
    if [ -n "$token" ]; then printf '"nextPageToken":"%s",' "$token"; fi
    printf '"items":['
    local first=1 name
    for name in "$@"; do
      if [ "$first" -eq 0 ]; then printf ','; fi
      first=0
      printf '{"name":"canvas-icons/%s"}' "$name"
    done
    printf ']}'
  } >"$path"
  printf '%s' "$path"
}

# Serve $2.. as the single page returned by curl call $1.
serve_page() {
  local n=$1
  shift
  export "CURL_${n}_KIND=stdout"
  export "CURL_${n}_OUT=$(page_file "$n" "" "$@")"
}

curl_calls() {
  cat "$CURL_STATE" 2>/dev/null || echo 0
}

@test "icons fetches the catalogue and caches it" {
  write_curl_stub
  serve_page 1 aws-s3.svg postgresql.svg
  argv icons
  [ "$status" -eq 0 ]
  [ "$output" = "aws-s3
postgresql" ]
  [ "$(cat "$TEST_HOME/$ICON_CACHE_REL")" = "aws-s3
postgresql" ]
}

@test "icons is answered from the cache without touching the network" {
  write_curl_stub
  serve_page 1 aws-s3.svg
  argv icons
  [ "$status" -eq 0 ]
  [ "$(curl_calls)" -eq 1 ]

  argv icons
  [ "$status" -eq 0 ]
  [ "$output" = "aws-s3" ]
  [ "$(curl_calls)" -eq 1 ]
}

@test "icons --refresh refetches over a warm cache" {
  write_curl_stub
  serve_page 1 aws-s3.svg
  serve_page 2 postgresql.svg
  argv icons
  [ "$status" -eq 0 ]

  argv icons --refresh
  [ "$status" -eq 0 ]
  [ "$output" = "postgresql" ]
  [ "$(curl_calls)" -eq 2 ]
}

# The renderer's loader rejects anything outside /^[a-z0-9][a-z0-9-]*$/, so a
# listed object it cannot fetch must never reach the cache.
@test "icons drops names the renderer's loader would reject" {
  write_curl_stub
  serve_page 1 "" aws-s3.svg Azure-arc.svg "my icon.svg" snake_case.svg -leading.svg readme.txt
  argv icons
  [ "$status" -eq 0 ]
  [ "$output" = "aws-s3" ]
}

@test "icons follows nextPageToken to the end of the listing" {
  write_curl_stub
  export CURL_1_KIND=stdout
  export CURL_1_OUT="$(page_file 1 tok-a aws-s3.svg)"
  export CURL_2_KIND=stdout
  export CURL_2_OUT="$(page_file 2 tok-b postgresql.svg)"
  serve_page 3 redis.svg
  argv icons
  [ "$status" -eq 0 ]
  [ "$output" = "aws-s3
postgresql
redis" ]
  [ "$(curl_calls)" -eq 3 ]
}

@test "icons matches a pattern as an unanchored case-insensitive regex" {
  write_curl_stub
  serve_page 1 aws-s3.svg aws-s3-glacier.svg postgresql.svg
  argv icons POSTGRES
  [ "$status" -eq 0 ]
  [ "$output" = "postgresql" ]
}

@test "icons honours an anchored pattern" {
  write_curl_stub
  serve_page 1 aws-s3.svg gcp-aws-s3.svg
  argv icons '^aws-s3$'
  [ "$status" -eq 0 ]
  [ "$output" = "aws-s3" ]
}

@test "icons exits 1 with no output when nothing matches" {
  write_curl_stub
  serve_page 1 aws-s3.svg
  argv icons zzz-nothing
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "icons rejects a second pattern" {
  write_curl_stub
  argv icons one two
  [ "$status" -eq 2 ]
  [[ "$output" == *"at most one pattern"* ]]
}

@test "icons serves a stale cache when the fetch fails, and says so" {
  write_curl_stub
  mkdir -p "$TEST_HOME/.cache/eraser"
  printf 'aws-s3\n' >"$TEST_HOME/$ICON_CACHE_REL"
  touch -t 202001010000 "$TEST_HOME/$ICON_CACHE_REL"

  argv icons
  [ "$status" -eq 0 ]
  [[ "$output" == *"could not refresh"* ]]
  [[ "$output" == *"aws-s3"* ]]
  [ "$(cat "$TEST_HOME/$ICON_CACHE_REL")" = "aws-s3" ]
}

@test "icons exits 3 when the fetch fails and there is no cache" {
  write_curl_stub
  argv icons
  [ "$status" -eq 3 ]
  [[ "$output" == *"no icon catalogue available"* ]]
}

@test "icons is never forwarded to the CLI" {
  write_curl_stub
  serve_page 1 aws-s3.svg
  argv icons
  [ "$status" -eq 0 ]
  [ ! -s "$TEST_LOG" ]
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
