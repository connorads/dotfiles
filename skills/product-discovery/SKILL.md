---
name: product-discovery
description: >-
  Decide what to build before committing to a named solution: reframe outputs
  as measurable behaviour-change outcomes, map alternative opportunities, and
  find the cheapest test of the riskiest assumption. Use when a feature
  request names a solution with no stated outcome, when prioritising or
  choosing what to build next — "what should I build", "roadmap", "which of
  these ideas", "is this feature worth building" — or before writing a PRD
  for a product-facing feature. Sits upstream of PRD/spec writing, which specs
  a committed feature; for journey maps, wireframes, or service blueprints use
  holistic-ux; for forking software-design alternatives use design-forking.
---

# Product Discovery

Every request to build something carries a hidden bet. One question governs
this skill: **what measurable change in user behaviour is this meant to
cause, and what is the cheapest way to learn whether it will?** Shipping the
feature is an output; the behaviour change is the outcome. Hold that question
through the whole session — every step below is a way of answering it.

## Default mode: the discovery gate

Run when handed a named solution ("build X", "add feature Y") whose outcome
is unstated. Four steps, in order, before any speccing:

1. **Output or outcome?** Restate the goal as a measurable change in user
   behaviour ("more users return in week two", not "ship saved searches").
   If no plausible outcome exists, say so — that is a finding, not a failure.
2. **Map at least two opportunities.** Name other unmet needs, pains, or
   desires that could serve the same outcome. The point is not to derail X
   but to make choosing X a decision instead of a default.
3. **Name the riskiest assumption.** The single assumption whose failure
   sinks X — check desirability (will they want it), viability (does it
   pay), feasibility (can we build it), usability (can they use it).
4. **Propose the cheapest test.** The smallest probe that could kill the
   assumption before committing: a fake door, a throwaway prototype, five
   user conversations, a query over existing behaviour data.

Then stop and present the result; do not continue into design or
implementation unasked.

**Escape hatch:** if the outcome is already stated, or discovery has clearly
happened (research cited, bet explicitly made), note that in one line — at
most also flag the single riskiest assumption the stated evidence leaves
untested — and still deliver what was asked. Do not withhold the deliverable
once outcome and evidence are stated. Never run the gate on migrations, refactors, or internal tooling
with no user-facing behaviour to change — build what was asked.

## Session mode: open-ended discovery

For "what should I build next" and prioritisation work, run as an interview,
one topic per turn, building an opportunity solution tree:

- Root: one outcome, stated as a measurable behaviour change with a leading
  indicator.
- Branches: opportunities sourced from observed behaviour and specific past
  moments ("tell me about the last time…"), not opinions or feature ideas.
- Compare sibling opportunities by expected effect on the outcome, not by
  how appealing the feature is to build.
- Only then attach candidate solutions (at least two per chosen opportunity)
  and an assumption test for the front-runner.

## Output

A short brief, not a document: outcome → chosen opportunity → candidate
solution(s) → riskiest assumption → cheapest test → recommendation. If the
decision is to build, hand off to PRD/spec writing — discovery decides
whether and which; the spec defines the end state.

## Boundaries

- **PRD/spec writing** (the prd skill, where present) — specs a committed
  feature's end state; this skill decides whether and which feature earns
  that commitment.
- **holistic-ux** — journey maps, service blueprints, wireframes, UX
  heuristics; discovery here is product-level, not design artefacts.
- **design-forking** — forks solution alternatives at the software-design
  layer; opportunity branching here happens at the problem layer.

`evals/prompts.md` holds this skill's test prompts and expected behaviours —
for revising the skill, not for performing discovery.
