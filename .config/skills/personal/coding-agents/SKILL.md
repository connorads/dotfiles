---
name: coding-agents
description: >
  Observe and drive coding agents (Claude Code, Codex) running in tmux panes:
  list live agents, wait for one to finish or need input, send it a prompt,
  or name a pane. Use whenever a task involves another agent's pane - "is the
  agent done", "when it finishes", "send this to the other agent", waiting on
  an agent before a follow-up step, or scripting multi-agent hand-offs. Owns
  the `agent` CLI and the `@agent_state` vocabulary. For driving any other
  TUI (REPLs, wizards, editors) use the tmux skill.
---

# Coding Agents in tmux Panes

Coding-agent panes report their own lifecycle: hooks in each agent's config
call `~/.config/tmux/scripts/agent-state.sh`, so state is already a tmux
option. **Use the `agent` wrapper — do not reconstruct raw polling loops or
scrape the screen.** The wrapper resolves targets by name, handles timeouts
and exit codes, and verifies prompts actually start the agent.

## The `agent` CLI (default path)

```bash
agent ls [--json]                 # live agent panes, ranked blocked > done > working > idle
agent state <target>              # bare state word; empty = untracked pane
agent wait <target> [--for state[,state]] [--timeout secs]
                                  # block until a wanted state (default done,idle,blocked; 120s)
agent prompt <target> [--force] [--] <text...>
                                  # paste + submit + verify the agent starts;
                                  # refuses blocked/working panes unless --force
agent name [<target>] <name>      # label a pane (unique; [a-z][a-z0-9_-]{0,31}); unname clears
agent pick                        # fzf jump picker (humans)
```

`<target>` = `%pane_id` | `session:win.pane` | agent name. Exit codes:
`0` ok · `1` wait timeout · `2` usage · `3` target unresolvable ·
`4` prompt refused · `5` prompt sent but agent never started.

The common hand-off is two commands, not a loop:

```bash
agent wait build-agent --timeout 600   # returns on done/idle/blocked
agent prompt build-agent -- "Now run the release checklist"
```

- `blocked` means the agent needs input (permission prompt, question).
  Capture the pane and operate the prompt with the tmux skill's
  observe-before-commit loop - permission prompts are confirmation/high-risk
  keys.
- On `wait` timeout, capture and inspect before deciding anything; don't
  retry blind.
- After launching a fresh agent, `agent wait <target> --for idle` before the
  first prompt - early keystrokes into a booting TUI can be lost (`agent
  prompt` checks this for you).
- Keep the human's focus where it was: split with `tmux split-window -d`.

## State vocabulary

- `#{@agent_state}` per pane, `#{@win_agent_state}` per window (worst-wins
  rollup). Rank: `blocked > done > working > idle`.
- `done` and `idle` are one state with a seen bit: `done` = finished and not
  yet viewed; focus ages it to `idle`. When waiting for completion, treat
  **either** as "turn complete" (the `agent wait` default does).
- An empty option means no reporting agent in that pane (only Claude Code and
  Codex report). Fall back to the tmux skill's capture-based observation.
- Never write `@agent_state` directly; the hooks and `agent-sweep.sh` own it.
  A genuinely needed manual change goes through
  `sh ~/.config/tmux/scripts/agent-state.sh <verb>` from inside the pane.

## Raw fallback (no `agent` on PATH)

Only when the wrapper is unavailable (foreign host, stripped PATH) - poll the
option, never the screen:

```bash
tmux list-panes -a -f '#{!=:#{@agent_state},}' \
  -F '#{pane_id} #{@agent_state} #{pane_current_command} #{pane_title}'   # discover

deadline=$(( $(date +%s) + ${TIMEOUT:-120} ))
while :; do
  s=$(tmux display-message -p -t "$pane" '#{@agent_state}')
  case $s in done|idle|blocked) break ;; esac
  [ "$(date +%s)" -ge "$deadline" ] && { echo "timeout (state: $s)" >&2; exit 1; }
  sleep 2
done
```

The `-f` filter keeps only panes with a non-empty state (a naive awk on `$2`
false-matches stateless panes because the title shifts into field 2).

## Secondary signals (no hooks needed)

- `#{pane_title}`: Claude Code emits OSC titles - a braille-spinner prefix
  (U+2800-U+28FF) means working and carries the current task description; a
  `✳` prefix means idle at the prompt. `blocked` is not visible in the title;
  permission prompts need the state option or a capture.
- `~/.local/state/agent-journal/events-YYYY-MM.jsonl`: per-pane state history
  with session ids, cwd, and notification messages - the replayable record
  when current options are not enough.

## Boundary with the tmux skill

This skill owns *agent-state*: the `agent` CLI, `@agent_state`, and
agent-pane etiquette. The `tmux` skill owns *generic TUI control*: send-keys
discipline, capture, `wait-for-text.sh`, control mode, private sockets, and
the observe-before-commit loop you need the moment a pane is `blocked` or
untracked. Output-text conditions (build finished, tests passed) are the tmux
skill's `wait-for-text.sh`, not `agent wait`.
