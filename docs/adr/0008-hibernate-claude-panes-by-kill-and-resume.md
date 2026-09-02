# Hibernating a Claude pane means killing it and resuming from the transcript

## Context

51 tmux panes run Claude on a 16 GiB Mac mini: ~15 GiB total footprint, ~3-4 GiB
resident, swap 91% full, memory pressure at WARN. Claude Code has open off-heap
leaks that grow while a session sits idle, and an idle session is not inert
either - a scheduled task or a cross-session message wakes it with its full
context and spends tokens.

The pane is the unit of work here: the agent dots, the resurrect restore
subsystem and the `agent` CLI all address panes, and a conversation's identity
is its session id, whose transcript lives on disk independently of any process.
`cleanupPeriodDays: 365` keeps those transcripts for a year.

## Decision

`agent hibernate` kills the pane's claude process group and parks a thawer in
the pane; `agent thaw` respawns `claude <saved flags> --resume <session id>` in
the same pane. Killing is what returns RAM and swap, and it resets the leak;
`--resume` restores the conversation in full because the transcript, not the
process, is the session.

The record store is keyed by **session id**, at
`~/.local/state/agent-hibernate/<sessionId>.json`. Pane ids die with the tmux
server and pane keys drift when a window moves, so both are stored as *current
addresses* and refreshed (by park on restore, by the resurrect save pass while
live) rather than used as the key. New records snapshot the window name for a
recognisable parked-pane and picker label. Older records remain valid through
the pane-key and short-session fallbacks until no stored record lacks that
field.

A pane whose session id cannot be resolved is **not** hibernated. `--continue`
would resume whichever conversation that directory last touched, which for a
directory holding several panes is a different conversation than the one killed.

## Alternatives considered

- **SIGSTOP the idle process.** Frees nothing: a stopped process keeps every
  page it has mapped, so the leaked footprint stays resident or swapped and the
  91%-full swap is unchanged. It parks the leak instead of resetting it, and the
  process still has to be resumed to be used.
- **`claude --bg` / detaching the session from tmux.** Abandons the pane as the
  unit of work. Every surface built here - the dots, `prefix + A`, resurrect
  restore, `agent prompt` - addresses `%N`, so a backgrounded session leaves all
  of them with nothing to point at.
- **`taskpolicy -b` (background priority).** Changes scheduling, not residency:
  it returns no memory at all, and its behaviour on Apple Silicon is unverified
  here. It answers a CPU question this is not.
- **Restoring hibernated panes as live agents.** A resurrect restore would then
  re-spawn the whole fleet at once - precisely the memory state hibernation
  exists to avoid, and on the machine least able to absorb it (a restore follows
  a crash or a reboot). The parked thawer comes back parked instead, and each
  session is resumed by hand.
- **Doing nothing, and closing panes by hand when RAM runs out.** Closing a pane
  loses its place in the workflow (window position, name, cwd) and gives no
  route back but hunting for the session id, while the leak and the idle token
  spend continue in every pane left open.

## Consequences

Kill-and-resume costs a resume's worth of latency and tokens on thaw: the
transcript is re-read, so a long conversation pays for its own context again.
That is the price of the RAM, and it is why the trigger stays manual - there is
no auto-hibernate policy, and the state gate refuses anything but `idle`/`done`
without `--force` (a `blocked` pane holds a pending permission prompt, a
`working` one an in-flight tool call).

No hibernated session can become unreachable. The transcript and the record
survive independently of tmux, so a lost pane, a killed window or a dead server
leaves an *orphan record*, which the `agent thaw` picker lists and resumes into
a fresh window.

Claude only. Codex's thread id is discoverable only from the rollout file the
process holds open (`lsof`), so killing it first would destroy the means of
identifying what to resume; OpenCode has no live active-session marker at all.
