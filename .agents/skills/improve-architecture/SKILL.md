---
name: improve-architecture
description: Explore a codebase for architectural friction, discover refactoring opportunities, and propose module-deepening refactors as GitHub issue RFCs. Uses friction-driven exploration and parallel sub-agents to design multiple interface alternatives. Use when user wants to improve architecture, find refactoring opportunities, consolidate coupled modules, reduce complexity, make code more testable, or review codebase health.
---

# Improve Architecture

Explore a codebase organically, surface architectural friction, and propose refactors via GitHub issue RFCs. Uses "Design It Twice" — multiple parallel interface designs compared in prose.

## Process

### 1. Friction-driven exploration

Use subagents to explore the codebase. Don't follow rigid heuristics — explore organically and note where you experience friction:

- Understanding one concept requires bouncing between many small files
- Modules so shallow the interface is nearly as complex as the implementation
- Pure functions extracted just for testability, but real bugs hide in how they're called
- Tightly-coupled modules creating integration risk in the seams between them
- Untested or hard-to-test areas
- Code that fights you when you try to change it

The friction you experience IS the signal. Be honest about what confused you or slowed you down — that's the most valuable information.

### 2. Present candidates

Show a numbered list of opportunities. For each:

- **Cluster:** which modules/concepts are involved
- **Why coupled:** shared types, call patterns, co-ownership of a concept
- **Dependency category:** see [references/dependency-categories.md](references/dependency-categories.md)
- **Test impact:** existing coverage, what boundary tests would replace

Don't propose solutions yet. Ask the user which candidate to explore.

### 3. Frame the problem space

For the chosen candidate, write up:

- Constraints any new interface must satisfy
- Dependencies it relies on
- A rough illustrative sketch to ground the constraints (not a proposal, just framing)

Show this to the user, then immediately proceed to step 4. The user reads while sub-agents work.

### 4. Design It Twice

Spawn 3+ sub-agents in parallel, each with a different design constraint and a separate technical brief (file paths, coupling details, dependency category, what's being hidden).

- **Agent 1:** Minimise the interface — 1-3 entry points max
- **Agent 2:** Maximise flexibility — support many use cases and extension
- **Agent 3:** Optimise for the most common caller — default case trivial
- **Agent 4 (if applicable):** Ports & adapters for cross-boundary dependencies

Each sub-agent outputs:
1. Interface signature (types, methods, params)
2. Usage example showing how callers use it
3. What complexity it hides internally
4. Dependency strategy (see [references/dependency-categories.md](references/dependency-categories.md))
5. Trade-offs

Present designs sequentially, then compare in prose. Give an opinionated recommendation — which design is strongest and why. If elements combine well, propose a hybrid.

### 5. Create GitHub issue RFC

After the user picks a design (or accepts the recommendation), create a GitHub issue using `gh issue create`. Don't ask to review first — create and share the URL.

Use the RFC template:

```markdown
## Problem

Describe the architectural friction:
- Which modules are shallow and tightly coupled
- What integration risk exists in the seams
- Why this makes the codebase harder to navigate and maintain

## Proposed Interface

The chosen interface design:
- Interface signature (types, methods, params)
- Usage example showing how callers use it
- What complexity it hides internally

## Dependency Strategy

Which category applies and how dependencies are handled:
- **In-process**: merged directly
- **Local-substitutable**: tested with [specific stand-in]
- **Ports & adapters**: port definition, production adapter, test adapter
- **Mock**: mock boundary for external services

## Testing Strategy

- **New boundary tests to write**: behaviours to verify at the interface
- **Old tests to delete**: shallow module tests made redundant
- **Test environment needs**: local stand-ins or adapters required

Replace, don't layer — old unit tests on shallow modules become waste once boundary tests exist. Delete them.

## Implementation Recommendations

Durable guidance NOT coupled to current file paths:
- What the module should own (responsibilities)
- What it should hide (implementation details)
- What it should expose (the interface contract)
- How callers should migrate to the new interface
```
