#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CLEAR_PATCH="$FUNCTIONS_DIR/claude/claude-telegram-clear-patch"
MARKER_REL=".cache/claude-telegram-clear-patch.stale"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache"
  SERVER="$HOME/server.ts"
}

# Minimal stand-in for the plugin's server.ts: carries the insertion anchor and
# the command-menu line the patch keys off.
make_fixture() {
  cat >"$SERVER" <<'TS'
bot.command('status', async ctx => {})

void bot.api.setMyCommands(
  [
    { command: 'start', description: 'Welcome and setup guide' },
    { command: 'help', description: 'What this bot can do' },
    { command: 'status', description: 'Check your pairing status' },
  ],
  { scope: { type: 'all_private_chats' } },
)

// Inline-button handler for permission requests. Callback data is
bot.on('callback_query:data', async ctx => {})
TS
}

@test "--check reports unpatched then patched" {
  make_fixture

  run_zsh_function "$CLEAR_PATCH" --check "$SERVER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"unpatched:"* ]]

  run_zsh_function "$CLEAR_PATCH" "$SERVER"
  [ "$status" -eq 0 ]

  run_zsh_function "$CLEAR_PATCH" --check "$SERVER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"patched:"* ]]
}

@test "patch inserts the handler and menu entry and backs up the original" {
  make_fixture

  run_zsh_function "$CLEAR_PATCH" "$SERVER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"patched:"* ]]

  grep -qF "bot.command('clear'" "$SERVER"
  grep -qF "process.env.TMUX_PANE" "$SERVER"
  grep -qF "command: 'clear'" "$SERVER"
  [ -f "$SERVER.unpatched" ]
  ! grep -qF "bot.command('clear'" "$SERVER.unpatched"
}

@test "patch is idempotent" {
  make_fixture

  run_zsh_function "$CLEAR_PATCH" "$SERVER"
  [ "$status" -eq 0 ]

  run_zsh_function "$CLEAR_PATCH" "$SERVER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"already patched"* ]]

  # Exactly one handler even after a second run.
  [ "$(grep -cF "bot.command('clear'" "$SERVER")" -eq 1 ]
}

@test "--restore reverts to the original" {
  make_fixture

  run_zsh_function "$CLEAR_PATCH" "$SERVER"
  [ "$status" -eq 0 ]
  grep -qF "bot.command('clear'" "$SERVER"

  run_zsh_function "$CLEAR_PATCH" --restore "$SERVER"
  [ "$status" -eq 0 ]
  ! grep -qF "bot.command('clear'" "$SERVER"
}

@test "--reapply patches unpatched, no-ops when patched, clears the marker" {
  make_fixture
  : >"$HOME/$MARKER_REL"

  run_zsh_function "$CLEAR_PATCH" --reapply "$SERVER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"patched:"* ]]
  [ ! -f "$HOME/$MARKER_REL" ]

  run_zsh_function "$CLEAR_PATCH" --reapply "$SERVER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"already patched"* ]]
}

@test "--reapply warns and writes a marker when the anchor is gone, exiting 0" {
  printf 'no anchor here\n' >"$SERVER"

  run_zsh_function "$CLEAR_PATCH" --reapply "$SERVER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ANCHOR NOT FOUND"* ]]
  [ -f "$HOME/$MARKER_REL" ]
  grep -qF "$SERVER" "$HOME/$MARKER_REL"
}

@test "--reapply is a benign no-op when the plugin is not installed" {
  run_zsh_function "$CLEAR_PATCH" --reapply
  [ "$status" -eq 0 ]
}
