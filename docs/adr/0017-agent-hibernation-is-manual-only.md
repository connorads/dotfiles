# Agent hibernation is manual only

## Context

[0011](0011-automatic-agent-hibernation-is-pressure-gated.md) shipped the sweep
policy in `observe` and waited for real `CRITICAL` episodes before deciding whether
to turn it on. memwatch's emergency tier read the same tmux mode, so it stayed in
`observe` too.

The episode happened. From 2026-09-13 to 2026-09-20 the sweep journalled 776
`CRITICAL` evaluations: 663 `proposed` and 113 `no-candidate`. Every proposal named
one of two panes, `%166` (477) and `%113` (186). From 2026-09-21 to 2026-09-28
memwatch logged 76 `would hibernate` lines. Neither actor ever acted, because
neither ran in `on`.

## Decision

Hibernation is manual only: `agent hibernate`, `prefix + Alt+z`, the memory popup
and the pane menu. Nothing stops a pane without a hand on the keyboard.

`agent-autohibernate.sh`, the `@agent_auto_hibernate` mode, the pin store and its
menu items, `agent auto|pin|unpin`, the engine's `--auto` commit and `probe` port,
and memwatch's emergency tier are deleted. memwatch still watches, notifies, logs
and runs its stall probe.

## Alternatives considered

- **Turn the sweep policy `on`.** A week of sustained `CRITICAL` produced candidates
  in only two panes, so the policy would have reclaimed two conversations at most.
  Its identity, pin and claim checks were the largest part of the hibernate engine.
- **Keep both actors in `observe`.** Observation had delivered its data. Leaving it
  running returns no memory and keeps the whole automatic path in place.
- **Keep memwatch's emergency tier behind its own switch.** It shared the sweep's
  mode, pins and lock, so it would need its own copy of each. The owner chose manual
  only, with the tier removed.
