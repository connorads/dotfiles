# AGENTS.md — tmux config

`CLAUDE.md` here is a symlink to this file (dotfiles AGENTS.md convention).

## When changing keybindings

**Update [`help.md`](./help.md) whenever you add, change, or remove a binding.**
It is the `prefix + ?` cheatsheet and the only human-facing list of binds; a
binding without its help row is invisible. [`tmux.conf`](./tmux.conf) carries a
top-of-file NOTE to the same effect. Treat the bind and its help row as one
coherent change and commit them together.

Verify a binding before committing: live-test on a throwaway server
(`tmux -L test new-session -d; tmux -L test source-file <(grep '^bind ...' tmux.conf); tmux -L test list-keys -T prefix | grep '<desc>'`),
or `tmux source-file ~/.config/tmux/tmux.conf` to reload the running server.

## Agent state dots (custom subsystem)

Window tabs show a per-window dot for the *worst* agent state across their panes.
The logic is spread across several files — change them as a set:

- [`scripts/agent-state.sh`](./scripts/agent-state.sh) — sets `@agent_state` per
  pane, rolls the worst up to `@win_agent_state`. Verbs:
  `working|blocked|done|unread|idle|seen|clear`. `unread` is the manual inverse
  of `seen` (force `done` even on the focused window — mark a read tab blue again).
- [`scripts/agent-state-lib.sh`](./scripts/agent-state-lib.sh) — shared rank,
  rollup, and bell helpers (also used by `agent-sweep.sh`).
- `@agent_dotfmt` (in [`tmux.conf`](./tmux.conf)) — maps state → glyph + colour.
  **Shape** encodes state as well as colour (◆ blocked · ◐ working · ● done ·
  ○ idle · · unknown) so it reads on a colour clash and for colour-blind use.
  `working` is peach (not yellow) so it clears the same-yellow active-tab text.
- Hooks: `~/.claude/settings.json` (and other agents' hooks) call
  `agent-state.sh` on lifecycle events; the `after-select-pane` /
  `session-window-changed` hooks fire `seen` (focus = mark read).
- Menu: `prefix + Alt+.` (`display-menu`) sets a state by hand.

Tests (run `mise run zsh-tests`):

- [`../zsh/tests/agent-state.bats`](../zsh/tests/agent-state.bats) — verb behaviour + rollup.
- [`../zsh/tests/tmux-agent-tabs.bats`](../zsh/tests/tmux-agent-tabs.bats) —
  asserts the **exact** `@agent_dotfmt` glyph/colour output against the real
  tmux.conf; update it when you change the state → glyph mapping.
- [`../zsh/tests/agent-sweep.bats`](../zsh/tests/agent-sweep.bats) — stale-dot sweeper.

Keep the dot legend in [`help.md`](./help.md) in sync with `@agent_dotfmt`.
