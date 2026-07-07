---
name: tmux
description: Control interactive CLIs and TUIs via tmux sessions - safely target panes, send keystrokes, scrape output, and operate modal prompts with observe-before-commit guardrails.
---

# tmux Skill

Use tmux to control interactive terminal applications by sending keystrokes and capturing output.

## When to Use

- Running interactive REPLs (python, node, psql)
- Debugging with gdb/lldb
- Any CLI that requires TTY interaction
- Remote execution where you need to observe output

## Safety Model

Do not treat a terminal UI as a command API. TUIs are stateful and modal: visible labels, numbered rows, highlighted options, and default buttons are evidence, not a stable protocol.

For unfamiliar interactive programs, use this loop:

1. Capture the pane.
2. Classify the UI state and current focus.
3. Send one navigation, editing, or mode-changing action.
4. Capture again.
5. Send committing keys only after the capture confirms the intended state.

Never combine selection and confirmation in one tmux command for an unfamiliar TUI.

## Core Pattern

```bash
# Create session
tmux new-session -d -s "$SESSION" -x 120 -y 40

# Send commands
tmux send-keys -t "$SESSION" "python3" Enter

# Capture output
tmux capture-pane -t "$SESSION" -p

# Wait for prompt (poll)
for i in {1..30}; do
  output=$(tmux capture-pane -t "$SESSION" -p)
  if echo "$output" | grep -q ">>>"; then break; fi
  sleep 0.5
done

# Cleanup
tmux kill-session -t "$SESSION"
```

## Key Risk Classes

- Low risk: `capture-pane`, `list-panes`, `list-sessions`, read-only probes.
- Navigation/editing: arrows, `Tab`, `BTab`, `Escape`, page keys, literal text input.
- Control: `C-c`, `C-d`, EOF, interrupt, quit, cancel.
- Submission: `Enter`, `Space`, submit shortcuts.
- Confirmation/high risk: `y`, `Y`, approval shortcuts, overwrite/delete/deploy/publish/auth/payment/permission prompts, user-attributed posts or messages, secret/token input.

Treat `Enter` as context-sensitive. It is not safe by default.

## Stateful TUI Rules

When driving an unfamiliar TUI:

- Capture before acting.
- Send at most one navigation or mode-changing key at a time.
- Capture again before any committing key.
- Follow on-screen shortcut text over inferred conventions from numbering.
- Use `tmux send-keys -l` for literal text.
- Send real keys separately from literal text.
- Stop and ask if focus, selected action, prompt wording, or mode is ambiguous.
- Prefer documented flags, config files, JSON output, dry runs, or APIs over TUI automation when available.

## Mechanics

- Prefer stable pane IDs (`%1`, `%2`) over active/default targets.
- Fully qualify targets with `-t "$pane"`; avoid relying on the active pane.
- `send-keys` sends all arguments sequentially. `tmux send-keys -t "$pane" 4 Enter` sends `4` and then immediately presses Enter.
- `send-keys` treats recognised names like `Enter`, `Escape`, `Up`, `C-c`, and `BTab` as keys.
- Use `send-keys -l` when text might look like a key name.
- Use `capture-pane -p` for visible content.
- Use `capture-pane -S - -E -` for all available history.
- Use `capture-pane -M` if the pane is in a tmux mode.
- Use `capture-pane -a` for alternate-screen content when needed.
- Poll screen state with `capture-pane` and `display -p` rather than sleeping blindly.

## Example: Modal Feedback Prompt

Unsafe:

```bash
tmux send-keys -t "$pane" 4 Enter
```

This combines selection and confirmation without observing the state between them.

Safer:

```bash
tmux capture-pane -pt "$pane"

tmux send-keys -t "$pane" BTab
tmux capture-pane -pt "$pane"

tmux send-keys -lt "$pane" "validate plan and assumptions"
tmux capture-pane -pt "$pane"

# Only submit after confirming the text is in the intended input.
tmux send-keys -t "$pane" Enter
```

## Remote Execution (Codespaces/SSH)

For mise-installed tools, wrap in zsh:

```bash
# Non-interactive (won't hang)
ssh host 'zsh -c "source ~/.zshrc; tmux new-session -d -s mysession; tmux send-keys -t mysession python Enter"'

# Interactive (for tmux attach) - needs TTY
ssh host -t 'zsh -ilc "tmux attach -t mysession"'
```

**Critical**: Use `zsh -c "source ~/.zshrc; ..."` not `zsh -lc` to avoid hangs.

## User Notification

After starting a session, ALWAYS print:

```text
To monitor: tmux attach -t $SESSION
To capture: tmux capture-pane -t $SESSION -p
```

## Tips

- Use `-x 120 -y 40` for consistent pane size
- Poll with `capture-pane -p` rather than `wait-for`
- Send literal text with `-l` flag to avoid shell expansion
- Control keys: `C-c` (interrupt), `C-d` (EOF), `Escape`
- For Python REPL: set `PYTHON_BASIC_REPL=1` to avoid fancy console interference

## Helper Scripts

### [wait-for-text.sh](scripts/wait-for-text.sh)

Poll tmux pane for a text pattern with timeout:

```bash
scripts/wait-for-text.sh -t session:0.0 -p '^>>>' -T 15
```

### [find-sessions.sh](scripts/find-sessions.sh)

List tmux sessions, optionally filtered:

```bash
scripts/find-sessions.sh -q claude  # filter by name
scripts/find-sessions.sh --all      # all sessions
```
