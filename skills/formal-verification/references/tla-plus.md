# TLA+

Facts checked 2026-09-23 against the TLC source and release notes; re-check
flags with `java -cp tla2tools.jar tlc2.TLC -help`.

## Contents

- [Setup](#setup)
- [Running TLC](#running-tlc)
- [Modelling rules](#modelling-rules)
- [Sanity-check a spec](#sanity-check-a-spec)
- [Liveness](#liveness)
- [Tying the spec to code](#tying-the-spec-to-code)
- [LLM failure modes](#llm-failure-modes)

## Setup

- Needs Java 11+. Without one, unpack a pinned JDK archive into the working
  directory rather than installing system-wide.
- `tla2tools.jar` from <https://github.com/tlaplus/tlaplus/releases>. `v1.8.0`
  is a *rolling* pre-release, rebuilt in place; the newest stable tag is
  older. Record which you used, and its checksum.
- VS Code extension `tlaplus.vscode-ide` replaces the unmaintained Toolbox and
  exposes SANY and TLC as language-model tools.

## Running TLC

```sh
java -cp tla2tools.jar tla2sany.SANY Spec.tla          # parse and level-check first
java -XX:+UseParallelGC -cp tla2tools.jar tlc2.TLC \
  -config Spec.cfg -workers auto -coverage 1 Spec.tla
```

- `-deadlock` **disables** deadlock checking (same as `CHECK_DEADLOCK FALSE`,
  and overrides the `.cfg`). Deadlock checking is on by default. A bounded
  clock (`now < MaxTime`) deadlocks at the bound; handle that in the spec
  (let `Tick` stutter or add a terminal `Done` step) rather than switching
  the check off.
- `-workers` defaults to 1. `-coverage 1` prints per-action coverage every
  minute and at the end; read it.
- SANY exits 0 on a *semantic* error (verified: `Unknown operator` still
  exits 0; a syntax error exits 255). Check its output for errors, not just
  the exit code.
- TLC exit codes: 0 pass, 11 deadlock, 12 invariant violated, 13 liveness
  violated, 150 spec parse error, 151 `.cfg` parse error. Branch on them, not
  on grepping output.
- `pcal.trans Spec.tla` translates PlusCal in place and **overwrites
  `Spec.cfg`** unless given `-nocfg`.
- `.cfg` keywords: `SPECIFICATION`, `INIT`/`NEXT`, `CONSTANTS`, `INVARIANT(S)`,
  `PROPERTY`/`PROPERTIES`, `CONSTRAINT`, `SYMMETRY`, `VIEW`, `CHECK_DEADLOCK`.
  Every `CONSTANT` in the spec needs a value; mismatches are a common LLM
  error.

## Modelling rules

- One action per real atomic step: a SQL statement, an RPC, a syscall, a
  lock acquire. Merging steps hides races; MongoDB's trace checking failed on
  a spec that made a two-step election atomic.
- A process may read only what it could actually observe. Reading another
  process's local state models a system that doesn't exist.
- Model the environment's failures explicitly: crashes, pauses, message loss,
  clock skew, replica loss. A spec without them checks the happy path.
- External side effects (a charge, an email) get their own variable, so the
  property is about what the outside world saw, not about table rows.
- Small constants first (2 processes, 1-2 values), grow until state counts
  stop surprising you. Record the final bounds and distinct-state count.

## Sanity-check a spec

1. SANY parses; TLC runs with deadlock checking on.
2. Coverage: every action produced distinct states. A zero means a guard is
   never enabled.
3. Canary invariants that must fail: `~(goal reached)`, e.g.
   `NotCharged == charges = 0`. Each needs a counterexample of plausible
   length. If one passes, the spec cannot reach the states you care about.
4. Mutation: break the algorithm (drop the fence, reorder two steps) and
   confirm the real invariant now fails.
5. `TypeOK` catches malformed state; it is not a correctness property.
6. Report bounded results as bounded: "no violation with 2 workers, 1 job,
   depth 13, 195 distinct states", never "proved". Unbounded safety needs an
   inductive invariant (Apalache: check `Init => Inv`, `Inv /\ Next => Inv'`,
   `Inv => Safety`) or TLAPS.

## Liveness

- Safety says nothing bad happens; a spec that does nothing satisfies it.
  Check at least one progress property (`<>`, `~>`) as a `PROPERTY`.
- Liveness needs fairness: `WF_vars(A)` / `SF_vars(A)` in the spec formula,
  or `fair process` / `-wf` / `-termination` in PlusCal. With no fairness,
  liveness fails on stuttering; with too much, it passes on behaviours the
  system can't guarantee. Write down why each fairness condition is
  physically true.
- Vacuous implications: for `P ~> Q`, check that `P` actually occurs, and
  negate `Q` to confirm TLC reports a lasso.
- `CONSTRAINT`, `SYMMETRY` and `VIEW` can make liveness checking unsound
  (Specifying Systems §14.3). Check liveness in a model without them.

## Tying the spec to code

A model checks a design. To claim anything about code:

- **Trace validation**: log observable events from the implementation and
  check each trace is a behaviour of the spec (Azure CCF in CI found 6 bugs;
  run TLC depth-first for traces).
- **Model-based test generation**: one test per spec behaviour (MongoDB got
  100% branch coverage).
- Otherwise report the result as design-only.

## LLM failure modes

Observed in benchmarks and practice (SysMoBench, Wayne 2026):

- Unicode operators (`∧ ∈`) instead of ASCII (`/\ \in`); missing `====`;
  markdown fences left in the file.
- `.cfg` out of sync with the spec's constants.
- Invariants that are tautologies or only restate `TypeOK`; liveness missing
  even when asked.
- Copying a textbook spec's shape (classic Paxos or Raft) instead of the
  system's actual steps.
- Proposing fixes that aren't physically realisable ("make check-and-charge
  atomic" when one side is an external API).
