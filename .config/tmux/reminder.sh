#!/usr/bin/env sh
# reminder.sh: show tmux reminder message
set -eu

reminder_file="${TMUX_REMINDER_FILE:-$HOME/.tmux-reminder}"

[ -f "$reminder_file" ] || exit 0

msg=""
IFS= read -r msg < "$reminder_file" || true
[ -n "$msg" ] || exit 0

banner=$(cat <<'EOF'
 ____  _____ __  __ ___ _   _ ____  _____ ____
|  _ \| ____|  \/  |_ _| \ | |  _ \| ____|  _ \
| |_) |  _| | |\/| || ||  \| | | | |  _| | |_) |
|  _ <| |___| |  | || || |\  | |_| | |___|  _ <
|_| \_\_____|_|  |_|___|_| \_|____/|_____|_| \_\
EOF
)

tmp="$(mktemp -t tmux-reminder.XXXXXX)"
{
  printf '%s\n\n' "$banner"
  cat "$reminder_file"
  printf '\n\nPress Enter to close'
} > "$tmp"

# Try popup (tmux 3.2+); fall back to status message.
if tmux display-popup -E -h 60% -w 90% "sh -c 'cat \"$tmp\"; read -r _'" 2>/dev/null; then
  rm -f "$tmp"
  exit 0
fi

rm -f "$tmp"
tmux display-message -d 15000 "REMINDER: $msg"
