# Ponytail review — over-engineering only

Review for unnecessary complexity. One line per finding: location, what to cut,
what replaces it. The best outcome is the code getting shorter.

Default scope is the current diff; the whole-repo variant is at the end.

## Format

`L<line>: <tag> <what>. <replacement>.`, or `<file>:L<line>: ...` for
multi-file diffs.

Tags:

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Examples

❌ "This EmailValidator class might be more complex than necessary, have you
considered whether all these validation rules are needed at this stage?"

✅ `L12-38: stdlib: 27-line validator class. "@" in email, 1 line, real validation is the confirmation mail.`

✅ `L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`

✅ `repo.py:L88: yagni: AbstractRepository with one implementation. Inline it until a second one exists.`

✅ `L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.`

✅ `L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.`

## Scoring

End with the only metric that matters: `net: -<N> lines possible.`

If there is nothing to cut, say `Lean already. Ship.` and stop.

## Whole-repo variant (audit)

Same hunt, the whole tree instead of a diff. Triggers: "audit for
over-engineering", "find bloat", "what can I delete from this repo",
`/ponytail-audit`.

Same tags as above. Scan for: deps the stdlib or platform already ships,
single-implementation interfaces, factories with one product, wrappers that
only delegate, files exporting one thing, dead flags and config, hand-rolled
stdlib.

Rank findings biggest cut first, one line each:
`<tag> <what to cut>. <replacement>. [path]`. End with
`net: -<N> lines, -<M> deps possible.` Nothing to cut: `Lean already. Ship.`

## Boundaries

Scope: over-engineering and complexity only. Correctness bugs, security holes,
and performance are explicitly out of scope. Route them to a normal review
pass, not this one. A single smoke test or `assert`-based self-check is the
ponytail minimum, not bloat, never flag it for deletion. Lists findings; does
not apply the fixes.
