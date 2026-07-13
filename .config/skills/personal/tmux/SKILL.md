---
name: tmux
description: Control interactive CLIs and TUIs via tmux sessions - safely target panes, send keystrokes, scrape output, and operate modal prompts with observe-before-commit guardrails.
---

# tmux Skill

Use tmux to control interactive terminal applications when a normal command/API is not enough. Prefer explicit program interfaces first, use tmux control mode for prompt-shaped flows, and reserve screen scraping plus keystrokes for genuinely modal TUIs.

## When to Use

- Running REPLs that need a PTY: Python, Node, psql, gdb/lldb.
- Watching long-running interactive commands without blocking the agent.
- Operating a modal prompt or TUI when no documented non-interactive path exists.
- Remote execution where the human may want to attach and observe.

## Choose the Interface

1. Use APIs and non-interactive commands first.
   Prefer flags, config files, JSON output, dry runs, stdin, HTTP APIs, or documented subcommands. This is the only pane-free option.

2. Use tmux control mode for prompt-shaped interactive flows.
   Control mode still uses tmux panes and PTYs, but the observer is not another visual pane. A control client attaches to a session with `tmux -C attach -t "$session"` and receives protocol events such as `%output %1 <payload>`. The helper filters those events to one stable pane id.

3. Use `capture-pane` observe-before-commit for modal TUIs.
   Full-screen TUIs are stateful. Control mode can stream bytes, but it does not tell you focus, selected rows, or confirmation semantics. Use visible captures and act one step at a time.

## Safety Model

Do not treat a terminal UI as a command API. TUIs are stateful and modal: visible labels, numbered rows, highlighted options, and default buttons are evidence, not a stable protocol.

For unfamiliar interactive programs, use this loop:

1. Capture the pane.
2. Classify the UI state and current focus.
3. Send one navigation, editing, or mode-changing action.
4. Capture again.
5. Send committing keys only after the capture confirms the intended state.

Never combine selection and confirmation in one tmux command for an unfamiliar TUI.

## Core Setup Pattern

```bash
tmux new-session -d -s "$SESSION" -x 120 -y 40
tmux send-keys -t "$SESSION" "python3" Enter
pane=$(tmux display-message -p -t "$SESSION" '#{pane_id}')

scripts/wait-for-text.sh --control -t "$pane" -p '^>>> ?$' -T 15

tmux kill-session -t "$SESSION"
```

Use `-x 120 -y 40` for predictable wrapping. Prefer stable pane IDs like `%1` over active/default targets.

## Key Risk Classes

- Low risk: `capture-pane`, `list-panes`, `list-sessions`, read-only probes.
- Navigation/editing: arrows, `Tab`, `BTab`, `Escape`, page keys, literal text input.
- Control: `C-c`, `C-d`, EOF, interrupt, quit, cancel.
- Submission: `Enter`, `Space`, submit shortcuts.
- Confirmation/high risk: `y`, `Y`, approval shortcuts, overwrite/delete/deploy/publish/auth/payment/permission prompts, user-attributed posts or messages, secret/token input.

Treat `Enter` as context-sensitive. It is not safe by default.

## Sending Input

Use literal input for text and real keys separately:

```bash
tmux send-keys -lt "$pane" "literal text"
tmux send-keys -t "$pane" Enter
```

For multiline text, prefer tmux buffers over repeated `send-keys`. Paste the text, observe it, then submit with a separate key:

```bash
tmux load-buffer -b agent-input - <<'EOF'
first line
second line
EOF
tmux paste-buffer -b agent-input -p -t "$pane"
tmux delete-buffer -b agent-input
tmux capture-pane -pt "$pane"
tmux send-keys -t "$pane" Enter
```

Do not combine the paste and the committing `Enter` unless the target program is familiar and low risk.

## Control Mode

Use control mode when you need to wait for output from a REPL or prompt without polling screenshots of the pane.

```bash
scripts/wait-for-text.sh --control -t "$pane" -p '^>>> ?$' -T 15
scripts/control-tail.py -t "$pane" -p 'Password: ?$' -T 30
```

Useful cases:

- Waiting for prompts after starting a REPL/debugger/database shell.
- Watching output emitted after the watcher starts.
- Filtering output from one pane while the session contains other active panes.
- Driving simple question/answer prompts where visible text is enough evidence.

Limits:

- Control mode is not pane-free. tmux still runs each interactive program in a pane-backed PTY.
- It streams bytes, not semantic UI state.
- It is not a terminal emulator. The helper normalises common ANSI/OSC sequences and carriage returns for matching, but use `capture-pane` for modal TUI state.
- The helper decodes tmux `%output` and `%extended-output` octal escapes with Python stdlib only.

## Capture Mode and Modal TUIs

When driving an unfamiliar TUI:

- Capture before acting.
- Send at most one navigation or mode-changing key at a time.
- Capture again before any committing key.
- Follow on-screen shortcut text over inferred conventions from numbering.
- Use `tmux send-keys -l` for literal text.
- Send real keys separately from literal text.
- Stop and ask if focus, selected action, prompt wording, or mode is ambiguous.

Useful capture commands:

```bash
tmux capture-pane -pt "$pane"             # visible content
tmux capture-pane -pS - -E - -t "$pane"   # all available history
tmux capture-pane -pM -t "$pane"          # tmux mode content
tmux capture-pane -pa -t "$pane"          # alternate-screen content when needed
```

Poll screen state with `capture-pane` and `display-message -p` rather than sleeping blindly.

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

## Mechanics

- Fully qualify targets with `-t "$pane"`; avoid relying on the active pane.
- `send-keys` sends all arguments sequentially. `tmux send-keys -t "$pane" 4 Enter` sends `4` and then immediately presses Enter.
- `send-keys` treats recognised names like `Enter`, `Escape`, `Up`, `C-c`, and `BTab` as keys.
- Use `send-keys -l` when text might look like a key name.
- Resolve targets with `tmux display-message -p -t "$target" '#{pane_id}|#{session_id}'`.
- For private servers, use `tmux -L "$name"` or `tmux -S "$path"` consistently across all commands.

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

After starting a session, print the following so the human can attach and observe the session you started:

```text
To monitor: tmux attach -t $SESSION
To capture: tmux capture-pane -t $SESSION -p
```

## Helper Scripts

### [wait-for-text.sh](scripts/wait-for-text.sh)

Wait for a text pattern with timeout. Capture-polling is the default; `--control` follows tmux output events.

```bash
scripts/wait-for-text.sh -t session:0.0 -p '^>>>' -T 15
scripts/wait-for-text.sh --control -t %1 -p '^>>> ?$' -T 15
scripts/wait-for-text.sh -L private -t repl -p 'ready'
```

Options:

- `-L SOCKET_NAME` or `-S SOCKET_PATH` target a private tmux server.
- `-i INTERVAL` controls capture polling and is ignored in control mode.
- Capture mode uses grep ERE; control mode uses Python regex.

### [control-tail.py](scripts/control-tail.py)

Follow one pane with tmux control mode:

```bash
scripts/control-tail.py -t %1
scripts/control-tail.py -t %1 -p 'READY|ERROR' -T 30
scripts/control-tail.py -L private -t repl:0.0 -p '^>>> ?$' --no-seed
```

### [find-sessions.sh](scripts/find-sessions.sh)

List tmux sessions, optionally filtered:

```bash
scripts/find-sessions.sh -q claude  # filter by name
scripts/find-sessions.sh --all      # all sessions
scripts/find-sessions.sh -L private # named socket
```

### [tmux-common.sh](scripts/tmux-common.sh)

Internal shared socket-option helpers used by the shell scripts.
