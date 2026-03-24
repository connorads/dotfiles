---
name: prd
description: Create Product Requirements Documents (PRDs) that define the end state of a feature through iterative design interview. Use when planning new features, migrations, or refactors. Generates structured PRDs with acceptance criteria, testing strategy, and architectural decisions.
---

# PRD Creation Skill

Create Product Requirements Documents suitable for RFC review and for AI agents to implement from.

The PRD describes WHAT to build and WHY, not HOW or in WHAT ORDER.

## Workflow

### 1. Gather context

User describes the problem and any initial ideas. Explore the codebase to understand existing patterns, constraints, and dependencies.

### 2. Interview the design tree

Walk through the design decision tree branch by branch. For each decision point:
- **Explore the codebase first** — only ask the user what the code can't answer
- **One topic per turn** — don't dump multiple questions at once
- Resolve dependencies between decisions before moving on

Cover these domains as the tree branches into them:
- Problem & motivation (what, who, why now, cost of inaction)
- Users & stakeholders
- End state & success criteria
- Scope & boundaries (what's in, what's explicitly out, what must NOT be affected)
- Constraints (performance, security, compatibility, accessibility)
- Risks & dependencies
- Alternatives considered

If ambiguous or overloaded domain terms surface, flag them and propose canonical terms.

Keep going until shared understanding is reached. No artificial cap on questions.

### 3. Identify modules

Sketch the major modules to build or modify. Look for opportunities to extract **deep modules** — small interface hiding lots of implementation, testable in isolation.

Check with the user:
- Do these modules match their mental model?
- Which modules warrant dedicated tests?

### 4. Write the PRD

Generate markdown PRD to `prd-<feature-name>.md` in project root. Use the template below, including only sections relevant to the feature.

## Template

```markdown
# PRD: <Feature Name>

**Date:** <YYYY-MM-DD>

---

## Problem Statement

### What problem are we solving?
Clear description of the problem. Include user impact and business impact.

### Why now?
What triggered this work? Cost of inaction?

### Who is affected?
- **Primary users:** Description
- **Secondary users:** Description

---

## Proposed Solution

### Overview
One paragraph describing what this feature does when complete.

### User Experience (if applicable)
How will users interact with this feature? Include user flows for primary scenarios.

### Design Considerations (if applicable)
- Visual/interaction requirements
- Accessibility requirements (WCAG level)
- Platform-specific considerations

---

## End State

When this PRD is complete, the following will be true:

- [ ] Capability 1 exists and works
- [ ] Capability 2 exists and works
- [ ] All acceptance criteria pass
- [ ] Tests cover the new functionality
- [ ] Observability/monitoring is in place

---

## Acceptance Criteria

### Feature: <Name>
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

---

## Durable Architectural Decisions

Decisions unlikely to change regardless of implementation order:

- **Routes/URL patterns:** ...
- **Schema shape:** ...
- **Key data models:** ...
- **Auth/authorisation approach:** ...
- **Third-party service boundaries:** ...

Include only what applies. These anchor the PRD for anyone implementing from it.

---

## Modules

Major modules to build or modify, with interface sketches where helpful.

Do NOT include specific file paths or code snippets — they become outdated quickly. Describe modules by name and responsibility.

- **Module name:** What it owns, what it hides, how callers interact with it
- **Module name:** ...

---

## Testing Strategy

- Which modules are tested and at which tier (unit / integration / component / e2e)
- What makes a good test for this feature (test behaviour through public interfaces, not implementation)
- Prior art — similar test patterns already in the codebase

---

## Technical Context

### Existing Patterns
Patterns in the codebase to follow (describe by name and purpose, not file paths):
- Pattern name — why relevant, how it applies

### System Dependencies
- External services/APIs
- Package requirements
- Infrastructure requirements

### Data Model Changes (if applicable)
- New entities/tables
- Schema migrations required
- Data backfill considerations

---

## Boundary Tiers

### Always (conventions to follow)
- Convention 1
- Convention 2

### Ask First (decisions needing human input)
- Decision area 1
- Decision area 2

### Never (must not be touched)
- Protected area 1 — why
- Protected area 2 — why

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Risk 1 | High/Med/Low | High/Med/Low | How to mitigate |

---

## Alternatives Considered

### Alternative 1: <Name>
- **Description:** Brief description
- **Pros:** What's good about it
- **Cons:** Why we didn't choose it
- **Decision:** Why rejected

---

## Non-Goals (v1)

Explicitly out of scope:
- Thing we're not building — why deferred
- Future enhancement — why deferred

---

## Interface Specifications (if applicable)

### CLI
```
command-name [args] [options]
```

### API
```
POST /api/endpoint
Request: { field: type }
Response: { field: type }
Errors: 4xx/5xx scenarios
```

---

## Success Metrics (if applicable)

How we'll know this worked:
- Metric 1: current → target (how measured)
- Metric 2: current → target (how measured)

---

## Open Questions

- Question 1
- Question 2
```

## Key Principles

### Problem Before Solution
Lead with the problem. Quantify the cost of inaction. Make the case for why this matters.

### Define End State, Not Process
Describe WHAT exists when done. Don't prescribe implementation order, priorities, or phases.

### No File Paths
File paths and code snippets go stale. Describe patterns by name and purpose. Reference modules by responsibility, not location.

### Boundaries Prevent Drift
Explicit boundary tiers (Always/Ask First/Never) and non-goals prevent agents from touching stable code or building unrequested features.

### Testing Strategy Is Architecture
Which modules are tested at which tier reveals the architecture. Deep modules get boundary tests; pure logic gets unit tests; composition gets integration tests.

## Bad vs Good Examples

### Bad (Prescriptive / Phases)
```markdown
## Phase 1: Database
1. Create users table
2. Add indexes

## Phase 2: API
1. Build registration endpoint
```

### Bad (Missing RFC Context)
```markdown
## Overview
We need user authentication.

## Acceptance Criteria
- [ ] Users can register
- [ ] Users can log in
```
Missing: Why? What problem? Risks? Alternatives? Testing strategy?

### Good (RFC-Ready)
```markdown
## Problem Statement
Users can't persist data across sessions. 47% drop off when asked to re-enter
information. ~$50k/month in lost conversions.

## Durable Architectural Decisions
- **Routes:** POST /api/auth/register, POST /api/auth/login
- **Schema:** users table with email (unique), password_hash, created_at
- **Auth:** JWT with 24h expiry, refresh token with 7d expiry

## Modules
- **AuthService:** Owns registration, login, token lifecycle. Callers pass
  credentials, receive tokens. Hides hashing, token signing, refresh logic.

## Testing Strategy
- AuthService: integration tests against real DB (prior art: tests/int/)
- Token validation: unit tests for expiry, malformed tokens, refresh flows

## Boundary Tiers
### Never
- Payment module — unrelated, must not be affected
- User profile schema — separate concern, future PRD
```

## After PRD Creation

Before sharing, verify:
- [ ] Problem statement is clear and compelling
- [ ] Scope boundaries are explicit (boundary tiers + non-goals)
- [ ] Testing strategy covers the identified modules
- [ ] No file paths or code snippets that will go stale
- [ ] Durable architectural decisions are separated from implementation detail

Tell the user: PRD saved to `prd-<name>.md`
