#!/usr/bin/env bash
# copy-pane-info.sh: yank a pane's identity (id · tty · cmd · cwd) to the client
# clipboard (OSC52, works over SSH) plus the tmux buffer (prefix + Y). Fields are
# passed as argv from the binding so tmux expands the formats, not set-buffer
# (whose data arg is taken literally and would store the raw #{...} template).
#
# Usage: copy-pane-info.sh <pane_id> <pane_tty> <pane_current_command> <pane_current_path>
set -euo pipefail

pane_id="${1:?pane_id required}"
pane_tty="${2:-}"
pane_cmd="${3:-}"
pane_path="${4:-}"

info="$pane_id  tty=$pane_tty  cmd=$pane_cmd  $pane_path"

# tmux buffer (+ -w clipboard where the terminal honours set-clipboard)...
printf '%s' "$info" | tmux load-buffer -w -
# ...and OSC52 to the client tty, the reliable path over SSH (same as copy-mode).
printf '%s' "$info" | "$(dirname "${BASH_SOURCE[0]}")/osc52-copy-to-client.sh"

tmux display-message "Copied $pane_id · $pane_path"
