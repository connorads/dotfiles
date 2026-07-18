---
name: refactoring
description: >-
  Refactor and restructure existing code safely without stopping delivery.
  Use when inheriting a
  legacy, untested, or vibe-coded/AI-generated codebase, deciding where to
  start on a ball of mud, planning an incremental migration to a new
  architecture, ORM, framework, or provider, replacing a dependency without a
  feature freeze, making zero-downtime database schema changes, escaping a
  long-lived rewrite branch, or paying down technical debt. Owns the migration
  path and its sequencing; the architecture skill owns the target shape, the
  testing skill owns test design.
---

# Refactoring

One question governs every move:

> **While this step is in flight, how do we get back to green — and once it
> lands, what stops it rotting again?**

Reversible in flight, ratcheted once landed. The system stays releasable at
every commit; a refactor that needs the trunk broken for a week is a rewrite
wearing a disguise.

The sections below are constraints a good plan satisfies, not a template to
recite: shape the plan around the specific situation, keep its steps concrete
to the codebase at hand, and skip a constraint only when it genuinely does not
apply.

## One precondition, two halves

Before restructuring anything, both halves of the safety net must exist:

- **Behavioural net** — characterisation tests pinning what the code actually
  does, warts included. Never fix a bug while pinning: a corrected snapshot
  poisons the net. If the wart matters, record it and fix it as its own change
  afterwards, under the net.
- **Deployment confidence** — reproducible build, a smoke-test gate, and an
  instant rollback path. On a legacy app, application-level feature flags come
  before canary infrastructure: no traffic-routing retrofit, and a kill switch
  that needs no redeploy.

Teams reliably build the first half and skip the second; tests without cheap
rollback still make every refactor scary to ship. Treat the pair as one
precondition. Mechanics for both are in
[references/legacy-rescue.md](references/legacy-rescue.md).

## Name the pain, not the diagram

When the goal arrives as an architecture name — "migrate this to clean
architecture / hexagonal" — do not accept the diagram as the goal. Convert it:
which changes are currently slow or scary, in which parts, and what evidence
says so? Every structural move must cite the concrete pain it removes; a slice
with no pain attached does not get scheduled, however untidy it looks.
Full-codebase conversion to a reference architecture is never the target —
stable code nobody changes keeps its mess. What the target shape should be is
the `architecture` skill's job; this skill owns the route.

## Pick targets by churn × complexity

Fear and ugliness are not selection criteria. Refactor where change frequency
and complexity intersect — hotspots, in Adam Tornhill's sense — because that
is where effort compounds:

```sh
git log --format= --name-only --since=12.month | sort | uniq -c | sort -rn | head -20
```

Cross the churn list with file size — lines predict about as well as any
complexity metric at this stage. High-churn tangled code pays back
immediately; pristine-looking but stale code pays back never. This ranks
*refactoring payback*; sequencing a whole modernisation programme weighs
momentum and dependency-unblocking too — see
[references/migration-patterns.md](references/migration-patterns.md).

## The file is often the wrong unit

Churn × complexity finds the file, but the file is not always the thing to
act on:

- **The hotspot is huge.** A 10k-line file is a system, not a unit. Re-run
  churn × complexity at function scope — Tornhill's *X-Ray*: map each
  revision's hunks to functions, rank by change count × length — and act on
  the one churning method, not the file.
- **The pain is a hidden dependency.** Files that keep changing in the same
  commits are coupled in time even when no dependency shows in the code; that
  invisibility is the point, so mine it rather than reason from source:

  ```sh
  f=path/to/file
  git log --format=%H -- "$f" \
    | while read c; do git show --format= --name-only "$c"; done \
    | grep -vFx "$f" | sort | uniq -c | sort -rn | head
  ```

  Expected pairs (a test with its subject) are fine; a *surprising* pair with
  no code-level link is the signal — a missing abstraction, a clone that
  co-evolves, or a boundary drawn in the wrong place. The target is the
  coupling, not either file. Corollary for duplication: clone-and-diverge is
  fine; deduplicate only clones that actually keep changing together.

## When the change fights back: Mikado

Extractions rarely lift out cleanly; the true dependency fan-out is invisible
until you touch it. When an attempted change cascades — "can't move X until Y,
and Y needs Z" — stop patching forward. Use the Mikado method (Ellnestam &
Brolund):

1. Write the goal down, concretely.
2. Try it naively; let the compiler and tests reveal what breaks.
3. Record each blocker as a prerequisite node in a goal graph.
4. **Revert to green.** Then attempt a leaf prerequisite and repeat.

Reverting is the point, not waste: a failed experiment's output is the graph,
not the code, and experiments only give trustworthy signal from a known-good
state. Continuing from a half-broken state is how refactors snowball into
stuck branches. Commit each coherent change that lands green — often one leaf,
sometimes a few bundled so the commit makes sense; the goal is done when it
has become a leaf itself.

Only graph what won't fit in your head: one flat level of independent
prerequisites is a to-do list; reach for the graph when prerequisites sprout
their own. Traverse breadth-first to size an unknown change, depth-first when
you already know where the code should land. While the graph grows faster
than you tick nodes off you are still exploring; once that inverts, the work
is landing leaves. If it outgrows a glance, coarsen nodes into bundled steps
or split it into independent subgraphs. An apparent cycle — X needs Y, Y
needs X — splits rather than blocks: decompose one side into smaller steps
and an order appears.

## Ratchet each won boundary

The step after a slice lands is a machine check, in the same PR or the next:
an import ban, a dependency-cruiser rule, an architecture test asserting the
dependency direction. Conventions, documentation, and campsite rules do not
survive contact with deadlines — a boundary protected only by discipline
re-rots, and re-cleaning it costs the migration its credibility. The
`mechanical-enforcement` skill owns choosing the rule; this skill's rule is
that winning a boundary and enforcing it are one step, not two.

## Transitional things carry deletion conditions

Every seam, wrapper, dual write, sync trigger, compatibility view, feature
flag, and legacy-shaped facade is scaffolding: name its deletion condition
when you introduce it, not later — "delete when no module imports Sequelize",
"drop when old-column reads are zero for two weeks". Write the removal change
at the same time as the expand change and park it. Gate the contract step on
*measured* residual old-path usage; a calendar date is the backstop, not the
trigger. Expand/migrate without contract leaves the system worse than it
started — two sources of truth, permanently.

## References

| When the task involves… | Read |
|---|---|
| Replacing a live subsystem, dependency, schema, or whole system: strangler fig, branch by abstraction, parallel change, expand–migrate–contract, event interception, escaping a rewrite branch | [references/migration-patterns.md](references/migration-patterns.md) |
| Taking over an inherited, untested, or AI/vibe-coded codebase: characterisation and seams, deployment-confidence bootstrap, AI-specific pathologies and agent guardrails | [references/legacy-rescue.md](references/legacy-rescue.md) |

Boundaries: `architecture` defines the destination and its module boundaries;
`testing` owns test design in depth; `mechanical-enforcement` owns the exact
lint/architecture rules; this skill owns sequencing the journey.

`evals/evals.json` holds this skill's regression probes, judge checklist, and
trigger-routing set, with grading instructions inline — run them when revising
this skill.
