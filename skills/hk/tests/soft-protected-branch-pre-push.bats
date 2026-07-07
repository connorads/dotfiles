#!/usr/bin/env bats

# Behavioural tests for assets/soft-protected-branch-pre-push.sh.
# Run: bats tests/   (from the skill root)

bats_require_minimum_version 1.5.0

setup() {
	SCRIPT="$BATS_TEST_DIRNAME/../assets/soft-protected-branch-pre-push.sh"
	[ -x "$SCRIPT" ] || skip "soft-protected-branch-pre-push.sh not executable"

	TEST_ROOT="$(mktemp -d)"
	REPO="$TEST_ROOT/repo"
	git init -q "$REPO"
	cd "$REPO"
}

teardown() {
	rm -rf "$TEST_ROOT"
}

invoke_hook() {
	printf '%s\n' "$1" | "$SCRIPT"
}

invoke_hook_with_override() {
	printf '%s\n' "$1" | HK_ALLOW_MAIN_PUSH=1 "$SCRIPT"
}

@test "allows pushes that do not target main or master" {
	run invoke_hook "refs/heads/feature 111 refs/heads/feature 222"
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "blocks pushes that target remote main" {
	run invoke_hook "refs/heads/feature 111 refs/heads/main 222"
	[ "$status" -eq 1 ]
	[[ "$output" == *"Direct push to a protected branch (main) is blocked."* ]]
	[[ "$output" == *"git config --local hooks.allowMainPush true"* ]]
}

@test "blocks pushes that target remote master" {
	run invoke_hook "refs/heads/feature 111 refs/heads/master 222"
	[ "$status" -eq 1 ]
	[[ "$output" == *"Direct push to a protected branch (master) is blocked."* ]]
}

@test "checks the remote ref, not the current branch" {
	git symbolic-ref HEAD refs/heads/main

	run invoke_hook "refs/heads/main 111 refs/heads/feature 222"
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "allows protected branch pushes when repo-local opt-out is true" {
	git config --local hooks.allowMainPush true

	run invoke_hook "refs/heads/feature 111 refs/heads/main 222"
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "does not allow protected branch pushes when repo-local opt-out is false" {
	git config --local hooks.allowMainPush false

	run invoke_hook "refs/heads/feature 111 refs/heads/main 222"
	[ "$status" -eq 1 ]
	[[ "$output" == *"Direct push to a protected branch (main) is blocked."* ]]
}

@test "allows protected branch pushes with the one-off environment override" {
	run invoke_hook_with_override "refs/heads/feature 111 refs/heads/main 222"
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}
