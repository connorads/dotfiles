#!/usr/bin/env sh

if [ -t 0 ] && [ -t 1 ]; then
	cleanup() {
		printf '\033[?25h'
		tput rmcup 2>/dev/null || true
		if [ -n "${old_tty_state:-}" ]; then
			stty "$old_tty_state" 2>/dev/null || true
		fi
	}
	trap cleanup EXIT INT TERM HUP

	old_tty_state=$(stty -g 2>/dev/null || true)
	tput smcup 2>/dev/null || true
	printf '\033[?25l\033[H\033[2J'
	"$HOME/.local/bin/ai-usage" --fancy
	stty raw -echo min 1 time 0 2>/dev/null || true
	dd bs=1 count=1 >/dev/null 2>&1 || true
else
	"$HOME/.local/bin/ai-usage" --fancy
fi
