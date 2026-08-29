# No runtime dependencies

`annotate` ships zero runtime dependencies, matching `pin-audit` and `skl`.
Typed errors, parse-don't-validate and injected ports are hand-rolled:
`Result<T, E>` lifted from `~/src/skl/src/core/result.ts`, and boundary parsers
written as smart constructors in `core/excerpt.ts`, `core/events.ts` and
`core/transcript.ts`.

## Context

The shape of this codebase - errors as values, parsers at the boundary, ports
implemented in `src/shell/` - is exactly what Effect gives you off the shelf, so
it deserved measuring rather than dismissing. Effect v4 was the candidate,
because its `Schema` is the part that would have earned its place.

Zero runtime deps is also a load-bearing property of the sibling projects, not
just an aesthetic: `.config/zsh/tests/pin-audit.bats` symlinks `~/src/pin-audit`
into an isolated `$TEST_HOME` and notes "zero runtime deps, so the sources are
enough". `annotate.bats` does the same thing for the same reason.

## Decision

Hand-roll it: ~120 lines with tests.

## Alternatives considered

- **Effect v4.** Rejected on three independent counts, measured rather than
  assumed.

  *Version.* It has never shipped stable - `latest` is 3.22.1, v4 is RC with a
  "Q3/Q4 2026" target. `"effect": "4"` resolves to nothing, because plain semver
  ranges do not match prereleases, so it needs an exact `4.0.0-rc.112` pin
  against a ~2.6-day release cadence. The global 4-day quarantine keeps that pin
  permanently behind, `pin-audit`'s drift check would FLAG it forever, and
  breaking changes are landing inside the RCs.

  *Cold start.* 9 ms to 37 ms via the `effect/Schema` subpath, 52 ms via the
  barrel. `bun src/cli.ts` has no bundler, so ESM evaluates all 90 modules of the
  Schema graph on every invocation. That tax is paid by the one command pressed
  dozens of times per review, and by the status pill on every repaint.

  *Footprint.* Schema cannot be taken alone - `Schema.ts` statically imports
  `Effect.ts` - and v4 adds `msgpackr`, which pulls a native `.node` binary and
  47.5 MB against a global `ignore-scripts` posture.

- **Effect v3**, the stable line. Rejected: it avoids the version problem but not
  the other two, and adopting the stable major of a library whose next major is
  in RC means the migration is already scheduled.

- **A small schema library** (zod, valibot) for the parsers alone. Rejected as
  not worth a dependency here: there are three parse sites, all of them JSON
  records this project itself writes, and each needs *tolerant* parsing - skip
  the bad line, count it, keep going - rather than the reject-on-mismatch a
  schema library is built around. `summariseHistory` in `~/src/skl` already
  demonstrates the shape.

- **Sharing `result.ts` with `skl`** rather than copying it. Rejected: there is
  no build step and no package linking between the `src/` projects, so sharing
  would mean inventing one for ten lines of type definition.
