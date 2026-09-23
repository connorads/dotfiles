# Bend 2

Bend 2 (<https://bend-lang.com>, repo `bendlang/bend`) is a pure, affine,
dependently typed language with Python-like syntax that compiles to C (CPU
and GPU) or JS. Humans state laws in `LAWS.bend`; an agent writes code and
`PROOF.bend`; `bend PROOF.bend` is the gate. It is not Bend 1, the HVM-based
GPU language. Behaviour below verified against 2.0.25 on 2026-09-23, a week
after launch with releases landing daily; re-check `bend guide` and the
open soundness issues before relying on it.

## Working with it

- `bend guide` prints the language guide; `bend base` the standard library.
  There is no `--version`; use `bend version`.
- Proofs are ordinary definitions: no tactics, no automation. `match` is case
  analysis, a recursive call is the induction hypothesis, `%e : Goal` rewrites
  with an explicit motive, `{==}` is reflexivity.
- `?name` prints the goal and context at that point, which is the fastest
  loop for an agent. Failures print `expected` / `observed` terms and exit 1.
- Termination is mandatory (structural, left to right); a law with no proof
  or a `?TODO` fails with exit 1.
- The standard library has very few lemmas, so proofs run long; expect to
  prove helper lemmas yourself.

## Gate: a green run is evidence, not proof

`@unsafe def` proves anything by non-termination. It prints a warning but
exits 0 (issue #966), and when the `@unsafe` proof sits in a helper file that
`PROOF.bend` imports, the output is a clean `All terms check.` with no
warning (issue #1001, reproduced). Contradiction bugs (#994) and ways for
other files or a project `bunfig.toml` to alter the verdict (#1002, #1018)
were open as of 2026-09-23. Before reporting a law as proved:

1. `LAWS.bend` is human-owned and unchanged from the approved version.
2. Grep the whole tree, not just `PROOF.bend`, for `@unsafe`, foreign
   `import "..."`, `law` declarations outside `LAWS.bend`, and
   `bunfig.toml`.
3. Pin the `bend` version and require the output to be exactly
   `All terms check.` with exit 0.
4. List the trusted base in the report: the TypeScript checker, the novel
   `Type : Type` theory, Base's primitive laws, the unverified C/JS code
   generator, and any foreign code the proof stops at.

When the goal is verified production code rather than experimenting with
Bend, compare against Dafny or SPARK, whose SMT automation discharges much of
what Bend makes you write by hand; see [choosing.md](choosing.md).
