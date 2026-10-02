# memwatch kills headless Chrome at CRITICAL

Refines [0017](0017-agent-hibernation-is-manual-only.md): pane hibernation stays
manual.

## Context

The 16 GB Air hit two watchdog panics from memory exhaustion:

- **27 Sep.** One `chrome-headless-shell` held 15.6 GB and wired memory reached
  15.0 GB. The compressor was 17% full, so memwatch never alerted.
- **29 Sep.** WindowServer reached 34.8 GB. memwatch went CRITICAL 16 min before
  the panic. Its banner named no cause and nobody was at the machine at 00:05.

A banner needs a person to act. Both panics happened when no person was there.

## Decision

On every CRITICAL tick memwatch sends SIGKILL to every `chrome-headless-shell`.
CRITICAL means slots at 80% or more, pressure 4, a 5 s stall, or wired memory
at 12 GB or more. memwatch logs a `killed=` line and posts a banner. This is
its only automatic action.

- The target is headless Chrome only. Playwright and other test runners start it,
  it holds no user state, and the runner restarts it on a retry.
- SIGKILL, not TERM, because a starved browser may not handle TERM in time.
- The check runs on every CRITICAL tick, not only on a transition, so a respawned
  browser dies again. A kill needs a running process, so no cooldown is needed.
- `MEMWATCH_KILL=0` turns it off for dry runs.

## Alternatives considered

- **Notify only (0017's status quo).** The 29 Sep banner came 16 min early and
  changed nothing, because nobody saw it.
- **Also kill dev servers.** They hold state the owner wants, and neither panic
  came from one.
- **Kill only on a stall.** The stall probe sees userspace starving after the
  damage is done. On 27 Sep wired memory was the only signal, with no stall
  before the panic.

## Consequences

Every agent's Playwright session dies together, including sessions that did not
cause the pressure. Their tests fail and need a rerun. A WindowServer leak is not
killed: memwatch names it in the log and banner (`ws=`), and the owner acts.
