#!/bin/sh
# fix-ssh-agent: repoint ~/.ssh/agent.sock to the newest live forwarded socket
# Called by tmux client-attached hook and Ctrl+b F keybinding

STABLE="$HOME/.ssh/agent.sock"
best=""
best_mtime=0

for sock in /tmp/ssh-*/agent.*; do
  [ -S "$sock" ] || continue
  # skip the stable symlink itself
  [ "$sock" = "$STABLE" ] && continue
  # check the socket is actually alive
  SSH_AUTH_SOCK="$sock" ssh-add -l >/dev/null 2>&1 || continue
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
