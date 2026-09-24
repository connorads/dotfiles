# Resurrect save freshness (custom subsystem)

Same one-lib-many-surfaces shape as the memory gauge, for a different failure:
**detecting when session saving silently stops.** continuum advances its
save-timestamp unconditionally every 5 min, so a save path that stops producing
files ticks on without error - it did exactly that for 3.5 weeks (saves froze at
28 Jun) until a kernel panic found no recent session to restore. The write path
was healthy; the *silence* was the bug. This subsystem makes save-freshness a
visible, alarming state.

Vocabulary: `FRESH | AGING | STALE | NONE`, from the age of the newest save file.

- [`scripts/resurrect-lib.sh`](../scripts/resurrect-lib.sh) - **canonical**
  thresholds (`RESURRECT_AGING_SECS` 10 min / `RESURRECT_STALE_SECS` 15 min,
  env-overridable for tests), the save-dir resolver (`resurrect_dir`, replicating
  the plugin's `helpers.sh` default), newest-save age (`resurrect_newest_age_secs` -
  max mtime over `tmux_resurrect_*.txt` plus the `last` symlink *target*,
  `_resurrect_mtime` dereferencing with `-L` and handling GNU/BSD `stat`), the
  state mapping (`resurrect_state`), and the colour/glyph/token language
  (`resurrect_state_colour` green/yellow/red, `resurrect_state_glyph` ⟳ turning /
  ⚠ wrong, `resurrect_token` age / `stale` / `none`). Sourced, never run.
  Cross-platform (no macOS-only syscalls), so it works on Linux hosts too.
  Caveat: tmux-resurrect only keeps a timestamped file when session state changed
  since the previous save, so `age` is the age of the last *content-changing*
  save - exactly the signal that went stale in the incident.
- [`scripts/status-right.sh`](../scripts/status-right.sh) - `resurrect_segment()`,
  the always-shown pill (width ≥ 80). It gathers newest-save age once, then uses
  the lib's pure `resurrect_state_from` / `resurrect_token_from` derivations.
  Unlike the quiet-when-healthy mem pill, a
  live green `⟳ 2m` is wanted as the running-confidence signal the incident
  lacked; it reddens to yellow/red the moment saving stops. It is the first
  persistent system pill, followed by the darker CPU pill, so its surface1
  (`#45475a`) shade stays distinct.
- [`scripts/resurrect-keepalive.sh`](../scripts/resurrect-keepalive.sh) - the
  **drive** layer (macOS): an independent save driver run every 5 min by a
  launchd agent (`dev.connorads.tmux-resurrect-save`, defined in
  [`darwin-shared.nix`](../../nix/modules/darwin-shared.nix), both Macs), so saving
  depends on launchd rather than continuum's status-refresh-injected autosave.
  It runs `save.sh quiet` capturing exit code + stderr to
  `~/.cache/tmux-resurrect-keepalive.log` (the opposite of continuum's
  `>/dev/null 2>&1`), then verifies both freshness (via the lib) and **content**:
  on `STALE`/`NONE`, or a newest save carrying no `pane` lines, it sets the
  `@resurrect_stale` tmux option and nags each attached client by name
  (`display-message -c` - from launchd there is no current client, so an
  untargeted message would no-op), else clears the flag. The pane count is the
  content half of the check because a corrupt save is still a *new* file, so the
  mtime-only pill reads it as healthy; a server always has at least one pane and
  the no-server case exits earlier, so zero pane lines is unambiguous corruption.
  The success log carries `panes=N`, an empty save logs `SAVE EMPTY`. No tmux
  server ⇒ logs `no server, skip` and exits 0. continuum stays enabled as cross-platform
  redundancy (Linux hosts get the detect pill but no keepalive yet - a deferred
  systemd-timer follow-up); the minor double-save on macs is harmless.
  It **requires a UTF-8 locale**, which it forces when the environment carries
  none or a non-UTF-8 one (the plist sets `LANG` too, but the script guard also
  covers a hand-run from a sanitised env). Outside UTF-8 - and with no `$TMUX`,
  which the keepalive strips by design - tmux sanitises the tabs its format
  output delimits fields with to `_`, so `save.sh` reads an empty session name,
  treats every pane as a grouped session, skips it, and writes a state-only save
  with no panes, while the session-ids hook matches no agent panes and records
  nothing (the map itself survives such a save: unconfirmed entries are carried,
  not rewritten - see [resurrect restore](./resurrect-restore.md)).
  Its plist `PATH` must also carry **`/usr/sbin`**, where macOS keeps `lsof`: the
  session-ids hook needs it for Codex ids and fails open on a missing tool, so
  without it Codex panes save no session id at all. The lib's `/usr/sbin/lsof`
  fallback is the second line of defence for any other narrow-`PATH` caller.

Restore stays manual (`prefix + Ctrl-r`); `@continuum-restore` is deliberately
`off` (see [resurrect restore](./resurrect-restore.md)).

Tests: [`../zsh/tests/resurrect-lib.bats`](../../zsh/tests/resurrect-lib.bats)
(state transitions across the age bands via threshold overrides + aged files,
colour/glyph/token, `last`-target deref) and
[`../zsh/tests/resurrect-keepalive.bats`](../../zsh/tests/resurrect-keepalive.bats)
(integration: drives a real save against a throwaway default-socket server, the
skip/alarm/clear/error-capture paths, the locale-less environment, and the
pane-less-save alarm). The pill itself is verified manually
(`status-right.sh 200 "$HOME" "" "" ""`, then `touch -t` an aged save and re-run).
