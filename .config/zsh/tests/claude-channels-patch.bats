#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CHANNELS_PATCH="$FUNCTIONS_DIR/claude/claude-channels-patch"
MARKER_REL=".cache/claude-channels-patch.stale"

setup() {
	setup_test_home
	mkdir -p "$HOME/.cache"
	NEEDLE='tengu_harbor",!1)'
	PATCHED='tengu_harbor",!0)'
}

@test "--reapply patches an unpatched bundle and clears the stale marker" {
	printf 'prefix %s suffix' "$NEEDLE" >"$HOME/claude"
	: >"$HOME/$MARKER_REL"

	run_zsh_function "$CHANNELS_PATCH" --reapply "$HOME/claude"

	[ "$status" -eq 0 ]
	[[ "$output" == *"patched:"* ]]
	grep -qF "$PATCHED" "$HOME/claude"
	[ ! -f "$HOME/$MARKER_REL" ]
}

@test "--reapply on an already-patched bundle is a no-op and clears the marker" {
	printf 'prefix %s suffix' "$PATCHED" >"$HOME/claude"
	: >"$HOME/$MARKER_REL"

	run_zsh_function "$CHANNELS_PATCH" --reapply "$HOME/claude"

	[ "$status" -eq 0 ]
	[[ "$output" == *"already patched"* ]]
	[ ! -f "$HOME/$MARKER_REL" ]
}

@test "--reapply re-patches after a --restore" {
	printf 'prefix %s suffix' "$NEEDLE" >"$HOME/claude"

	run_zsh_function "$CHANNELS_PATCH" --reapply "$HOME/claude"
	[ "$status" -eq 0 ]
	grep -qF "$PATCHED" "$HOME/claude"

	run_zsh_function "$CHANNELS_PATCH" --restore "$HOME/claude"
	[ "$status" -eq 0 ]
	grep -qF "$NEEDLE" "$HOME/claude"

	run_zsh_function "$CHANNELS_PATCH" --reapply "$HOME/claude"
	[ "$status" -eq 0 ]
	grep -qF "$PATCHED" "$HOME/claude"
}

@test "--reapply warns and writes a marker when the needle is gone, exiting 0" {
	printf 'prefix tengu_harbor_RENAMED suffix' >"$HOME/claude"

	run_zsh_function "$CHANNELS_PATCH" --reapply "$HOME/claude"

	[ "$status" -eq 0 ]
	[[ "$output" == *"NEEDLE NOT FOUND"* ]]
	[ -f "$HOME/$MARKER_REL" ]
	grep -qF "$HOME/claude" "$HOME/$MARKER_REL"
}
