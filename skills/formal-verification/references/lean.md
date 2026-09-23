# Lean 4

Commands verified against Lean v4.34.0 on 2026-09-23 unless marked. For deep
proof craft, the official `leanprover/skills` (`lean-proof`, `lean-setup`)
and `cameronfreer/lean4-skills` go further than this file.

## Contents

- [Setup](#setup)
- [Proving loop](#proving-loop)
- [Acceptance gate](#acceptance-gate)
- [Statement pitfalls](#statement-pitfalls)

## Setup

```sh
# elan (toolchain manager); non-interactive, no shell-profile edits:
curl -sSf https://elan.lean-lang.org/elan-init.sh -o elan-init.sh
sh elan-init.sh -y --no-modify-path --default-toolchain none
lake new Proj            # or: lake new Proj math   (adds Mathlib)
cd Proj && lake build    # first build downloads the toolchain; use a long timeout
```

- `lean-toolchain` pins the exact Lean version; elan honours it.
- With Mathlib, run `lake exe cache get` before building, or Mathlib compiles
  from source for hours. The toolchain must match Mathlib's exactly, and
  Mathlib often tracks a release candidate. `lake update` also bumps
  `lean-toolchain` unless given `--keep-toolchain`.
- `ELAN_HOME` relocates the install, which keeps it out of the user's home
  when working in a scratch directory.
- lean-lsp-mcp (`uvx lean-lsp-mcp`) gives agents goal states, diagnostics,
  multi-tactic attempts and lemma search; run `lake build` before starting it.

## Proving loop

1. Get the statement approved and frozen (see SKILL.md). Sketch helper lemmas
   with `sorry`, build, and confirm the only warnings are the expected
   `sorry`s.
2. One goal at a time. `lake env lean File.lean` prints the goal (`⊢ ...`)
   at each failing tactic.
3. Cheap automation first: `omega` (linear arithmetic), `decide` (kernel
   evaluation), `simp`, `grind`, `aesop` (Mathlib).
4. Search, don't guess names: `exact?`, `apply?`, `rw?`, `simp?` print
   `Try this:`; paste the result in so the proof doesn't depend on search.
   Models trained on older snapshots emit renamed Mathlib lemmas and Lean 3
   syntax.
5. A heartbeat timeout is a smell: replace `simp` with the `simp only [...]`
   from `simp?`, or split the lemma, before raising `maxHeartbeats` (scope any
   raise with `set_option maxHeartbeats N in`).
6. Don't dodge a termination proof with `partial def`: the function becomes
   opaque and nothing about it is provable. Use `termination_by` and
   `decreasing_by`.

## Acceptance gate

`lake build` exits 0 with `sorry` in the tree; an `axiom` prints no warning;
`native_decide` prints none either. All three verified. So:

```sh
lake build --wfail          # exit 1 on any warning, including sorry; holds on cached rebuilds
```

```lean
#print axioms MyTheorem     -- must list only propext, Classical.choice, Quot.sound
```

Then grep the tree for `sorry`, `admit`, `axiom`, `native_decide`,
`implemented_by`, `extern`, `partial def` and `unsafe`, and diff each
theorem statement against the approved one. For high stakes, add
`lean4checker --fresh` and `comparator` (see [audit.md](audit.md)).

## Statement pitfalls

The kernel checks the proof, never the statement. A "sort" returning `[]`
is provably sorted with only standard axioms (verified); the spec needs
sorted *and* `List.Perm (sort l) l`. Other bugs that change meaning
silently:

- `P ∧ Q` where `P → Q` was meant; missing brackets around `∧`, `→`, `↔`.
- `Nat` subtraction truncates (`0 - 1 = 0`); `x / 0 = 0`; Mathlib junk values
  (`Real.sqrt` of a negative is 0).
- Contradictory hypotheses make any conclusion provable; lean-lsp-mcp's
  `lean_minimal_hypotheses` flags unused ones.
- A lemma closed with `sorry` is still citable downstream; use `proof_wanted`
  for claims that must not be used yet.
- A fuel parameter needs the spec to cover fuel running out.
- A statement that encodes an open problem (Collatz) cannot be proved; say
  so rather than grinding.
