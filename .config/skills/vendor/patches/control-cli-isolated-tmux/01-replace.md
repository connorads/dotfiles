{{marker}}
Run every tmux command against a throwaway server (`-L`) so the harness can never touch the user's live tmux sessions.

```bash
SOCK="cli-harness-$(date +%s)"
SESSION="$SOCK"
tmux -L "$SOCK" -f /dev/null new-session -d -s "$SESSION" -- <command-under-test>
tmux -L "$SOCK" capture-pane -pt "$SESSION"
tmux -L "$SOCK" send-keys -t "$SESSION" "help" Enter
tmux -L "$SOCK" capture-pane -pt "$SESSION"
tmux -L "$SOCK" kill-server
```

For Node CLIs:

```bash
NODE_OPTIONS="--inspect=127.0.0.1:0" tmux -L "$SOCK" -f /dev/null new-session -d -s "$SESSION" -- <node-cli-command>
```
