# Caffeine (keep-awake, custom subsystem)

macOS-only keep-awake toggle in the same one-lib-many-surfaces shape as the mem
gauge, with **two modes**. `idle` runs `caffeinate -i`, holding *system* sleep
while, by omitting `-d`, letting the displays sleep normally. `lid` additionally
raises the `SleepDisabled` kernel flag. State is a single managed process so an
active keep-awake is never silently left running in a forgotten shell.

## Why lid mode is not an assertion

**`caffeinate` cannot keep this Mac awake with the lid shut, and no flag to it
can.** Measured here: `pmset -g log` recorded `Entering Sleep state due to
'Clamshell Sleep'` while `caffeinate -i -t 14400` held a live
`PreventUserIdleSystemSleep` assertion. Clamshell sleep is a separate kernel path
that never consults power assertions, so the whole family - `-i`, `-s`, `-d` - is
*structurally* unable to stop it.

The only lever that works is `sudo pmset -a disablesleep 1`, a kernel
`SleepDisabled` flag checked *before* the clamshell path. Its well-known failure
mode is being silently left on forever - the Mac then never sleeps, in a bag or
on a flight, until the battery dies.

That failure is exactly what this subsystem was built to prevent (managed pid,
self-clearing deadline, a pill so a keep-awake is never invisible), which is why
the flag lives in here rather than being typed by hand.

**Scope note: lid mode is the fallback, not the headline answer.** For a
genuinely long unattended run, `atp --host dev` (agent-teleport, already built)
moves the live session to a machine meant to be on - no root, no battery risk, no
heat in a closed shell. Lid mode is for when the work must stay on this machine.

## The two-layer safety model

`disablesleep` has no process to hang a lifetime on, which breaks the subsystem's
core invariant (`pid liveness == state`). It is restored with the same
hooks-plus-backstop shape used twice already here (agent-state hooks +
`agent-sweep.sh`; continuum + `resurrect-keepalive.sh`):

1. **A supervisor owns the flag.** The recorded pid is a wrapper whose trap
   clears the flag on every *ordinary* exit - manual stop, deadline expiry,
   SIGTERM.
2. **A reconciler catches the rest.** SIGKILL, crash, panic and reboot leave no
   trap to run, so `caffeine-reconcile.sh` clears the flag whenever it is set
   with no live lid session, including at login.

**Neither layer alone is sufficient** - this is the part a future reader needs,
because "just use the supervisor" is the obvious simplification and it is wrong.
Layer 1 misses a kernel panic, which leaves no trap to run. Layer 2 alone would leave up to 5 minutes of wrong
state on every normal stop, and would give the pill nothing to report meanwhile.

Two constraints remove failure states by construction rather than by discipline:

- **Lid mode is always timed.** No indefinite variant is offered, at any layer:
  `caffeine_start_lid` returns 2 for a zero/absent/non-numeric duration, and the
  popup's `l` goes straight to the timed picker. An indefinite lid session is the
  exact artefact this subsystem exists to prevent.
- **Lid mode verifies the flag took.** A minority of macOS 26 reports say
  `disablesleep` does not stick. After setting it, `SleepDisabled` is read back;
  if it is not `1` the start aborts, says so plainly, and writes no pidfile - so
  a failed set never produces an ON-LID pill. A pill that lies about keeping the
  Mac awake reproduces the original bug with extra steps.

## Extending a running session

A session that is nearly up and a run that is not finished is the ordinary case,
and before `[+]` the only route to more time was off → `t` → re-pick, which drops
the hold. Three things about the extension must hold:

- **It adds to the remainder, never sets a fresh total.** `caffeine_extend_total`
  is remaining + picked. Setting would silently *shorten* a session with more
  left on it than the amount picked - the opposite of what the key promises.
- **It is a restart, not an edit.** `caffeinate -t` fixes its deadline at exec and
  offers no way to move it, so extending is `caffeine_start*` with a bigger
  number. In lid mode that briefly drops the kernel flag between the outgoing
  supervisor's trap and the new one. Safe by construction: reaching the key means
  a hand on the keyboard and an open lid, so the clamshell path the flag guards
  cannot fire in the gap.
- **A failed lid extension has already stopped what it was extending**, so the
  popup's failure screen says so. The rc-4 text's "nothing was started" is true
  and, on its own, would read as "nothing changed". The battery confirm runs
  *before* anything is stopped, so declining one costs the running session
  nothing.

Indefinite sessions offer no `[+]` - there is no bounded thing to add to - and
`caffeine_extend_total` returns 3 rather than inventing a total. Lid sessions
extend like any other, and each extension is itself timed, so the always-timed
invariant survives any number of them.

**Dependency: a sudoers rule.** `environment.etc."sudoers.d/20-caffeine-pmset"`
in [`../nix/modules/darwin-shared.nix`](../../nix/modules/darwin-shared.nix) grants
exactly two argument vectors, no wildcard. `NOPASSWD` is required, not a
convenience: the trap must run unattended at 04:00 and the reconciler runs from
launchd with no tty, so a Touch ID or password prompt would break the auto-clear
and leave the Mac unable to sleep. It adds a rule, so the desktop's
`security.pam.services.sudo_local` (Touch ID for normal sudo) is unaffected.

## The pieces

Change as a set:

- [`scripts/caffeine-lib.sh`](../scripts/caffeine-lib.sh) - **canonical** state
  (`caffeine_state` ON / ON-LID / OFF from pidfile-pid liveness plus the mode
  field), the colour/glyph/token language (`caffeine_state_colour` peach `fab387`
  / maroon `eba0ac`, `caffeine_state_glyph` ☼ / ✷ - both single-width, not the
  double-width ☕ emoji that would break the pill, `caffeine_token` ∞ /
  remaining), and the **drive layer** (`caffeine_start [secs]` /
  `caffeine_start_lid secs` / `caffeine_stop` / `caffeine_toggle` /
  `caffeine_clear_sleep_disabled`), plus `caffeine_clock_at epoch` (wall-clock
  `HH:MM`, trying BSD `date -r` then GNU `date -d @`) and `caffeine_extend_total
  add` - the pure arithmetic behind extending a running session. Sourced, never
  run.
  **Pidfile contract**: `${CAFFEINE_PIDFILE:-$HOME/.cache/tmux-caffeinate.pid}`
  holds one line `pid deadline_epoch mode` (`deadline 0` = indefinite, mode
  `idle`|`lid`). **Field 3 is optional and anything not exactly `lid` reads as
  `idle`**, so pre-lid two-field pidfiles keep working with no migration and a
  garbled field can never claim the privileged mode. `caffeinate -t` self-exits at
  the deadline, so ON-timed clears itself once the pid dies; a stale pidfile reads
  as OFF. No `uname` branch: on Linux the pidfile never exists → OFF.
  `caffeine_sleep_disabled` reads the *real* kernel flag and is deliberately kept
  out of `caffeine_state` - the pill renders every tick and must not fork `pmset`.
  The supervisor `wait`s on its `caffeinate` child rather than `exec`ing it (an
  exec would replace the shell and take the trap with it) and kills it from the
  trap, so a stop leaves no stray caffeinate. `caffeine_stop` **waits** for the
  pid to die: without it an outgoing lid trap can fire *after* a new lid session
  raised the flag, silently disarming a session the pill reports as ON-LID.
- [`scripts/caffeine-popup.sh`](../scripts/caffeine-popup.sh) - `prefix + Alt+k`
  key-loop popup (mem-popup shape). OFF: `i` indefinite, `t` timed
  (30m/1h/2h/4h/8h/12h via fzf), `l` lid-closed (straight to the same picker - lid
  mode has no indefinite path to offer), `q` close. ON / ON-LID: `+` (or `=`) add
  time to what is left - an fzf picker whose rows name the resulting *end time*,
  because "will it outlast the run" is the question being asked and "+1 hour"
  does not answer it - `space`/`o` off, `q` close. The `+` row is hidden while
  indefinite. Both running states also render the end time beside the remaining
  figure, which is what makes the extend decision answerable before the picker is
  even opened. The lid row shows the live power source, and on battery a confirm
  names the costs in the user's terms (drained flat, hot in a closed shell with no
  airflow) and points at `atp --host dev`. A **recovery row** renders in any
  non-ON-LID state whenever `caffeine_sleep_disabled` is true, with `c` to clear
  now; the key is checked *before* the per-state dispatch because a stuck flag can
  coexist with any state. Refreshes the client after each toggle so the pill
  updates at once. Only the *start* action is macOS-gated
  (`command -v caffeinate`); Linux explains it is unsupported and waits for a key.
- [`scripts/caffeine-reconcile.sh`](../scripts/caffeine-reconcile.sh) - layer 2,
  mirroring `resurrect-keepalive.sh` in shape and logging posture (capture rc and
  stderr, never `>/dev/null`). Flag set + no live ON-LID session → clear it, log
  it, and `display-message -c` each attached client by name (from launchd there is
  no current client, so an untargeted message no-ops). Flag set + live ON-LID →
  nothing, the normal case. Unreadable `pmset` → nothing, because a detective
  control must not act on no evidence. A failed clear never fails the run.
  Log at `~/.cache/tmux-caffeine-reconcile.log`. Driven by the launchd agent
  `dev.connorads.tmux-caffeine-reconcile` in
  [`../nix/modules/darwin-shared.nix`](../../nix/modules/darwin-shared.nix), beside
  `dev.connorads.tmux-resurrect-save`: `StartInterval` 300 **and** `RunAtLoad`.
- [`scripts/status-right.sh`](../scripts/status-right.sh) - `caffeine_segment()`,
  a **self-hiding** bright accent pill (width ≥ 80): OFF prints nothing, ON shows
  peach `☼ ∞` / `☼ 42m`, ON-LID maroon `✷ 4h`. No structural change was needed for
  lid mode - it already passes state to `_colour`/`_glyph`, so the escalated
  colour arrives through the existing path; only the self-hide guard has to test
  for OFF specifically rather than for "not ON". Grouped with the other custom-lib
  pills after `resurrect_segment`.

Tests: [`../zsh/tests/caffeine-lib.bats`](../../zsh/tests/caffeine-lib.bats) (pure
lib: state via real pidfiles including the three-field and legacy two-field
forms, mode, remaining/token, colour/glyph, human-age matrix, the
`caffeine_state`-never-forks-pmset guard, `caffeine_sleep_disabled` against a
`pmset` stub, the always-timed refusals, the extend arithmetic with its three
refusals (nothing running / bad addition / indefinite), the cross-platform
wall-clock, and the stop-wait) and
[`../zsh/tests/caffeine-reconcile.bats`](../../zsh/tests/caffeine-reconcile.bats)
(the reconciler's branches, driving `sudo`/`pmset` stubs over a flag *file* so
the two failure shapes - refused, and returns 0 without taking - can be provoked
at all).

The privileged drive path (`caffeine_start_lid`'s happy case) needs real sudo and
mutates a machine-wide kernel flag, so it stays a manual smoke test, as
`caffeine_start`/`_stop` already did: start → `pgrep -fl 'caffeinate -i'` +
`pmset -g assertions` shows `PreventUserIdleSystemSleep` held but not display
sleep → stop → process gone. For lid mode additionally assert `pmset -g | grep
SleepDisabled` is `1` while ON-LID and gone after stop, and prove the actual bug
end to end: start a lid session, shut the lid ~10 min, reopen, and check `pmset
-g log | grep -i clamshell` shows **no** new `Clamshell Sleep` entry in that
window. Keep the pill legend in [`help.md`](../help.md) in sync with the lib.

## Open questions

- Does `SleepDisabled` survive a reboot? It needs a real reboot to settle. The
  design holds either way: `RunAtLoad` on the reconciler is required if the
  flag persists and belt-and-braces if it does not. To settle it, set the
  flag, reboot, run `pmset -g | grep SleepDisabled`, and record the answer in
  place of this item.
