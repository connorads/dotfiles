# Migration patterns

Decision rules for replacing live systems and interfaces incrementally.
Distilled largely from the Patterns of Legacy Displacement catalogue by Ian
Cartwright, Rob Horn and James Lewis
(martinfowler.com/articles/patterns-legacy-displacement/) and Martin Fowler's
related bliki entries — consult those for worked examples.

Framing that changes decisions: legacy modernisation is at most half a
technology problem — ways of working, ownership, and leadership carry the
rest. Start from a business outcome (cost of change, process improvement,
retirement, imminent disruption), never from "rewrite it". Patterns below
compose; a real displacement typically stacks several.

## Choosing a pattern

| Situation | Pattern |
|---|---|
| Whole system too patched to adapt; users can't wait years | Strangler fig |
| One widely-depended-on module/library/framework to swap | Branch by abstraction |
| One overgrown file, congested under parallel development | Splinter |
| Backward-incompatible interface or schema change, many consumers | Parallel change (expand–migrate–contract) |
| New capability needs legacy state changes; legacy too risky to modify | Event interception |
| New component must satisfy an implicit legacy contract meanwhile | Legacy mimic |
| Legacy is an accidental integration hub for data born elsewhere | Revert to source |
| A long-lived rewrite branch is diverging from main | Escape it (below) |

## Sequencing a programme

Churn × complexity ranks refactoring payback; it does not pick the first
slice of a multi-capability modernisation. The first slice's job is evidence
and momentum: deliverable end-to-end within a quarter, validating the risky
assumptions — tech choices, path to production, organisational readiness —
while shipping real user value. That is rarely the churniest hotspot or the
crown-jewel capability. A low-value shared subsystem that the high-value
capabilities all depend on is often the right first target: it stops
bottlenecking them, and the patterns get learned somewhere low-risk. Never
let low-value work block or starve a high-value initiative — the commonest
way a programme stalls. Filter by strategic value regardless: a churny but
generic area (invoicing, auth) earns cost-of-change relief, not a rich
rebuild (the `architecture` skill's Scale Rule).

## Strangler fig

Grow the new system around the old: new features land in the new structure
first, seams peel capabilities off one at a time, traffic shifts
incrementally, legacy retires piece by piece. Old and new coexist throughout —
budget for that coexistence code; it is risk mitigation, not waste.

- It does **not** imply microservices or any architecture style. The new
  implementation can be a module in the same deployable. What matters is the
  seam.
- It does not make displacement easy — it makes cost and returns visible and
  incremental, which is the actual win.
- **Feature parity is a trap.** "Replicate everything, then switch" converts
  the migration back into a big-bang release. Deliver value in slices; let
  unused legacy behaviour die unreplicated.

## Branch by abstraction

For swapping something many call sites depend on (ORM, payment provider,
home-grown queue) while releasing continuously:

1. Insert an abstraction capturing how clients use the current supplier.
2. Move all clients onto the abstraction — mechanical, low-risk PRs.
3. Build the new supplier behind the same abstraction.
4. Switch clients or traffic over incrementally (a flag helps verify).
5. Delete the old supplier; keep or collapse the abstraction on merit.

The build stays green and trunk stays releasable at every step — that is the
test of whether you are doing it right. It is an in-codebase seam, not a VCS
branch. Poor fit when all clients genuinely must switch atomically.

## Splinter a congested hotspot

Branch by abstraction swaps a supplier many files depend on; Tornhill's
splinter is its intra-file cousin for one overgrown hotspot too big to
refactor in a pass and too central to freeze. Split it along its
responsibilities into cohesive modules, keeping the original file as a facade
whose methods delegate to the extractions so callers never see the churn.
Prioritise extraction by function-level churn (the X-Ray in the SKILL) —
highest-activity behaviour first. You are not improving quality yet, only
carving out space to work safely in parallel.

- **Trunk, not a branch, in one- to two-hour steps.** This is where branching
  hurts most: a long-lived branch loses the merge race against a file
  everyone is still editing, and its false safety tempts oversized steps.
- **Precede each extraction with a proximity move** — reorder co-changing
  functions to sit adjacent. Low-risk, and often enough on its own; moving
  clones together beats abstracting them under deadline.
- **Resist the shared abstraction when the shared knowledge is small or the
  clones model different domain concepts.** A forced abstraction collects
  control flags and boolean parameters and ends up worse than the
  duplication. Where you must share, name the module to signal incompleteness
  (`Dumpster`, not `Common`/`Util`) so it doesn't attract more code.
- **Afterwards, let recent churn pick the next move**: re-run hotspot
  analysis with `git log --after=<split date>` and refactor only the
  splinters that keep changing.

## Parallel change (expand–migrate–contract)

For any backward-incompatible change to an interface with consumers you can't
update atomically — function signatures, APIs, events, database schemas.
Expand: add the new form alongside the old. Migrate: move consumers one at a
time, releasable throughout. Contract: remove the old form.

- **The hard part is finishing.** Contract is the scaffolding-removal step;
  the SKILL.md deletion-condition discipline applies verbatim — removal change
  written alongside expand, removal gated on measured old-path usage.
- For schemas: backfill, then keep old and new consistent during migrate via
  a sync trigger (database-guaranteed) or app-level dual writes; expose old
  names as views for unmigrated readers. Transition periods run long —
  automate every step as versioned, ordered migrations, because staff turn
  over before contract.

## Event interception

Tap the legacy system's existing integration points — messaging wire-taps,
gateway routing, database triggers emitting events — to feed the new system
without modifying legacy internals. Take care never to alter existing write
behaviour: implicit contracts live there. Check the cheaper alternative first:
if you can simply change the caller to call the new system directly, do that;
interception is for when the caller can't be touched.

## Legacy mimic vs anti-corruption layer

A **mimic** makes the new system speak the legacy's language — providing or
consuming legacy-shaped interfaces — so unreplaced components never notice the
change. It is transitional by definition: it must not survive into the target
architecture.

An **anti-corruption layer** (Evans) translates a foreign model you don't
control into your own domain types so its shape never leaks inward — and it
lasts as long as the integration does, often permanently. Same translation
machinery, opposite default lifespan. Confusing them either deletes a boundary you
need or fossilises scaffolding you don't. The `architecture` skill covers the
ACL as a port/adapter concern.

## Revert to source

When downstream consumers read data from legacy that actually originates
elsewhere, trace the flows and integrate at the true source, bypassing legacy.
Hidden upside: legacy hubs filter fields and batch-delay data, so source
integration is often richer and fresher. Watch for bidirectional flows (writes
may still need to route back) and source systems never sized for the new load.

## Escaping a long-lived rewrite branch

Kill the branch, not the improved architecture. A months-old v2 branch
diverging from a moving main is the big-bang failure mode in slow motion:
the remaining half takes longer than the first, against a target that keeps
moving. Harvest instead: land the branch's best structures into main as
strangler slices — one capability at a time, behind the same seams as any
other migration — and let the branch die. Progress restarts the day the first
slice ships from trunk.
