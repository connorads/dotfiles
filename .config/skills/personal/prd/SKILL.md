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

If the request names a solution but no outcome for a product-facing feature, consider running the product-discovery skill first — it decides whether/which feature to build; this skill specs the committed one.

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

Generate markdown PRD to `prd-<feature-name>.md` in project root. Fill the template at `assets/prd-template.md`, including only the sections relevant to the feature.

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

Tell the user: PRD saved to `prd-<feature-name>.md`
