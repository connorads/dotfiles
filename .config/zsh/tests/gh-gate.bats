#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

GH_GATE="$FUNCTIONS_DIR/git/gh-gate"

setup() {
	setup_test_home
	export FZF_RESPONSES="$BATS_TEST_TMPDIR/fzf-responses"
	export FZF_INPUT_LOG="$BATS_TEST_TMPDIR/fzf-input.log"
	export GH_GATE_LOG="$BATS_TEST_TMPDIR/gh-gate.log"
	: >"$FZF_RESPONSES"
	: >"$FZF_INPUT_LOG"
	: >"$GH_GATE_LOG"

	mkdir -p "$HOME/.ssh"
	cat >"$HOME/.ssh/config" <<'EOF'
Host *
    ServerAliveInterval 30

Host dev dev-agent
    HostName dev.example

Host mini
    HostName mini.example

Host !negated
    HostName ignored.example
EOF

	write_stub fzf <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

input=$(cat)
{
  printf '%s\n' '--- fzf call ---'
  printf '%s\n' "$input"
} >> "$FZF_INPUT_LOG"

line=$(head -n 1 "$FZF_RESPONSES" 2>/dev/null || true)
tail -n +2 "$FZF_RESPONSES" > "$FZF_RESPONSES.tmp" 2>/dev/null || true
mv "$FZF_RESPONSES.tmp" "$FZF_RESPONSES"

case "$line" in
  exit:*) exit "${line#exit:}" ;;
  out:*) printf '%s\n' "${line#out:}" ;;
  *) exit 1 ;;
esac
EOF

	write_stub gh-gate-mutation <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GH_GATE_LOG"
printf 'ran gh-gate %s\n' "$*"
EOF
	export GH_GATE_COMMAND="$TEST_BIN/gh-gate-mutation"
}

run_gh_gate_ui() {
	local answer=${1:-}
	run bash -c 'printf "%s\n" "$1" | zsh --no-rcs "$2" ui' _ "$answer" "$GH_GATE"
}

@test "ui reports missing fzf before doing anything else" {
	rm -f "$TEST_BIN/fzf"

	run_zsh_function "$GH_GATE" ui

	[ "$status" -eq 1 ]
	[[ "$output" == *"Error: fzf required"* ]]
}

@test "ui errors clearly when ssh config has no hosts" {
	: >"$HOME/.ssh/config"

	run_zsh_function "$GH_GATE" ui

	[ "$status" -eq 1 ]
	[[ "$output" == *"Error: no SSH hosts found in ~/.ssh/config"* ]]
}

@test "ui lists non-wildcard ssh config hosts" {
	{
		printf 'out:dev-agent\n'
		printf 'out:grant\tGrant 1-hour write access\n'
	} >"$FZF_RESPONSES"

	run_gh_gate_ui y

	[ "$status" -eq 0 ]
	grep -q '^dev$' "$FZF_INPUT_LOG"
	grep -q '^dev-agent$' "$FZF_INPUT_LOG"
	grep -q '^mini$' "$FZF_INPUT_LOG"
	! grep -q '^\*$' "$FZF_INPUT_LOG"
	! grep -q '^!negated$' "$FZF_INPUT_LOG"
}

@test "ui cancels when target picker is cancelled" {
	printf 'exit:130\n' >"$FZF_RESPONSES"

	run_gh_gate_ui y

	[ "$status" -eq 130 ]
	[ ! -s "$GH_GATE_LOG" ]
}

@test "ui cancels when confirmation is not yes" {
	{
		printf 'out:dev\n'
		printf 'out:grant\tGrant 1-hour write access\n'
	} >"$FZF_RESPONSES"

	run_gh_gate_ui n

	[ "$status" -eq 130 ]
	[[ "$output" == *"Command: gh-gate grant dev"* ]]
	[[ "$output" == *"Cancelled"* ]]
	[ ! -s "$GH_GATE_LOG" ]
}

@test "ui confirms and runs grant for the selected host" {
	{
		printf 'out:dev\n'
		printf 'out:grant\tGrant 1-hour write access\n'
	} >"$FZF_RESPONSES"

	run_gh_gate_ui y

	[ "$status" -eq 0 ]
	[[ "$output" == *"Command: gh-gate grant dev"* ]]
	[ "$(cat "$GH_GATE_LOG")" = "grant dev" ]
}

@test "ui confirms and runs revoke for the selected host" {
	{
		printf 'out:mini\n'
		printf 'out:revoke\tRevoke write access and restore read-only\n'
	} >"$FZF_RESPONSES"

	run_gh_gate_ui y

	[ "$status" -eq 0 ]
	[[ "$output" == *"Command: gh-gate revoke mini"* ]]
	[ "$(cat "$GH_GATE_LOG")" = "revoke mini" ]
}
