#!/bin/sh
set -eu

target_tty="$(tmux display-message -p '#{client_tty}' 2>/dev/null || true)"
[ -n "$target_tty" ] || exit 0

encoded="$(base64 | tr -d '\n')"
[ -n "$encoded" ] || exit 0

printf '\033]52;c;%s\a' "$encoded" >"$target_tty"
