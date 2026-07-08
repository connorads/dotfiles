---
name: holistic-ux
description: >
  Strategic UX and service-design skill for framing user problems before code or
  visual polish. Use when a request involves user experience, journey maps,
  service blueprints, user flows, low-fidelity wireframes, heuristic reviews,
  cognitive load, jobs to be done, onboarding/drop-off/trust/confusion, or
  synthesising user research into design decisions. Prefer this skill when the
  user asks why an experience is not working, what flow should exist, or what
  artefact would help stakeholders decide. Do not use it for code-level WCAG,
  ARIA, screen-reader, or keyboard fixes; use the accessibility skill for those.
---

# Holistic UX Design

Use this skill to design experiences as systems. The goal is not to make an
interface look nicer; it is to understand what progress the user is trying to
make, what blocks that progress, and what artefact will help the next decision.

## Boundaries

Use this skill for:

- diagnosing confusing, slow, low-trust, high-drop-off, or hard-to-complete
  experiences
- mapping user flows, journey maps, service blueprints, and low-fidelity
  wireframes
- running product/flow-level heuristic reviews
- translating research notes into themes, opportunities, and design principles
- reasoning about cognitive load, JTBD, backstage processes, and failure paths

Route elsewhere when the request is really:

- **Code-level accessibility:** WCAG, ARIA, keyboard, focus, screen-reader, or
  semantic HTML fixes belong in the `accessibility` skill.
- **Visual polish or frontend styling:** spacing, type, colour systems, shadows,
  imagery, and refined component styling belong in `ui-design-playbook`.
- **Performance or motion:** first paint and layout shift belong in
  `first-load-web-perf`; animation timing and perceived jank belong in
  `web-animation-design`.

Accessibility still matters here, but at this level it is a design constraint
and risk note. Do not run a WCAG checklist from this skill.

## Operating Protocol

1. **Gather evidence first.** Inspect the product, screenshot, code, metrics,
   transcript, research notes, or prompt details before proposing a flow. If
   evidence is missing, state assumptions and ask only for what blocks the next
   decision.
2. **Name the real problem.** Distinguish the visible event from repeated
   patterns, enabling structures, and underlying assumptions.
3. **Choose the smallest useful artefact.** Produce the thing that supports the
   decision: findings, flow, journey map, blueprint, synthesis, or wireframe.
4. **Design beyond the screen.** Include backstage systems, handoffs, failure
   modes, recovery paths, and stakeholder ownership when they affect the user's
   experience.
5. **Keep fidelity honest.** Do not over-design. If the decision is about
   sequence or service delivery, a flow or blueprint beats a polished screen.
6. **Verify the output.** Check that recommendations follow from evidence,
   reduce extraneous cognitive load, cover critical states, and identify any
   accessibility handoff.

## Problem Framing

Most UX requests arrive as symptoms. Look one or two layers deeper before
solving:

```text
Event         Users abandon checkout at shipping address
Pattern       Mostly mobile, mostly returning customers
Structure     Address entry is desktop-shaped; saved addresses are hidden
Assumption    Checkout was modelled as a one-session, new-customer task
```

Use this framing to avoid cosmetic fixes for structural problems.

Classify complexity:

| Domain | What it looks like | UX response |
| --- | --- | --- |
| Clear | Known pattern, obvious cause | Apply a convention or checklist |
| Complicated | Several plausible designs | Analyse evidence, then choose |
| Complex | Cause unclear, trust/behaviour involved | Probe with research or experiments |
| Chaotic | Urgent breakage or live harm | Stabilise first, learn later |

Treat UX laws as diagnostic prompts, not proof. Hick, Fitts, Miller,
Peak-End, Jakob, and aesthetic-usability can suggest what to inspect; they do
not replace evidence from the actual context.

## Artefact Selector

Ask: "What decision will this support?"

| Need | Output |
| --- | --- |
| Prioritise issues in an existing flow | Heuristic review |
| Explain how a user completes one task | User flow |
| Understand behaviour and emotion over time | Journey map |
| Align screen work with operations and systems | Service blueprint |
| Turn research into design direction | Research synthesis |
| Communicate rough layout and hierarchy | Low-fidelity wireframe |

If multiple artefacts seem useful, start with the one closest to the decision.
For example, do not blueprint a simple form fix; do not wireframe before the
flow is understood.

## Output Formats

### Heuristic Review

Use for an existing product, screen, or flow. Read
`references/heuristics.md` when doing a detailed review.

```markdown
## Heuristic review: [screen or flow]

### Summary
[1-2 sentences on the most important user-impacting issues.]

### Scope and evidence
- User/task:
- Evidence reviewed:
- Assumptions:

### Findings

#### [Severity 4] [Finding title]
**Heuristic:** [Nielsen/Norman principle]
**Evidence:** [What was observed]
**Impact:** [Who is affected and how often, if known]
**Recommendation:** [Specific fix]

### Severity guide
- 4: blocks completion or causes serious harm
- 3: major friction; users may abandon or need support
- 2: noticeable friction with a workaround
- 1: polish issue with low task impact
```

Severity should be based on task impact, frequency, persistence, and confidence.
Do not present a heuristic review as a substitute for user research.

### User Flow

Use for one user, one goal, and the decisions/error paths needed to complete it.

```text
[Entry point]
    |
    v
[Step]
    |
    v
{Decision?}
  | yes                  | no
  v                      v
[Next step]          [Recovery / exit]
```

Include entry points, decision points, errors, recovery paths, and exit points.

### Journey Map

Use when the emotional and cross-touchpoint experience matters.

```markdown
## Journey map: [user goal]

**Persona or segment:** [Who, based on evidence]
**Scenario:** [Context]
**Evidence:** [Research/metrics/source]

| Phase | Phase 1 | Phase 2 | Phase 3 |
| --- | --- | --- | --- |
| Doing |  |  |  |
| Thinking |  |  |  |
| Feeling |  |  |  |
| Touchpoints |  |  |  |
| Pain points |  |  |  |
| Opportunities |  |  |  |
```

Mark invented assumptions clearly. Do not fabricate emotions from thin context.

### Service Blueprint

Use when a screen depends on people, policy, backend systems, third parties, or
operational handoffs. Read `references/service-design.md` for detailed guidance.

```markdown
## Service blueprint: [service]

**Journey:** [Specific journey being blueprinted]
**Business/user goal:** [What this must enable]

| Layer | Stage 1 | Stage 2 | Stage 3 |
| --- | --- | --- | --- |
| Evidence |  |  |  |
| Customer actions |  |  |  |
| Frontstage |  |  |  |
| Backstage |  |  |  |
| Support processes |  |  |  |
| Failure/recovery |  |  |  |
| Owner |  |  |  |
```

Blueprints should expose hidden operational work, not restate the journey map.

### Research Synthesis

Use when the input is interviews, survey notes, support tickets, session
recordings, or messy feedback. If available, read
`references/research-synthesis.md`.

```markdown
## UX research synthesis: [topic]

### Evidence base
- Sources:
- Segments:
- Confidence:

### Themes
| Theme | Evidence | User impact | Design implication |
| --- | --- | --- | --- |

### Jobs and unmet needs
- When [situation], users need [progress], so they can [outcome].

### Opportunities
| Opportunity | Why it matters | Risk/unknown | Next step |
| --- | --- | --- | --- |
```

Separate evidence from interpretation. Keep unresolved contradictions visible.

### Low-Fidelity Wireframe

Use only when rough layout and hierarchy are the decision. Keep it plain and
annotated; leave visual polish to `ui-design-playbook`.

```text
+------------------------------------------------+
| [Logo]                         [Primary nav]   |
+------------------------------------------------+
| Main task headline                             |
| Supporting context                             |
|                                                |
| [Primary action]    [Secondary action]         |
|                                                |
| Empty/loading/error states noted here          |
+------------------------------------------------+
```

Annotations should cover hierarchy, critical states, responsive behaviour, and
accessibility handoffs.

## Jobs To Be Done

Use JTBD to describe progress, not just features:

```text
When [situation],
I want to [motivation],
so I can [expected outcome].
```

Also capture:

- functional success: what task gets done
- emotional success: how the user needs to feel
- social success: how the user wants to be seen
- current workaround or competitor
- anxiety and habits that make switching hard

JTBD complements personas; it does not replace segments, constraints, or
research evidence.

## Quality Checks

Before delivering:

- Did the output answer the decision that matters now?
- Did you inspect evidence before proposing a design?
- Did you distinguish symptoms from structures?
- Did you consider backstage systems, handoffs, and failure recovery?
- Did you reduce extraneous cognitive load without pretending intrinsic
  task complexity can disappear?
- Did you avoid overclaiming beyond the evidence?
- Did you note accessibility risks and hand off detailed WCAG work to the
  `accessibility` skill?

## Reference Routing

- `references/mental-models.md` - systems thinking, Iceberg, Cynefin, leverage
  points, and organisational seams.
- `references/service-design.md` - service blueprints, JTBD, stakeholder maps,
  touchpoints, and failure modes.
- `references/research-synthesis.md` - research-note synthesis, confidence,
  themes, opportunities, and contradictions.
- `references/design-psychology.md` - cognitive load and UX laws as diagnostic
  lenses.
- `references/heuristics.md` - Nielsen, Norman, Shneiderman, and severity
  guidance for reviews.
- `references/patterns.md` - quick pattern choice for low-fidelity flows only.

Remember: good UX work makes the user's task easier and the service more
coherent. The screen is only one part of the system.
