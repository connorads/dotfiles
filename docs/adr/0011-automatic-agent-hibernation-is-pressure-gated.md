# Automatic agent hibernation is pressure-gated

## Context

An idle agent process can retain hundreds of megabytes. On the desktop, the
manual hibernation picker has exposed twenty Claude or Codex panes totalling
about 5.2 GB of sampled footprint while memory state was `CRITICAL` and swap
usage was 9.6 GB.

Age alone is not a reason to stop a resumable conversation. Automatic shutdown
also has a stricter safety boundary than the manual command: `done` is unread
work, visibility can be shared through linked windows, and a stale pane ID can
refer to a different process after a tmux restart.

## Decision

The existing per-server agent sweep owns automatic eligibility. It evaluates a
whole-server snapshot only after sustained `CRITICAL` memory state. It does
nothing under `OK` or `BUSY`, or on hosts where the macOS pressure vocabulary is
unavailable.

A candidate is an exact Claude or Codex process in the `idle` state for at least
24 hours. It is hidden from every attached client, unpinned by stable
conversation identity, and has a complete recovery probe. Missing evidence
refuses the action.

The hibernation engine compares the prepared pane, process, conversation, idle
instant, visibility and pin revision immediately before shutdown. Automatic
execution has no force path. It acts once per 15 minutes and at most twice per
uninterrupted critical episode.

The tracked default is `observe`. This runs the production decision path and
journals metadata-only proposals without stopping a process. `on` is a live
tmux-server choice after observation and manual recovery checks.

## Alternatives considered

- **Hibernate every old conversation.** This spends resume latency when memory
  has no need for relief. No observation supports action under `OK` or `BUSY`.
- **Give each conversation a timer lease.** Correctness spreads across timer
  generations, focus hooks, topology hooks and lifecycle-hook ordering. The
  whole-server sweep already owns the facts the policy needs.
- **Run a launchd memory controller.** The pressure trigger fits, but a second
  daemon duplicates tmux reconciliation, splits lifecycle ownership and cannot
  serve the non-macOS hosts.
- **Remain manual-only.** This is the safe fallback and remains available. It
  cannot reclaim memory while the machine is unattended.
- **Rank by sampled footprint.** Footprint attribution is expensive and less
  stable than idle age. Oldest-first is deterministic while the observation
  journal establishes whether a more complex ranking earns its cost.

## Consequences

Existing idle panes start a fresh idle interval and cannot hibernate
immediately after deployment. Pinned conversations stay manually hibernatable.
OpenCode stays outside the eligible set until it has a lifecycle adapter with
the same recovery guarantees.
