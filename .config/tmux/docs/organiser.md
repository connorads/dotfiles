# Touch organiser (custom subsystem)

The touch workspace organiser is a native tmux menu layer backed by one script:
[`scripts/organiser.sh`](../scripts/organiser.sh). It is opened by `prefix + W`,
right-clicked window tabs, the pane-header `[⋯]` control, the session badge menu
and Remobi's Organise button. [`scripts/context-menu.sh`](../scripts/context-menu.sh)
keeps the worktree popup modes, but delegates pane/window/session menus to the
organiser.

Design rules:

- Gather tmux topology before deciding actions, then perform one mutation path.
  Actions address sessions, windows, panes and clients by stable tmux IDs
  (`$N`, `@N`, `%N`, `#{client_name}`); names are escaped and used only as menu
  labels.
- Destination menus page by `#{client_height}`. Native `display-menu` does not
  scroll; Previous/Next entries are the paging mechanism.
- Relocation uses existing sessions only. Empty destination lists show a disabled
  "No eligible sessions" row rather than creating sessions.
- `Share with session…` means `link-window`: the same live window appears in
  another session. `Remove from this session` is `unlink-window` and is available
  only while `#{window_linked}` is true. Killing a linked window is labelled
  `Kill shared window everywhere`.
- Exclude the source session from move/share destinations; for sharing, also
  exclude sessions already containing the window.
- Confirm any move, unlink, join or kill that closes the source session or acts
  on every linked copy.
- Pane break is disabled when the pane is already the window's sole pane. Pane
  break destinations include the current session so a pane can become a new
  window in place. Joining a marked pane stays on the destination after the join.
- The second status row stays the only bottom row. It contains a native `S:`
  session rail on the left and the existing status-right chrome on the right.
  The rail uses `range=session|#{session_id}`, native list trimming with `<`/`>`
  markers, and blocked/done/working dots. The sub-80 cross-session
  fallback badge and memory pill are
  `range=user|agents` / `range=user|mem`; `MouseDown1Status` handles those and
  falls back to tmux's stock `switch-client -t =` for every other status click.
- Pane-header `[⋯]` and `[zoom]` are tmux control ranges (`control|7` and
  `control|8`). Kill remains inside the menu.

Tests:
[`../zsh/tests/organiser.bats`](../../zsh/tests/organiser.bats) covers destination
filtering, pagination, escaped labels, linked-window labelling, sole-pane break
constraints and marked-pane join directions. [`../zsh/tests/context-menu.bats`](../../zsh/tests/context-menu.bats)
covers context-menu delegation plus the retained worktree popup modes.
[`../zsh/tests/tmux-agent-tabs.bats`](../../zsh/tests/tmux-agent-tabs.bats) guards
the status/control ranges, and [`../zsh/tests/status-right.bats`](../../zsh/tests/status-right.bats)
guards the tappable memory range. Keep [`help.md`](../help.md) in sync with any
control or binding change.
