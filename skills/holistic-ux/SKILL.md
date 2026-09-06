---
name: holistic-ux
description: >-
  Diagnoses user-experience and service problems from evidence, then chooses the
  smallest decision-support artefact: research synthesis, journey map, service
  blueprint, user flow, heuristic review, or low-fidelity wireframe. Use for
  onboarding, drop-off, trust, confusion, recovery, cross-channel journeys,
  backstage operations, user research synthesis, or requests to map or review an
  experience before implementation or visual polish. Not for choosing which
  product feature to build, code-level accessibility fixes, visual styling,
  performance diagnosis, implementation, or presentation graphics.
---

# Holistic UX

> No populated claim or artefact cell may outrun its source evidence.

The useful output is not the fullest map. It is the smallest artefact that helps
someone make the next decision without turning plausible detail into fact.

## Boundaries

Use this skill to diagnose or shape an experience once the user-facing outcome
or capability is known. It covers the user's task across screens, channels,
people, policies and systems when those surfaces affect completion.

Route away and stop when the request is primarily:

- **Which feature or opportunity to pursue**: use product discovery.
- **ARIA, semantics, keyboard, focus, contrast or screen-reader code**: use web
  accessibility.
- **Typography, colour, spacing, imagery or polished components**: use UI or
  visual design.
- **Loading performance, layout shift or runtime responsiveness**: use web
  performance.
- **Implementing an agreed flow**: use the relevant engineering skill.
- **Polishing a journey graphic or presentation**: use presentation design.

Name the target discipline and add at most one sentence about the experience
risk. Do not perform the routed task from this skill.

Do not use coercive friction to improve retention, conversion, consent, pricing,
opt-out or cancellation. A choice remains findable, understandable and no harder
to leave than to enter.

## Protocol

### 1. Name the decision

State the decision this work must support, the user, their task and the context
in which the task occurs. If the request names an artefact, confirm that the
artefact supports the decision before producing it.

### 2. Inventory the evidence

Label every material input:

- **Measured**: a metric with population, event definition and time window.
- **Observed**: behaviour directly watched or recorded in a named source.
- **Reported**: what a participant, operator or stakeholder said, with speaker
  and context.
- **Inferred**: an explanation that could account for evidence but has not been
  observed directly.
- **Assumed**: necessary context that has not been checked.

The label applies to each claim, not to a whole document. A metric can establish
where users leave without establishing why. A stakeholder report is evidence of
the stakeholder's belief, not automatically evidence of user behaviour.

When the input includes research notes, conflicting sources, recordings,
vulnerable participants or personal data, read
`references/diagnosis-and-evidence.md`.

### 3. Keep rival explanations alive

Do not turn a symptom into a structure or motive. Name the smallest set of
plausible explanations that still fit the evidence. For each, state the cheapest
observation whose possible outcomes would distinguish it from the others.

If no available observation discriminates the rivals, the honest deliverable is
a research or instrumentation step. A polished redesign cannot repair an open
diagnosis.

### 4. Choose the smallest useful artefact

| Decision need | Artefact |
| --- | --- |
| Separate evidence, interpretation and opportunity | Research synthesis |
| Understand an evidenced experience over time | Journey map |
| Connect customer actions to delivery and ownership | Service blueprint |
| Specify one task's decisions, recovery and exits | User flow |
| Inspect an existing interaction against principles | Heuristic review |
| Decide rough hierarchy and states before visual design | Low-fidelity wireframe |

Use one primary artefact. Add a second only when the decision depends on a
different view that the first cannot express.

Read the matching reference before producing it:

| Task | Read |
| --- | --- |
| Research synthesis or causal diagnosis | `references/diagnosis-and-evidence.md` |
| Journey map or service blueprint | `references/service-mapping.md` |
| User flow, heuristic review or low-fidelity wireframe | `references/artefact-guides.md` |
| Any retained empirical principle or factual framework claim | `references/evidence.md` |

### 5. Preserve unknowns

Populate an artefact cell only from supplied evidence. Put `Unknown`, `Not
measured`, or `TBD` where evidence is absent. Never invent a persona, quote,
emotion, motive, actor, system, policy, frequency or recovery route to make an
artefact look complete.

Separate current state from proposed state. Proposed steps are recommendations,
not discoveries about how the service already works.

### 6. Match the recommendation to what is known

- **Issue and mechanism evidenced**: recommend a change and the measure that
  would show whether it helped.
- **Issue evidenced, mechanism open**: recommend the discriminating observation
  first. Include only reversible, low-regret changes that help across the live
  explanations.
- **Evidence thin or absent**: provide a provisional artefact with visible
  unknowns and the next research step.

Name the primary outcome, guardrails and population. Do not optimise a proxy
without checking whether completion, error, trust, support demand or another
downstream outcome worsens.

### 7. Keep research safe

Collect only data needed for the decision. Before recording sessions, personal
details, vulnerable users or sensitive subjects, define consent, access,
retention, anonymisation and deletion. Never recommend session replay or broad
recording without addressing masking and participant privacy.

## Output

Lead with the decision or finding. Then show:

1. Evidence and its status.
2. What remains unknown or contradictory.
3. The smallest useful artefact.
4. A recommendation proportional to the evidence.
5. The observation or measure that decides what happens next.

Do not narrate this protocol. Apply it.

`evals/` holds maintainer-facing trigger and behaviour tests. It is not task
guidance.
