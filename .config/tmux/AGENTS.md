# AGENTS.md — tmux config

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
  rollup, and bell helpers (also used by `agent-sweep.sh`), **and the canonical
  state → glyph + colour mapping** (`agent_attrs`/`agent_hex`/`agent_char`/
  `agent_glyph`). **Shape** encodes state as well as colour so it reads on a
  colour clash and for colour-blind use; `working` is peach (not yellow) so it
  clears the same-yellow active-tab text. See [`help.md`](./help.md) for the
  legend.
- [`scripts/agent-stop.sh`](./scripts/agent-stop.sh) — Claude `Stop` hook
  adapter. Claude fires `Stop` at every turn-end, even while a background
  dynamic workflow / subagent is still draining; it jq-counts the in-flight
  *finite* work (`workflow|subagent|shell`) in the payload's `background_tasks`
  and forwards `working` while any remain, else `done` (degrades to `done` if jq
  is missing/the payload won't parse). Persistent watchers (`monitor`, `dream`)
  are excluded so they can't pin the dot at working forever.
- `@agent_dotfmt` (in [`tmux.conf`](./tmux.conf)) — renders the tab dot from the
  mapping. The popup reads the lib directly (`agent_glyph`); the tabs and the
  menu literals re-encode it and are guarded against drift by `agent-glyphs.bats`.
- Hooks: `~/.claude/settings.json` (and other agents' hooks) call
  `agent-state.sh` on lifecycle events; `Stop` routes through `agent-stop.sh`
  (`working` while `background_tasks` holds finite in-flight work, `done` once
  drained). The `after-select-pane` / `session-window-changed` hooks fire `seen`
  (focus = mark read).
- Menu: `prefix + Alt+.` (`display-menu`) sets a state by hand (literals must
  match the lib — see `agent-glyphs.bats`).

Tests (run `mise run zsh-tests`):

- [`../zsh/tests/agent-state.bats`](../zsh/tests/agent-state.bats) — verb behaviour + rollup.
- [`../zsh/tests/tmux-agent-tabs.bats`](../zsh/tests/tmux-agent-tabs.bats) —
  asserts the **exact** `@agent_dotfmt` glyph/colour output against the real
  tmux.conf; update it when you change the state → glyph mapping.
- [`../zsh/tests/agent-glyphs.bats`](../zsh/tests/agent-glyphs.bats) — derives
  expectations from `agent-state-lib.sh` and asserts all three renderers (tabs,
  menu, popup) match it; the drift guard for the mapping.
- [`../zsh/tests/agent-sweep.bats`](../zsh/tests/agent-sweep.bats) — stale-dot sweeper.

Keep the dot legend in [`help.md`](./help.md) in sync with `@agent_dotfmt`.
