#!/bin/bash
set -euo pipefail

# Optional firewall
[[ "${AGENTBOX_FIREWALL:-0}" == "1" ]] && sudo /usr/local/bin/init-firewall.sh

# Start tmux session with agent command or shell
if [[ -n "${AGENTBOX_CMD:-}" ]]; then
  tmux new-session -d -s main -x 200 -y 50 "$AGENTBOX_CMD"
else
  tmux new-session -d -s main -x 200 -y 50
fi

# Keep container alive while tmux runs
exec sleep infinity
