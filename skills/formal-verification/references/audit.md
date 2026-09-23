# Audit: escape hatches and the trusted base

Each hatch below lets a check pass without proving the statement. Grep the
diff for them, run the tool's audit, and report every survivor as an
assumption. Tool behaviour verified 2026-09-23 where marked (✓); re-verify
after a toolchain upgrade.

## Escape hatches by tool

| Tool | Hatch | Effect | Detect |
|---|---|---|---|
| Lean 4 | `sorry`, `admit` | Unproved; `lake build` still exits 0 (✓ v4.34.0) | `lake build --wfail`; `#print axioms` shows `sorryAx` |
| Lean 4 | `axiom` declaration | Any statement, no warning at all (✓) | `#print axioms` lists it |
| Lean 4 | `native_decide`, `implemented_by`, `extern` | Trusts the compiler or a replacement; proofs of `False` have been found this way | `#print axioms` shows a `_native` axiom |
| Lean 4 | `partial def` | Function becomes opaque; nothing about it is provable (✓) | Grep; use `termination_by` instead |
| Dafny | `assume`, `assume {:axiom}`, `{:verify false}`, `{:extern}`, bodiless lemmas | Unproved facts or skipped members | `dafny audit` |
| Verus | `assume`, `admit`, `#[verifier::external_body]`, `#[verifier::external]` | Unproved facts or trusted bodies | Grep; allow-list pre-existing ones |
| Kani / CBMC | Over-constraining `kani::assume`, small unwind bounds, stubs | Assertions become unreachable; vacuous pass | `kani::cover!` on the interesting paths; unwinding assertions stay on |
| TLA+ | `-deadlock`, `CHECK_DEADLOCK FALSE`, `CONSTRAINT`, `SYMMETRY`/`VIEW` with liveness, missing fairness | Checks skipped or liveness results unsound | Read the command line and `.cfg`; canaries; see [tla-plus.md](tla-plus.md) |
| Bend 2 | `@unsafe def`, foreign `import "..."`, laws proven outside `LAWS.bend` | Proves anything; in an imported file, passes with no warning (✓ 2.0.25) | Grep; see [bend.md](bend.md) |
| Any | `ensures true`, weakened `requires`, strengthened hypotheses, edited statement | Proves a different, weaker claim | Diff the statement against the approved version |
| Any | Contradictory hypotheses | Every conclusion follows | Check hypotheses are satisfiable (instantiate them with a concrete example) |

## The trusted base

"Verified" always means "verified, assuming": the checker's kernel, the
logic's axioms, the SMT solver, the compiler and any unverified shim, FFI or
I/O layer. Bugs in verified systems cluster there (CompCert's front end, the
shims of IronFleet and Verdi). Report which of these the result leans on.
The stronger options, when stakes justify them:

- Lean: `lean4checker --fresh` replays the build through the kernel;
  `comparator` checks a proof against a human-written challenge statement in
  a sandbox with independent kernels
  ([Validating Proofs](https://lean-lang.org/doc/reference/latest/ValidatingProofs/)).
- Model checkers: trace validation or model-based test generation ties the
  spec to the running code; without it, say *design only*.
- Any verified model of production code: differential testing between model
  and code.
