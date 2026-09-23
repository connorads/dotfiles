---
name: formal-verification
description: >-
  Guides using formal methods and judging what a verification result actually
  establishes: model checking designs (TLA+, PlusCal, Quint, P, Alloy) and
  proving code or theorems (Lean 4, Dafny, Verus, Kani, SPARK, Bend 2). Use
  when writing or running a TLA+ spec or TLC model, proving something in Lean,
  adding Dafny or Verus contracts or Kani harnesses, reviewing an AI-written
  proof or spec, when someone says formally verify, prove correct, model
  check, invariant, liveness, sorry or axiom, or when deciding whether formal
  verification is worth it for a concurrency, distributed-systems, protocol or
  security bug. Not for weighing empirical evidence (prove-it) or ordinary
  test design, including property-based and simulation testing (testing).
---

# Formal Verification

> **What exactly does this pass mean - which statement, under which bounds
> and assumptions - and have I watched it fail when it should?**

A checker certifies that a proof proves a statement, or that no reachable
state in a model breaks a property. It never certifies that the statement is
the one you meant, that the model matches the system, or that the check ran
at all. Agents find proofs cheaply; the risk lies in vacuous passes, weak
statements and quiet escape hatches. Every rule below guards one of those.

## Pick the lightest method that answers the question

Default to property-based tests, fuzzing, fault injection or deterministic
simulation - the `testing` skill owns those. Reach for formal methods when
the input or interleaving space is too large to sample and a missed case is
expensive:

- concurrent or distributed protocol designs: model check (TLA+ by default)
- small, adversarial units with huge input spaces: bounded model check (Kani
  for Rust, CBMC for C)
- code whose correctness is the product (parsers, crypto, authorisation,
  allocators): auto-active verifier (Dafny, Verus, SPARK)
- a mathematical claim, or a verified model of a system: Lean 4

When the bug is already in production, fault injection that reproduces it
usually beats a model; model the design when choosing a fix, since a fix that
works in one trace can still fail in another. Tool map, costs and the case
evidence: [references/choosing.md](references/choosing.md). Tool knowledge
here goes stale fast (Bend 2 is not the GPU language Bend 1 was); check the
live docs before describing a tool from memory.

## The statement is the product

- **Write the property in plain words first, then formalise it.** A human
  signs off on the statement - invariant, theorem, contract - before any
  proving. The agent proposes properties; it does not decide what "correct"
  means.
- **Freeze the approved statement.** While proving, the agent may add proof
  hints, lemmas and loop invariants, never edit the statement, weaken a
  `requires`, or strengthen a hypothesis. A statement change goes back for
  sign-off, with the diff.
- **A trivial implementation must fail the spec.** Ask what the laziest
  wrong implementation would satisfy: a sort returning `[]` is "sorted"; a
  queue that never charges satisfies `charges <= 1`. Try to satisfy the spec
  with it; if you can, the spec is too weak (sorted *and* a permutation).
- **The model must not assume its own answer.** An abstraction that makes the
  fix correct by construction (a payment provider modelled as a perfect
  deduplicator) proves nothing about the fix. Name every such assumption in
  the report as an assumption.
- **Atomicity matches the real system.** One action per real atomic step
  (one SQL statement, one RPC, one syscall). An action that bundles a read
  and a write hides the race you are looking for.

## A pass means nothing until you have seen it fail

- **Seed a bug and watch it get caught.** Break the algorithm (drop the lock,
  swap two steps, remove the fix) and confirm the property now fails with a
  plausible counterexample. A property that survives its own bug is vacuous.
- **Prove the interesting states are reachable.** Canary properties that
  should fail (`~(all jobs done)`, `kani::cover!`), plus coverage showing
  every action fired. `charges <= 1` holds trivially in a model where no
  charge can happen.
- **Never switch a check off silently.** TLC's `-deadlock` flag *disables*
  deadlock checking; `{:verify false}`, `--no-verify` and loose unwinding
  bounds do the same elsewhere. If one is genuinely needed, say which and
  why, and add the property it was standing in for (termination, progress).
- **Safety is half the story.** Check at least one liveness property ("every
  claimed job eventually completes") with fairness stated explicitly, and
  confirm a liveness property that should fail does fail. LLM-written specs
  miss liveness far more often than safety.

## Audit before you claim

Build tools report success on unfinished proofs: `lake build` exits 0 with
`sorry`, a Lean `axiom` prints no warning, Bend's `@unsafe` in an imported
file passes cleanly. Agents measurably use these hatches to finish a proof.
Before calling anything verified, run the tool's audit and grep for its
escape hatches - the per-tool table is
[references/audit.md](references/audit.md). Any hatch that stays is reported
as an assumption, never hidden.

## Report what was checked, not "verified"

Every result states:

1. **Claim** - the property in plain words, and the checked artefact
   (file, theorem or property name).
2. **Strength** - *proved* (unbounded), *model-checked up to* the stated
   bounds (processes, values, depth, distinct states), or *draft, not
   checked*. Code that has not been through the checker in this session is a
   draft, however confident.
3. **Assumptions and trusted base** - fairness, environment abstractions,
   remaining escape hatches, and what the tool trusts (compiler, FFI, SMT
   solver, the checker itself).
4. **Link to code** - whether the model is tied to the implementation
   (trace validation, generated tests, differential testing against a
   verified model), or explicitly *the design only*.
5. **Seen failing** - the seeded bug or canary that proved the check can
   fail.

## Toolchains

Install into the project or a scratch directory, not system-wide; pin an
exact stable release (not a rolling pre-release or `latest`) and verify
checksums where the project publishes them. Record the versions in the
report, since checker bugs are fixed release by release.

## References

| When the task involves… | Read |
|---|---|
| Choosing a method or tool; cost and industry evidence; whether it is worth it | [references/choosing.md](references/choosing.md) |
| Any tool's escape hatches, audit commands, trusted base | [references/audit.md](references/audit.md) |
| Writing, running or reviewing TLA+ / PlusCal / Quint; TLC flags, `.cfg`, liveness, trace validation | [references/tla-plus.md](references/tla-plus.md) |
| Lean 4 setup, proving loop, acceptance gate, spec pitfalls | [references/lean.md](references/lean.md) |
| Bend 2 laws and proofs | [references/bend.md](references/bend.md) |

`evals/` holds this skill's test prompts and assertions.
