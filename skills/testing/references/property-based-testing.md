# Property-Based Testing: Tests That Generate Their Own Inputs

Example-based tests check the cases *you* thought of. Property-based testing (PBT) states an **invariant** that must hold *for all* inputs, then generates hundreds of cases to try to break it — and when it finds a failure, **shrinks** it to a minimal reproducer. It is the highest-leverage way to raise the *quality* of a test without writing more example cases, and it tends to drive up branch coverage as a side effect.

All the mainstream tools descend from QuickCheck and share the same shape: generators → property → automatic shrinking.

## When PBT beats example-based tests

Reach for a property when you can name a relationship that holds for *every* valid input:

| Property pattern | Example |
|------------------|---------|
| **Round-trip / inverse** | `decode(encode(x)) == x`; `parse(format(x)) == x` |
| **Idempotence** | `normalise(normalise(x)) == normalise(x)` |
| **Invariant preserved** | sorting preserves length & multiset; a balanced tree stays balanced |
| **Oracle / model** | result matches a slow-but-obviously-correct reference implementation |
| **Metamorphic relation** | `sin(x) == sin(x + 2π)`; adding an item then removing it restores state (use when there is *no* reliable oracle — see SKILL.md) |
| **Never crashes** | for all inputs, the function returns or errors cleanly, never panics |

If you can't state a property, stick with examples — a vacuous or tautological property is worse than a good example test.

## Shrinking

On failure, every mainstream framework automatically reduces the counterexample toward the smallest input that still fails, so you debug `[0]` instead of `[83, -4, 902, …]`. ⚠️ Shrinking finds a **local** minimum, not a guaranteed global one — the reported case is small, not provably smallest.

## Stateful / model-based testing

For stateful systems (caches, state machines, data structures, APIs), generate a **sequence of operations**, run them against a simple in-memory **model**, and assert the real system agrees with the model after each step. Shrinking then minimises the failing *operation sequence*. Supported by gopter's `commands`, rapid's state-machine support, and Rust's [`proptest-stateful`](https://github.com/readysettech/proptest-stateful).

## Per-ecosystem tooling

| Ecosystem | Framework | Notes |
|-----------|-----------|-------|
| **TypeScript / JS** | [fast-check](https://github.com/dubzzz/fast-check) | Integrates with Vitest/Jest; reports `Shrunk N time(s)`; rich arbitraries; async support |
| **Python** | [Hypothesis](https://hypothesis.readthedocs.io/) | `@given`, strategies, `@example` for regressions; persists failing examples in `.hypothesis/` |
| **Rust** | [proptest](https://github.com/proptest-rs/proptest) (Hypothesis-inspired) / quickcheck | `proptest!` macro; saves regressions to `proptest-regressions/` |
| **Go** | [rapid](https://github.com/flyingmutant/rapid) (modern, fully automatic shrinking, generics) / [gopter](https://github.com/leanovate/gopter) (older, pre-generics, `interface{}`) / stdlib `testing/quick` (minimal) | Prefer rapid for new code; note rapid self-describes as alpha |

PBT generators count toward normal coverage because the properties run as ordinary unit tests — co-locate them with the tier's other unit tests (`*.unit.spec.ts`, `_test.go`, etc.).

## Integrating with coverage workflows & CI

PBT runs *inside* the unit tier, so it composes with the test-coverage skill's tiering, thresholds, and hk/CI wiring — see that skill for the enforcement mechanics.

- **Bound examples for speed in the fast path.** Use a low run count in pre-commit (e.g. fast-check `numRuns: 50`, Hypothesis profiles) and a higher count in CI. PBT runs as part of the unit tier — no separate job needed.
- **Persist failing seeds as regression tests.** Every framework can pin a discovered counterexample (`@example`, `proptest-regressions/`, fast-check seed/`examples`). Commit it so the specific failure is checked deterministically forever, even if generation is random.
- **Make randomness reproducible in CI.** Log/seed the PRNG so a CI failure can be replayed locally. Avoid generators that depend on wall-clock time or external state, or the test becomes flaky (see flaky-test note in SKILL.md).

```typescript
import fc from 'fast-check'
import { test } from 'vitest'

test('decode∘encode is identity', () => {
  fc.assert(
    fc.property(fc.string(), (s) => decode(encode(s)) === s),
    { numRuns: process.env.CI ? 1000 : 50 },
  )
})
```

## Pitfalls

| Pitfall | Mitigation |
|---------|------------|
| Vacuous/tautological property | Assert a *relationship*, not that the code did what it did |
| Flaky from time/randomness in generators | Keep generators pure; seed the PRNG; persist failing seeds |
| Slow suites from huge `numRuns` | Low count locally, high in CI; profile-based config |
| Bad generators miss the interesting space | Constrain/bias generators toward edge cases; combine with example tests |
| "It passed" read as a proof | PBT samples the space — it raises confidence, it does not verify exhaustively |
