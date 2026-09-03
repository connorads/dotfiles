# Hibernating agent panes uses lifecycle-specific adapters

## Context

Claude and Codex both persist resumable conversations, but they do not share a
safe shutdown mechanism. Claude is stopped by terminating its process group.
Codex TUI shutdown must pass through its `ShutdownFirst` path so it flushes the
rollout, releases the thread writer lock and stops child services.

Codex identifies a resumable conversation by the current thread ID in
`session_meta.payload.id`. A root session ID can identify a different thread
after a fork. Process command text from `ps` also loses argument boundaries, so
it cannot preserve a spaced `-c` value reliably.

## Decision

`agent hibernate` owns one record, park and recovery workflow with a lifecycle
adapter for each supported agent. A record carries `kind`; absence means Claude
so existing records need no migration.

The Codex adapter resolves and validates the open rollout before shutdown,
captures the real argument vector, sends bounded Ctrl+C input, then waits for
the exact process to exit. It resumes the exact thread ID with the recorded
working directory. Session hooks publish the rollout and current thread ID to
the pane without scraping the TUI.

An `mcpz` launch exports the non-secret bundle name. Thaw runs the bundle again
so secret values are resolved at launch and never enter the hibernation record.

## Alternatives considered

- **Duplicate the Claude engine for Codex.** Record recovery, parked panes and
  resurrect integration would acquire two implementations with different
  failure behaviour. Only identity, shutdown and command construction differ.
- **Terminate Codex with SIGTERM.** The embedded TUI has no signal handler that
  routes SIGTERM through its graceful shutdown path. It can skip cleanup and
  leave child services alive.
- **Resume with `--last`.** Several panes can share one working directory, so
  recency does not identify the conversation that was stopped.
- **Parse `/status` from the screen.** Injecting a command can overwrite an
  unsent draft, and narrow panes can truncate the rendered thread ID.
- **Persist the Codex environment.** It can contain live secrets. The exact argv
  plus a safe `mcpz` bundle name carries the required launch context.

## Consequences

Codex hibernation refuses remote, unmaterialised and ambiguously launched
threads. A graceful shutdown timeout leaves the pane live unless `--force` was
given. A failed thaw keeps the record so the session remains recoverable.
