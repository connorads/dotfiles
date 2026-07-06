---
name: testing
description: >
  Design and write effective tests for behavioural changes, bug fixes, and
  refactors. Use when choosing a test layer, practising TDD, picking
  doubles/fakes, designing scenario or e2e suites for critical journeys,
  reducing brittle or flaky tests, refactoring safely, or applying
  property-based, snapshot/approval, differential/metamorphic, or contract
  testing. For coverage, thresholds, mutation testing, fuzzing, and CI/hook
  enforcement, use the test-coverage skill.
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
|-- Invariant or illegal state to protect
|   |-- Can a type make it unrepresentable? -> change the type, skip the test
|   `-- Large input space? -> property-based tests alongside named examples
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

## Types Before Tests

The cheapest test is one you never write because the bug cannot compile. Before
testing an invariant, ask whether a type can make the bad state unrepresentable
— a constrained type with a smart constructor, a union per lifecycle state,
`NonEmptyList` for "at least one". If it can, change the type instead: that is a
compile-time check that deletes a whole class of guard tests.

- **Don't test what the type forbids.** Feeding illegal values to an internal
  function that cannot receive them tests the language, not your code. Validate
  once at a boundary parser / smart constructor, and trust the type inward — an
  always-valid model needs no defensive re-tests at every layer.
- **Relocate, don't delete.** Making a value a type moves the tests to the
  constructor — but test the rules *you* authored, not the engine. A hand-rolled
  smart constructor is logic you wrote: cover valid-accepted, invalid-rejected,
  and edges. A schema-library parser (zod, valibot, pydantic) is declarative
  config over a pre-tested engine: test only your custom refinements, transforms,
  and cross-field constraints — re-testing the library's primitives is testing
  the framework. Downstream code then needs no tests for inputs it can't hold.
- **The guarantee is only as strong as the boundary.** Where types are erased at
  runtime (TypeScript), "trust the type inward" holds only if the boundary did a
  real runtime parse — a schema library, not a cast (`as`) or `any`. A type is a
  compile-time claim the parser makes true at runtime. What no library covers:
  whether your schema matches what the producer actually sends — guard that drift
  with a contract test or a captured sample (see Contract Testing).
- **Define errors out of existence, too.** Redefining an operation so the edge
  case is normal — a total function over a tested special case — deletes its
  edge-case test with it. Design mechanic in `architecture` → Error Handling.

## Choosing the Layer

Choose the narrowest layer that proves the behaviour.

| Layer | Use for | Shape |
|---|---|---|
| Pure core | Business rules, parsing, validation, calculations | Unit tests with real values |
| Application/use case | Decisions across owned ports | Public API tests with fakes for owned ports |
| Adapter | Database, queue, filesystem, third-party integration code | Contract/integration tests against real infrastructure where practical |
| Scenario | Critical vertical journeys across routing, auth, UI/API, and owned state | Real app composition, real owned infrastructure where cheap, fake only externals |
| Composition | Wiring, CLI, HTTP handlers, UI journeys | A few integration/e2e checks for critical paths |

Do not use e2e tests to compensate for untested domain logic. Do not use unit
tests to assert wiring that only fails when components are composed.

### Test altitude: aim at the stable contract

The "unit" worth testing is a *behaviour through a stable public contract*, not a
layer or a class (Ian Cooper, "TDD, Where Did It All Go Wrong"). So don't pick a
layer — **aim each test at the deepest stable interface that keeps setup cheap and
failures localised**; the level you land on is a consequence, not a goal.

- **Depth, not height, buys refactor-resilience.** A deep module — a narrow
  interface over a rich, churning implementation — changes its interface rarely
  while its body churns, so a test pinned to that interface survives the refactor
  and still exercises everything behind it (`architecture` → Module Depth). A
  *shallow* interface is never a good target: make the module deep first, or test
  the pure core beneath it. Tests bound to internal structure (class shape,
  private methods) are glue that pins the design — the cost this rule avoids.
- **Push combinatorial coverage down to the pure core.** A pure function's
  signature is already a stable contract, so cover branchy logic (pricing, rules
  matrices, parsers) directly with table or property-based tests — don't enumerate
  its cases through a deep facade, which adds setup, blurs shrinking, and buries
  the failure.
- **Keep a low-gear inner loop while a contract is molten.** Testing close to the
  code is where you feel the friction that drives a better design. That coupling
  is temporary and the point; once the design settles, lift the bulk to the stable
  interface and delete the scaffolding a higher test now subsumes.

"Stable" is an end-state: while the contract churns, low gear is correct, not a
fallback. Exercise the stable interface heavily for representative behaviours and
integration — but it is only genuinely cheap once builders/fakes make the arrange
step cheap.

### Shell, zsh and POSIX sh testing

Choose shell test tooling by the language boundary being tested:

- **Bash-heavy CLI/code:** `bats-core` is a good default.
- **Cross-shell shell functions/libraries:** prefer `ShellSpec`.
- **POSIX sh portability:** run the same behaviour tests under multiple real shells
  (`dash`, `busybox sh`, `bash --posix`, etc.).
- **zsh-native functions/autoloads/completions:** test inside `zsh` with isolated
  shell state; Bats can black-box execute zsh commands but is not a zsh-native
  test language.

Prefer black-box CLI tests for scripts: arguments, exit status, stdout, stderr,
and filesystem effects. For shell functions, isolate `PATH`, `HOME`/`ZDOTDIR`,
temp dirs, fixtures, and shell options.

See `references/shell-testing.md` for tool comparison, zsh isolation patterns,
POSIX multi-shell loops, example harnesses, and keeping suites fast.

### Scenario (integration) tests

A useful named layer sits between application and composition: run the **real
application** end to end and fake **only the externals you don't own**
(third-party HTTP, email delivery, payment providers), switching the faked
external state per test.

- Cover named user/business journeys, not matrices: lifecycle transitions,
  permissions, locale, persistence, resumability, and other places where several
  boundaries must agree.
- Use app-owned setup and cleanup surfaces when they exist - admin APIs, public
  APIs, CLI commands - so the test validates the same contracts operators and
  users rely on. Direct storage setup is a fallback when the public setup seam is
  absent or prohibitively slow.
- Fake at the network boundary (e.g. MSW server-side), not by stubbing your own
  modules - routing, parsing, middleware, and wiring all run for real.
- Define named backend states ("payment succeeds", "auth times out") and select
  one per test instead of restarting the app or re-mocking by hand.
- Isolate both browser state and backend state: create unique records, clean them
  up in fixture teardown, restore any global flags, and tag parallel tests with
  an id (e.g. an injected header) so concurrent tests don't share mocked state.
- Prefer user-facing selectors and web-first assertions. Add stable accessible
  scopes to repeated UI regions (e.g. a named `role="group"`) instead of
  reaching for DOM structure.
- Keep slow scenario suites on an explicit command unless they are tiny and
  mission-critical for every commit. Run serially only for unavoidable global
  state, and say why.

Reach for it to prove a vertical slice works without standing up real
third-party services. It complements, and does not replace, a few true e2e
checks and exhaustive domain tests. See
`references/scenario-testing.md` when designing a scenario suite, choosing
setup/cleanup seams, or debugging scenario flakiness.

### Testing at multiple boundaries

"Narrowest layer" is the default, not an absolute. Deliberately re-test the same
**business rule** at more than one boundary (e.g. the domain function *and* the
HTTP API) when defense in depth earns the duplication:

- **Duplicate business rules, not plumbing.** Re-prove a rule at each public
  entry point; test plumbing (status codes, parsing, DOM details) only at the
  layer it lives in.
- **Why pay for it:** which layer's test fails tells you which boundary broke;
  two layers re-implementing a rule surface drift the moment one changes; the
  rule survives as suites erode.
- **The cost is real:** every rule change touches every layer that asserts it.

Stop duplicating and sample at the outer layer instead when: the inner layer
becomes a thin wrapper (ceremony outweighs the rule), the outer surface explodes
to many endpoints, suite runtime crosses a pain threshold (keep the domain
exhaustive, sample the API), or there is only ever one consumer behind a trivial
forwarder.

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

**The mirror-test trap:** a test that mocks the very collaborator whose
behaviour it claims to verify proves *wiring*, not behaviour — and stays green
when the real behaviour breaks. A handler test that stubs `validateBooking` to
return a rejection and then asserts the handler returns `400` never exercises
the real rule: delete the rule and the test still passes, because the test
supplied the rejection itself. Such tests also survive mutation of the mocked
unit. Assert against the real collaborator, or prove the rule at its own layer.

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
Keep generators valid by construction where possible. When an invariant is
*structural* (non-empty, bounded, exactly-one), prefer encoding it as a type
(e.g. `NonEmptyList`) over a "never empty" property — a compile-time guarantee
beats a sampled one and needs no generator. Keep named example tests
for edge cases and regression stories; use property tests to explore the input
space around them.

Failures shrink automatically to a minimal counterexample — persist that case
as a regression example so the specific failure is checked deterministically
forever. For stateful systems, generate a sequence of operations and check them
against a simple in-memory model (model-based testing).

See [property-based-testing.md](references/property-based-testing.md) for
per-ecosystem frameworks (fast-check, Hypothesis, proptest, rapid/gopter),
shrinking, stateful/model-based testing, CI integration, and pitfalls.

## Differential & Metamorphic Testing

Use these when there is **no reliable oracle** — you cannot state the correct
output, only relationships between outputs. They are the backbone of compiler,
parser, database, numeric, and ML testing.

- **Differential:** run the same input through two independent implementations
  (or old vs new version) and assert they agree. Cheap and powerful for safe
  refactors and for parsers/compilers — keep the reference implementation as the
  oracle.
- **Metamorphic:** assert a *relation* between related inputs when no single
  output is checkable — `sin(x) == sin(pi - x)`; permuting training data should
  not change a model's accuracy; add-then-remove restores state. Usually
  expressed as a property (see above), so reach for your PBT framework.

## Snapshot & Approval Tests

Snapshot tools (Jest/Vitest snapshots, insta for Rust, syrupy for Python,
ApprovalTests) record output and diff future runs against it. Useful for large,
semantically meaningful serialised output — but they fail *open* and degrade:

- **Snapshot rot / rubber-stamping:** when a snapshot breaks, the path of least
  resistance is update-and-merge, so the snapshot ends up asserting "what the
  code currently does", not what it *should*.
- **Over-broad snapshots** bury the one meaningful line among hundreds of
  irrelevant ones; every change churns the snapshot and nobody reads the diff.

Use them well: keep snapshots **small and targeted** (snapshot the one derived
value, not the whole DOM/object), review every update as real code, and prefer
explicit assertions whenever you can name the expectation. Treat a snapshot-only
test as roughly assertion-free for quality purposes. Avoid snapshots for
incidental structure.

## Assertion Quality

A test with no assertion only proves "it did not throw". Make each test's
assertions name the behaviour they protect. As a cheap guard, flag
assertion-free tests in lint/CI (e.g. ESLint `jest/expect-expect`, or AST/grep
checks for test functions lacking `assert`/`expect`/`require`). Assertion
*count* is a weak, gameable proxy — the rigorous measure of "do my assertions
actually catch bugs" is **mutation testing**, owned by the test-coverage skill.

## Contract Testing

Two senses, both about proving a boundary without a full end-to-end stack:

- **Adapter/port contract** (within one codebase): one test suite run against
  both the real adapter and any fake proves they satisfy the same port. Prefer
  this over mocks for owned ports (see Test Doubles).
- **Consumer-driven contract** (across independently deployed services, e.g.
  Pact): the consumer publishes the requests/responses it relies on; the
  provider verifies it still satisfies them. Sits *between* integration and e2e,
  catching cross-service breaks cheaply. Pitfalls: broker/tooling overhead and
  false confidence if contracts drift from real usage. For HTTP, schema/OpenAPI
  contract testing is lighter when one side owns the spec.

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

## Flaky Tests

A flaky test (passes and fails on the same code) erodes trust in the whole
suite. **Retry-to-green is an anti-pattern** — auto-rerunning until a pass hides
a real defect (usually a race, shared state, or order-dependency) and lets it
ship.

- **Detect:** re-run suspected tests to *surface* flakiness, not mask it
  (`pytest-rerunfailures`, `go test -count=N`, seed/order shuffling to expose
  order-dependence). CI test-analytics (Datadog, Buildkite, GitHub) track
  per-test pass/fail history over time.
- **Quarantine, then fix:** move a confirmed-flaky test out of the blocking gate
  into a tracked quarantine with an owner and a deadline — do not `skip` and
  forget, and do not leave it blocking the build. Root-cause it: timing, shared
  state, network, or nondeterministic ordering.
- **Bounded polling is not retry-to-green.** Polling a genuinely asynchronous
  result until it appears, with a timeout, is correct; re-running a whole test
  until it passes masks a race. The first waits for a known-pending outcome; the
  second hides nondeterminism.

Prevention is design: keep tests deterministic and order-independent, and remove
time/network coupling (see Core Rules).

## References

- [property-based-testing.md](references/property-based-testing.md) —
  Per-ecosystem PBT frameworks, shrinking, stateful/model-based testing, CI
  integration, and pitfalls.
- [scenario-testing.md](references/scenario-testing.md) - Critical-journey
  selection, setup/cleanup through public surfaces, external fakes, accessible
  selectors, runtime policy, and anti-patterns for scenario/e2e suites.
- [shell-testing.md](references/shell-testing.md) — Bats/ShellSpec/shUnit2/cram
  trade-offs, zsh isolation, POSIX multi-shell testing, shell fakes, and keeping
  suites fast (parallelism, fixture amortisation, removing time-coupling).
- For coverage reports, thresholds, exclusions, **mutation testing**, fuzzing,
  and CI/hook enforcement of test quality, use the **test-coverage** skill.
