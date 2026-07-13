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

```text
command-name [args] [options]
```

### API

```text
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
