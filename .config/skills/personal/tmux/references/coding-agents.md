# Coding Agents in Panes

When the controlled TUI is a coding agent (Claude Code, Codex), prefer the
agent-state subsystem over screen scraping. Hooks in each agent's config call
`~/.config/tmux/scripts/agent-state.sh` on lifecycle events, so pane state is
already tracked as tmux options - no capture needed to know where an agent is.

## State vocabulary

- `#{@agent_state}` per pane, `#{@win_agent_state}` per window (worst-wins
  rollup). Rank: `blocked > done > working > idle`.
- `done` and `idle` are the same underlying state with a seen bit: `done` =
  finished and no human has viewed the pane; focus ages it to `idle`. When
  waiting for completion, treat **either** as "turn complete".
- An empty option means the pane has no reporting agent (only Claude Code and
  Codex report). Fall back to capture-based observation there.
- Never write `@agent_state` directly; the hooks and `agent-sweep.sh` own it.
  If a manual change is genuinely needed, go through
  `sh ~/.config/tmux/scripts/agent-state.sh <verb>` from inside the pane.

## Discover agent panes

```bash
tmux list-panes -a -f '#{!=:#{@agent_state},}' -F '#{pane_id} #{@agent_state} #{pane_current_command} #{pane_title}'
```

The `-f` filter keeps only panes with a non-empty state (a naive awk on `$2`
false-matches stateless panes because the title shifts into field 2).

## Wait for an agent

Poll the option, not the screen:

```bash
deadline=$(( $(date +%s) + ${TIMEOUT:-120} ))
while :; do
  s=$(tmux display-message -p -t "$pane" '#{@agent_state}')
  case $s in done|idle|blocked) break ;; esac
  [ "$(date +%s)" -ge "$deadline" ] && { echo "timeout (state: $s)" >&2; exit 1; }
  sleep 2
done
```

- `blocked` means the agent needs input (permission prompt, question). Capture
  the pane and operate the prompt with the observe-before-commit loop from
  SKILL.md - permission prompts are confirmation/high-risk keys.
- On timeout, capture and inspect before deciding anything; do not retry blind.
- For output-text conditions (build finished, tests passed) use
  `scripts/wait-for-text.sh` as usual.

## Submit a prompt

- After launching an agent, wait for `idle` before sending the first prompt; a
  fresh TUI takes seconds to become ready and early keystrokes can be lost.
- Paste the prompt as literal text via a tmux buffer, capture to confirm it
  landed in the composer, then send `Enter` separately (see Sending Input in
  SKILL.md).
- Keep the human's focus where it was: split with `tmux split-window -d`.

## Secondary signals (no hooks needed)

- `#{pane_title}`: Claude Code emits OSC titles - a braille-spinner prefix
  (U+2800-U+28FF) means working and carries the current task description; a
  `✳` prefix means idle at the prompt. `blocked` is not visible in the title;
  permission prompts need the state option or a capture.
- `~/.local/state/agent-journal/events-YYYY-MM.jsonl`: per-pane state history
  with session ids, cwd, and notification messages - the replayable record when
  current options are not enough.
