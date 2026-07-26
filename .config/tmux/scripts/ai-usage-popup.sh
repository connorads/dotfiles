#!/usr/bin/env sh
# Cache-first AI usage popup: dismiss never waits for provider refreshes.

ai_usage="$HOME/.local/bin/ai-usage"
refresh_pid=""
key_file=""
old_tty_state=""

snapshot_usage_cache() {
	for cache_file in \
		"$HOME/.cache/claude-usage"*.json \
		"$HOME/.cache/codex-usage"*.json \
		"$HOME/.cache/cosine-usage"*.json; do
		[ -f "$cache_file" ] || continue
		stat -f '%N:%m:%z' "$cache_file" 2>/dev/null ||
			stat -c '%n:%Y:%s' "$cache_file" 2>/dev/null || true
	done | sort
}

start_refresh() {
	nohup "$ai_usage" --refresh-only </dev/null >/dev/null 2>&1 &
	refresh_pid=$!
}

cleanup() {
	[ -z "$old_tty_state" ] || stty "$old_tty_state" 2>/dev/null || true
	printf '\033[?25h'
	tput rmcup 2>/dev/null || true
	[ -z "$key_file" ] || rm -f "$key_file"
}

if ! [ -t 0 ] || ! [ -t 1 ]; then
	"$ai_usage" --fancy
	exit $?
fi

trap cleanup EXIT
trap 'exit 130' INT TERM HUP

old_tty_state=$(stty -g 2>/dev/null || true)
key_file=$(mktemp "${TMPDIR:-/tmp}/ai-usage-popup.XXXXXX") || exit 1
tput smcup 2>/dev/null || true
printf '\033[?25l\033[H\033[2J'

"$ai_usage" --cache-only || true
before_refresh=$(snapshot_usage_cache)
start_refresh

# Non-canonical reads with VTIME=1 make dismissal latency at most 100 ms while
# leaving the refresh detached from the popup's terminal and lifecycle.
stty -icanon -echo min 0 time 1 2>/dev/null || true
while kill -0 "$refresh_pid" 2>/dev/null; do
	: >"$key_file"
	dd bs=1 count=1 of="$key_file" 2>/dev/null || true
	[ ! -s "$key_file" ] || exit 0
done
wait "$refresh_pid" 2>/dev/null || true

after_refresh=$(snapshot_usage_cache)
if [ "$after_refresh" != "$before_refresh" ]; then
	printf '\033[H\033[2J'
	"$ai_usage" --cache-only || true
fi

# Refresh is complete. Keep the result visible until the next key.
stty -icanon -echo min 1 time 0 2>/dev/null || true
dd bs=1 count=1 of=/dev/null 2>/dev/null || true
