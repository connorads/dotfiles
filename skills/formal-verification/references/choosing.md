# Choosing a method

Pick by the shape of the question, not by the tool you know. Evidence and
figures below were gathered 2026-09-23; re-check a source before quoting a
number as current.

## Contents

- [Tool map](#tool-map)
- [When it pays, and when it doesn't](#when-it-pays-and-when-it-doesnt)
- [AI changes the cost, not the hard part](#ai-changes-the-cost-not-the-hard-part)
- [Tools that look like verifiers](#tools-that-look-like-verifiers)

## Tool map

| Question | Default | Alternatives | Notes |
|---|---|---|---|
| Can this concurrent or distributed design reach a bad state? | TLA+ with TLC | Quint (TLA logic, TypeScript-like syntax, Apalache or TLC backend); P (communicating state machines, AWS); Apalache for large data domains | Checks the *design*. Ties to code only via trace validation or generated tests; see [tla-plus.md](tla-plus.md) |
| Does this data model or config have a bad instance? | Alloy 6 | TLA+ | Relational models with transitive closure suit Alloy's SAT backend |
| Can this small Rust/C unit panic, overflow or break an assertion for any input? | Kani (Rust), CBMC (C) | ESBMC | Harnesses look like tests; results hold only up to the unwinding bound |
| Is this implementation functionally correct? | Dafny (new code), Verus (Rust) | SPARK (Ada, firmware), F* (crypto), Creusot, Lean via Aeneas (Rust) | Code must be written in or annotated for the verifier; proofs need upkeep on change |
| Is this mathematical claim or system model correct? | Lean 4 | Rocq, Isabelle | Pair a Lean model with differential testing of the production code (Cedar pattern); see [lean.md](lean.md) |
| Most everyday code | Property-based tests, fuzzing, deterministic simulation | Fault injection | The `testing` skill; far cheaper and catches bugs a model abstracts away |

## When it pays, and when it doesn't

Pays:

- **Protocol designs.** AWS's 2014 TLA+ table found bugs in S3, DynamoDB
  (a 35-step trace) and EBS designs; S3 strong consistency was validated in P
  ([AWS 2014](https://lamport.azurewebsites.net/tla/formal-methods-amazon.pdf),
  [AWS 2025](https://queue.acm.org/doi/10.1145/3712057)). Azure CCF bound TLA+
  to C++ with trace validation in CI and fixed 6 consensus bugs before
  production ([NSDI'25](https://arxiv.org/abs/2406.17455)).
- **Small adversarial units.** Kani found 5 bugs in Firecracker's rate limiter
  where clock interaction defeated testing; on s2n-quic it found in 20 s a
  boundary bug 16.7M fuzz executions missed
  ([Kani](https://arxiv.org/abs/2607.01504)).
- **Verified model plus differential testing.** Cedar: Lean proofs found 4
  bugs, differential and property-based testing against the Lean model found
  21 more ([Cedar](https://arxiv.org/abs/2407.01688)).

Costs or misses:

- **Whole-system proofs are expensive.** seL4: about 20 lines of proof per
  line of code.
- **Spec and code drift.** MongoDB's trace checking stalled on a spec that
  made a two-step leader election atomic; its model-based test generation
  then succeeded ([MongoDB](https://www.mongodb.com/blog/post/engineering/conformance-checking-at-mongodb-testing-our-code-matches-our-tla-specs)).
- **The trusted base leaks.** Verified distributed systems had 16 bugs, in
  specs and unverified shims ([Fonseca 2017](https://www.cs.purdue.edu/homes/pfonseca/papers/eurosys2017-dsbugs.pdf));
  CompCert's bugs sat in its unverified front end.
- **Models don't answer performance questions.** Datadog paired TLA+ with
  simulation for latency and throughput
  ([Datadog](https://www.datadoghq.com/blog/engineering/formal-modeling-and-simulation/)).

## AI changes the cost, not the hard part

- Proofs are increasingly cheap: off-the-shelf models solved 82% of Dafny,
  44% of Verus and 27% of Lean tasks on the vericoding benchmark
  ([2509.22908](https://arxiv.org/abs/2509.22908)).
- Specs are not: best natural-language-to-TLA+ pass rate 8.6%
  ([2606.05792](https://arxiv.org/abs/2606.05792)); LLM-written TLA+ violated
  41.9% of liveness properties vs 8.3% of safety
  ([SysMoBench](https://arxiv.org/pdf/2509.23130)).
- Agents cheat when the checker is the goal: 7-14% of Verus runs used
  `assume`, `admit`, `external_body` or weakened specs until a cheat checker
  cut it below 1.5% ([VerySAGE](https://arxiv.org/html/2512.18436v2)).
- The durable split: a human owns the statement, the machine owns the proof
  (Kleppmann, [2025](https://martin.kleppmann.com/2025/12/08/ai-formal-verification.html)).

## Tools that look like verifiers

A language that type-checks proofs is only as strong as its checker, its
statement discipline and its escape hatches. Bend 2 (bend-lang.com) is a
dependent-type proof checker aimed at agents, launched September 2026, with a
large new trusted base; treat a pass as evidence, and use the gate in
[bend.md](bend.md). For verified production code at comparable effort, SPARK
or Dafny discharge more with SMT automation.
