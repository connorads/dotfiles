#!/bin/sh
# fix-ssh-agent: repoint ~/.ssh/agent.sock to the newest live forwarded socket
# Called by the tmux client-attached hook

STABLE="$HOME/.ssh/agent.sock"
best=""
best_mtime=0

for sock in /tmp/ssh-*/agent.* "$HOME"/.ssh/agent/s.* "$HOME"/.bitwarden-ssh-agent.sock; do
	[ -S "$sock" ] || continue
	# skip the stable symlink itself
	[ "$sock" = "$STABLE" ] && continue
	# check the socket is actually alive; a dead forwarded socket can hang
	# ssh-add indefinitely, so bound the probe (status-right.sh does the same)
	if command -v timeout >/dev/null 2>&1; then
		SSH_AUTH_SOCK="$sock" timeout 1 ssh-add -l >/dev/null 2>&1 || continue
	else
		SSH_AUTH_SOCK="$sock" ssh-add -l >/dev/null 2>&1 || continue
	fi
	mtime=$(stat -c %Y "$sock" 2>/dev/null || stat -f %m "$sock" 2>/dev/null) || continue
	if [ "$mtime" -gt "$best_mtime" ]; then
		best_mtime="$mtime"
		best="$sock"
	fi
done

[ -z "$best" ] && exit 0

# only relink if the target changed
current=$(readlink "$STABLE" 2>/dev/null)
if [ "$current" != "$best" ]; then
	mkdir -p "$(dirname "$STABLE")"
	ln -sf "$best" "$STABLE"
fi
