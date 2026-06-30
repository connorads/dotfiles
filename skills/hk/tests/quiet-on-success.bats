#!/usr/bin/env bats

# Behavioural tests for assets/quiet-on-success.sh — the tier-3 noise suppressor.
# Test by public behaviour only: args, exit status, stdout/stderr. The script's
# "footguns" (stderr→stdout merge, buffering, colour loss) are intentional for its
# role, so they are pinned here as expected behaviour, not treated as bugs.
# Run: bats tests/   (from the skill root)

bats_require_minimum_version 1.5.0

setup() {
	SCRIPT="$BATS_TEST_DIRNAME/../assets/quiet-on-success.sh"
	[ -x "$SCRIPT" ] || skip "quiet-on-success.sh not executable"
}

@test "success is silent: exit 0 with stdout emits nothing" {
	run "$SCRIPT" sh -c 'echo hello; exit 0'
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "success with stderr is silent: exit 0 writing stderr emits nothing" {
	run "$SCRIPT" sh -c 'echo oops >&2; exit 0'
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "failure surfaces output: non-zero with stdout reprints it" {
	run "$SCRIPT" sh -c 'echo boom; exit 1'
	[ "$status" -eq 1 ]
	[ "$output" = "boom" ]
}

@test "failure surfaces stderr: stderr-only output appears (2>&1 merge is intentional)" {
	run "$SCRIPT" sh -c 'echo erronly >&2; exit 1'
	[ "$status" -eq 1 ]
	[ "$output" = "erronly" ]
}

@test "exit code is preserved exactly" {
	run "$SCRIPT" sh -c 'exit 42'
	[ "$status" -eq 42 ]
	[ -z "$output" ]
}

@test "failure output goes to stdout, not stderr (printf to stdout)" {
	run --separate-stderr "$SCRIPT" sh -c 'echo boom; exit 1'
	[ "$status" -eq 1 ]
	[ "$output" = "boom" ]
	[ -z "$stderr" ]
}

@test "multi-line failure output is preserved" {
	run "$SCRIPT" sh -c 'printf "line1\nline2\n"; exit 1'
	[ "$status" -eq 1 ]
	[ "${lines[0]}" = "line1" ]
	[ "${lines[1]}" = "line2" ]
}

@test "no args: empty command runs as a silent no-op, exit 0" {
	run "$SCRIPT"
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}
