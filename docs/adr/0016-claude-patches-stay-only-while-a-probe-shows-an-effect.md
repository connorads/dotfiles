# Claude patches stay only while a behaviour probe shows they matter

## Context

A needle patch's `--check` reports whether its bytes are in place, not whether the
edited code runs. [0011](0011-claude-binary-is-not-patched-and-mise-owns-the-install.md)
found two channel patches green for weeks while doing nothing. So each surviving
patch was run against a pristine copy on Claude Code 2.1.283. The pristine copy is
the `claude.unpatched` backup, and `cmp` matches it to the release. Each probe
changes one variable.

### computer-use

`/mcp` in an interactive TUI on a throwaway tmux socket, with `DISABLE_TELEMETRY=1`:

| binary | `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF` | computer-use in `/mcp` |
| --- | --- | --- |
| patched | unset | absent |
| patched | `1` | present |
| pristine | `1` | present |
| pristine | unset | absent |

The variable, exported in `~/.zshrc`, is the whole cause. The patch adds nothing.
`claude -p` never lists computer-use, so a print-mode probe cannot tell the cases
apart.

### session-reaper

A fake `~/.claude/sessions/396.json` names a live root-owned pid with its real
`lstart`. `kill(396, 0)` from this user returns EPERM, the errno a Seatbelt sandbox
gives for another live Claude. After one `claude -p` launch, the file survives on
both the pristine and the patched binary. A control file naming a dead pid is
reaped by the pristine binary, so the launch does run the reaper.

### telegram-clear

This patch edits the plugin's `server.ts`, which bun runs as source. A preload
replaces grammy's `node-fetch` with a fake Bot API that delivers one private
`/clear` from an allowlisted sender, and a stub `tmux` logs its argv:

- pristine `server.ts`: no `tmux` call and no reply. The text goes to Claude as an
  ordinary channel message.
- patched `server.ts`: `tmux send-keys -t %99 -l /clear`, a `Cleared context`
  reply, then `send-keys Enter`.

## Decision

The computer-use and session-reaper patches are deleted, together with their
functions, shims, tests, `up` entries and mise postinstall steps. telegram-clear and
the read-only `claude-commit-note-check` stay.

A Claude patch stays only while a probe like the ones above shows that the pristine
and patched copies behave differently. A green `--check` alone does not keep one.

## Alternatives considered

- **Keep computer-use as insurance.** Patched without the variable, computer-use is
  still absent, so the patch cannot cover a lapse of the variable either.
- **Keep session-reaper for sandboxed launches.** The pristine binary already keeps a
  file whose pid returns EPERM, which is the sandbox case the patch targets.
- **Delete telegram-clear with the others.** Without it the pristine plugin relays
  `/clear` to the model as text, and the session's context is not cleared.
