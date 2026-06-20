---
name: testing
description: >
  Design and write effective tests for behavioural changes, bug fixes, and
  refactors. Use when adding tests, choosing a test layer, practising TDD,
  reducing brittle tests, refactoring safely, deciding when to use fakes or
  property-based tests, or reviewing test strategy. For coverage reports,
  thresholds, and enforcement, use the test-coverage skill.
---

# Testing

Use tests as design feedback and regression protection. Prefer tests that prove
observable behaviour through public APIs over tests that mirror implementation
structure.

## Decision Tree

```text
What is the task?
|-- New behaviour or bug fix
|   |-- Can the behaviour be observed through a public API? -> write the test there
|   `-- Is the seam missing or awkward? -> simplify the design before adding doubles
|-- Refactor existing code
|   |-- Behaviour already covered? -> refactor behind the tests
|   `-- Behaviour not covered? -> characterise it first, then refactor
|-- Large input space or invariants
|   `-- Add property-based tests alongside named examples
|-- Flaky or brittle tests
|   `-- remove time/order/network coupling and implementation-detail assertions
`-- Coverage report, thresholds, or CI/hook enforcement
    `-- Use the test-coverage skill
```

## Core Rules

- Prefer TDD for behavioural changes: see the failure, make it pass, then
  refactor.
- Test observable behaviour through public APIs, not implementation details.
- Keep tests deterministic and order-independent.
- Make each test's why clear from its name, setup, and assertions.
- A failing test should point at the cause quickly; vague failures are test
  design problems.
- Prefer real values and simple pure tests before introducing doubles.

## Choosing the Layer

Choose the narrowest layer that proves the behaviour.

| Layer | Use for | Shape |
|---|---|---|
| Pure core | Business rules, parsing, validation, calculations | Unit tests with real values |
| Application/use case | Decisions across owned ports | Public API tests with fakes for owned ports |
| Adapter | Database, queue, filesystem, third-party integration code | Contract/integration tests against real infrastructure where practical |
| Composition | Wiring, CLI, HTTP handlers, UI journeys | A few integration/e2e checks for critical paths |

Do not use e2e tests to compensate for untested domain logic. Do not use unit
tests to assert wiring that only fails when components are composed.

## Test Doubles

Avoid mocks by default; they tend to couple tests to call order and internal
collaboration.

- Pure core should not need doubles.
- Use fakes for ports you own when real infrastructure would make tests slow or
  nondeterministic.
- Test adapters with real infrastructure where feasible, or with contract tests
  that prove the adapter fulfils the port.
- For expensive or hostile external systems, fake at an application-owned port
  and keep at least one smoke/integration check where practical.
- If a test needs many mocks, reconsider the boundary rather than adding more
  mocking.

## Property-Based Tests

Use property-based tests when examples under-sample the behaviour:

- parsers and serialisers
- normalisation and canonicalisation
- permissions matrices
- state machines
- ordering, sorting, deduplication
- arithmetic, date/time, ranges
- round trips and invariants

Write properties as invariants over generated inputs, not randomised examples.
Keep generators valid by construction where possible. Keep named example tests
for edge cases and regression stories; use property tests to explore the input
space around them.

## Refactoring Existing Code

Before refactoring, characterise current behaviour through public APIs. Commit
those tests separately while the old implementation still exists. Then refactor
behind the tests.

If behaviour is unclear, preserve it first and ask before changing it. Use
golden or approval tests only when output is large and semantically meaningful.
Avoid snapshots for incidental structure.

## Fixing Bugs

Prove the bug is detectable before fixing it. Add or adjust a failing test,
enable the strict check, or reproduce the failing command. The red step does not
need a commit, but it should be real enough to prove the fix.

After the fix, run the narrowest relevant check first, then the broader checks
needed for confidence.
