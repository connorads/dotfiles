# Agent hibernate / thaw (custom subsystem)

Stop an idle Claude or Codex pane to reclaim RAM and swap, park a thawer in its
place, and resume the same conversation on demand. Stopping is what returns memory -
SIGSTOP keeps every page mapped, so it parks the leak rather than resetting it -
and `--resume` restores the conversation in full because the transcript, not the
process, is the session. The lifecycle-specific mechanism and rejected
alternatives live in [`docs/adr/0009`](../../../docs/adr/0009-hibernate-agent-panes-through-lifecycle-adapters.md).

- [`scripts/agent-hibernate.sh`](../scripts/agent-hibernate.sh) - the whole
  engine: `hibernate` / `thaw` / `park` / `list`. Identity is snapshotted with
  the same resolvers the restore and fork paths use. Claude keeps its ccp
  account and launch posture. Codex keeps the exact current thread ID, cwd,
  argv boundaries, CLI version and optional `mcpz` bundle name.
- **The record store is keyed by session id**, at
  `~/.local/state/agent-hibernate/<sessionId>.json` (`AGENT_HIBERNATE_DIR`
  relocates it), with the pane's screen capture beside it as
  `<sessionId>.screen.txt`. Pane ids die with the server and pane keys drift on
  a window move, so `pane`/`paneKey` are stored as *current addresses* and
  refreshed - never used as the key. New records also snapshot `windowName`.
  Display labels resolve through agent name → live window name → saved window
  name → pane key → short session id. The fallbacks keep old records readable;
  remove them only when no stored record lacks `windowName`. **No resolvable
  session id means no
  hibernation**: `--continue` would resume whichever conversation the directory
  last touched, which for a directory holding several panes is the wrong one.
- **The state gate.** `idle`/`done` hibernate freely; `blocked` (a pending
  permission prompt), `working` (an in-flight tool call) and an empty state each
  need `--force`, and refusal is **exit 6**.
- **`remain-on-exit` is raised across shutdown.** Both pane shapes occur -
  an agent under a shell, and an agent *as* the pane process - and in the second the
  pane would close on the kill before the thawer could be spawned into it.
- **Codex exits through its TUI lifecycle.** Bounded Ctrl+C presses clear a
  draft or modal and request graceful shutdown. The engine waits for the exact
  PID to exit before parking. A timeout leaves Codex live unless `--force` was
  supplied. Claude retains its process-group TERM/KILL path.
- **The screen is captured before the respawn**, with trailing blank padding
  trimmed. `respawn-pane -k` discards the visible screen and keeps scrolled
  history (observed), so park re-prints the capture; re-printing tmux's
  full-height padding would scroll the content itself off the top.
- **Park gives the pane a title, and `save.sh` needs it.** `save.sh` parses
  its own dump with `IFS=<tab> read`, and TAB is IFS whitespace, so a pane with
  an **empty** title collapses that line's fields - the pid lands in the title
  slot and the pane saves no command at all (observed: 14 parked panes saved
  bare). `respawn-pane` leaves the title empty, so park sets one over OSC 2,
  not `select-pane -T`, which would be a second tmux call from inside the pane.
  That treats the producer, and `save.sh` is vendored and untracked, so the
  parse stays as upstream wrote it. Every first-party record in this subsystem
  separates with US instead; see [AGENTS.md](../AGENTS.md).
- **Park is a key-loop, not a placeholder.** It re-prints the screen, shows
  `hibernated: <name> (idle Nd, freed NNN MB) - Enter to thaw`, and thaws on
  Enter via `run-shell -b` - server-side, outside the pane's own process group,
  or the respawn would kill park mid-thaw before the record is cleaned up.
- **Idle age comes from the journal** (`last_journal_ts`), grepping only the
  current and previous month's `events-*.jsonl` on demand - those files run
  ~60 MB/month.
- **The sweep exempts `hibernated`, and so does `clear`.** A parked pane's
  foreground IS a bare shell, which is the sweep's "the agent died" signal, so
  without the exemption the dot goes within one poll. `agent-state.sh clear`
  skips a hibernated pane for a related reason: killing claude fires *its own*
  `SessionEnd` hook, which lands mid-park (observed one second before park
  re-armed the state), and a lost dot drops the pane out of the resurrect save.
  The sweep daemon launches a fresh `tick` child on every poll. Its versioned
  PID record lets a config reload replace a legacy or structurally changed
  parent loop.
- **Restore survival.** Three pieces keep a parked pane parked across a tmux
  restart: [`resurrect-save-sessions.sh`](../scripts/resurrect-save-sessions.sh)
  rewrites hibernated `session_ids.json` entries fresh from the record store
  each save (the record is the live truth; the carry rule wants a live *agent*
  pane, which a parked pane is not) and refreshes each record's address;
  [`save_command_strategies/foreground.sh`](../save_command_strategies/foreground.sh)
  emits the park invocation for a pane whose record matches, because a parked
  pane's shell foreground would otherwise save no command and `restore.sh`
  drops such pane lines; and `"~agent-hibernate"` in `@resurrect-processes`
  ([`tmux.conf`](../tmux.conf)) stops that command being filtered out. A record
  counts only while its pane still carries `@agent_state=hibernated` - after a
  restart a recycled pane id can name an unrelated pane.
- **Nothing becomes unreachable.** On restore, park resolves through pane id →
  pane key → the `session_ids.json` hibernated entry → a *unique* cwd (the same
  exactly-one rule as `resurrect-claude-launch.sh`), and re-addresses the record
  under the new pane id. Anything unresolvable holds as an **orphan**, which
  `agent thaw`'s picker lists and thaws into a fresh window in the recorded cwd.
- Surfaces: `agent hibernate [target] [--force]` / `agent thaw [target]` (the
  CLI delegates through `AGENT_HIBERNATE_SH` and, as ever, mutates no
  `@agent_state` itself), `prefix + Alt+z` for the current pane,
  `prefix + Alt+Shift+Z` for the global thaw picker, Enter in a parked pane,
  and state-aware lifecycle items in the exact pane's right-click menu.
  [`scripts/agent-hibernate-action.sh`](../scripts/agent-hibernate-action.sh)
  turns engine output into client-targeted status feedback. Window-tab menus
  omit lifecycle actions because a window can contain several agent panes.

## No automatic hibernation

Hibernation is manual only. Nothing stops a pane without a hand on the
keyboard: not the sweep, and not memwatch at `CRITICAL`
([ADR 0017](../../../docs/adr/0017-agent-hibernation-is-manual-only.md)).

Tests: [`../zsh/tests/agent-hibernate.bats`](../../zsh/tests/agent-hibernate.bats)
drives a real private server end to end. Its fake claude is a **symlink to a nix
bash** running an idle script, and both halves are required: `ps -o comm=`
reports a *script's* interpreter (so a shell stub never matches "claude"), and
macOS withholds a SIP-protected binary's environment from `ps -E` (so
`/usr/bin/tail` would read back no `CLAUDE_CONFIG_DIR`). The save-side and
foreground-strategy halves live in
[`../zsh/tests/tmux-resurrect-sessions.bats`](../../zsh/tests/tmux-resurrect-sessions.bats).
