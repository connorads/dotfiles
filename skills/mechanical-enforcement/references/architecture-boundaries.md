# Mechanical Enforcement — Architectural boundaries

The cross-stack story for principle 3 (*architectural boundaries are linter
rules*): making illegal module graphs uncompilable, transitive graph gates,
greppable invariants, functional-core purity, and cross-service contract gates.
Per-language boundary specifics live with their stack: Python in
`references/python.md`, Rust in `references/rust.md`. Routed from the picks
table and rules-catalogue index in `SKILL.md`.

- [Architectural boundaries](#architectural-boundaries)
- [Transitive architecture tests](#transitive-architecture-tests)
- [Go boundaries](#go-boundaries)
- [Greppable invariants (agent self-audit tier)](#greppable-invariants-agent-self-audit-tier)
- [Purity: keeping the functional core pure](#purity-keeping-the-functional-core-pure)
- [Boundary contracts (cross-service compatibility)](#boundary-contracts-cross-service-compatibility)

## Architectural boundaries

Use `no-restricted-imports` and `no-restricted-syntax` to make illegal graphs uncompilable. The catalogue of patterns:

- **Pure layer cannot import side-effectful layer.** `files: ["src/utilities/**"]` + `no-restricted-imports` banning `next/cache`, `next/headers`, `next/navigation`, ORM runtime modules. Use `allowTypeImports: true` for types you still want visible. Exempt one or two *intentionally* coupled files (`queries.ts`, `revalidate.ts`) via `ignores`.
- **UI cannot import schemas directly.** `files: ["src/components/**"]` + `no-restricted-imports patterns` banning `@/collections/*` (or whichever path holds your DB schemas). UI should depend on *generated types*, not schema source — otherwise a UI tweak forces a migration.
- **Raw SQL only in the query layer.** `no-restricted-syntax` on `TaggedTemplateExpression[tag.name='sql']` everywhere except `src/db/**`. Also ban raw driver imports (`ImportDeclaration[source.value='postgres']`) outside the same directory. **sqruff** (Rust) then lints / formats that quarantined SQL — see the picks table in `SKILL.md`.
- **Dynamic `import()` only via named wrappers.** `no-restricted-syntax` on `ImportExpression` outside `next/dynamic` / `React.lazy`. Prevents ad-hoc chunking that defeats SSR.

Full working snippets live in `references/eslint-boundaries.mjs`.

**oxlint (Rust) is the fast, Rust-first way to run these.** oxlint is production
(1.0 shipped 2025) with native `no-restricted-imports`,
`no-restricted-syntax`, `jsx-a11y`, and a multi-file `import/no-cycle` — so it
takes the boundary-rule role this skill kept ESLint around for, with no Node
dependency tree, and retires madge (see Import hygiene in `references/typescript.md`). Two adjacent pieces are
still pre-stable, so keep them advisory: type-aware rules via tsgolint/tsgo
(`oxlint --type-aware`, alpha — the only thing here that catches floating /
misused promises) and custom JS plugins (alpha). The import-type-aware boundary
rule (`allowTypeImports`) and framework-specific plugins (next, storybook) still
need typescript-eslint until oxlint's JS plugins stabilise.

When the bounded-context map is richer than per-rule `no-restricted-imports` can
express, declare it once instead: **eslint-plugin-boundaries** (assign element
types to paths, write rules over the types) or **@softarc/sheriff** (tag rules
plus barrel encapsulation; runs as an ESLint plugin or a standalone CLI).
dependency-cruiser stays the default for transitive gates (below).

## Transitive architecture tests

Use "architecture test" for an executable check over the module graph: "domain
must never reach runtime", "UI must never reach server-only content", "private
facts only enter through the gated boundary". These are not behavioural tests;
they are lint-style gates for structural drift.

`dependency-cruiser` is the default TypeScript tool for these transitive graph
rules — its `reachable` / `via` / `viaNot` rules are the transitive engine, and
they also cover its one direct-level gap (a re-export through a barrel file can
evade a plain `from`/`to` rule; the reachability rules see through it). Keep
direct import bans in oxlint/Biome/ESLint where possible because they are
faster and show up closer to the editor.

**fallow** (Rust) is a watch, not the boundary gate. It is fast (~20k files in
~1.5s) and covers cycles, dead code, and zone presets, but its boundary
analysis is direct-import-only and its barrel "parent fallback" rule
deliberately suppresses barrel violations — so imports laundered through a
barrel pass. It is TS/JS-only, open-core (paywall-creep risk on the zone
features), and its config DSL is still unstable (two majors in four months).
Use it as a complementary fast pass if at all; re-verify at its next major with
a barrel-laundering fixture before trusting it with boundaries.

Good dependency-cruiser rules are named like architecture invariants and have a
short comment explaining the failure mode:

- `domain-not-to-app-shells`
- `pure-access-not-to-runtime`
- `ui-not-to-server-modules`
- `private-content-through-approved-boundaries`
- `prod-not-to-tests`

Adoption pattern:

1. Start with `dependency-cruiser/configs/recommended-strict` so findings fail
   the gate instead of disappearing as warnings.
2. Add project-specific `forbidden` rules with names and comments.
3. Pass `options.tsConfig.fileName` so aliases resolve.
4. Enable `tsPreCompilationDeps` so type-only imports are visible to rules.
5. Split value-import and type-only-import rules when a boundary allows shared
   types but not runtime values.
6. Use `dependencyTypesNot: ["type-only"]` only where type visibility is
   intentionally allowed but runtime imports are not.
7. Exclude generated files and list legitimate entry points as orphan
   exceptions.
8. Run with `--no-cache` in hooks/CI unless config invalidation has been proven
   in that repo.
9. Measure wall time before choosing pre-commit. Whole-graph checks usually fit
   a full `quality`/CI hook better than staged pre-commit.

`no-orphans` is a useful sanity check, but it is not a dead-code strategy. Keep
knip for unused exports, unused files, and unused dependencies (see
`references/typescript.md`).

See `references/dependency-cruiser.cjs` for a copyable TypeScript config shape.

## Go boundaries

depguard inside golangci-lint covers direct layer gating: multiple named rules
scoped by `files:` globs (e.g. a `domain` rule denying `myapp/internal/infra`
and the DB driver). Reach for
[go-arch-lint](https://github.com/fe3dback/go-arch-lint) when a real component
architecture warrants a declarative map — `components` + `deps.mayDependOn` in
`.go-arch-lint.yml`, gated with `go-arch-lint check`. `gomodguard_v2` is the
module-level sibling: allow/block whole modules with recommended replacements.

## Greppable invariants (agent self-audit tier)

Some boundaries are awkward or impossible for `no-restricted-imports` to see:
cross-package leaks in a monorepo, raw-string patterns, "this directory must
stay framework-free". Encode these as **grep assertions that must return zero
matches** — a cheap pre-flight an agent runs before declaring work done, and
that wires into an hk step where it should gate.

```bash
# each line must find NOTHING; `! rg` turns a match into a non-zero (failing) exit
! rg -n "from ['\"]express['\"]" packages/core/src        # core stays framework-free
! rg -n "sql\`" packages/*/src --glob '!packages/db/**'   # raw SQL only in the query layer
```

This sits between lint and review. Prefer a real `no-restricted-imports` /
`no-restricted-syntax` rule when the linter *can* express the boundary — it runs
in-editor and is harder to bypass. Reach for grep for the cross-file,
cross-package, and string-level cases ESLint can't see, and as a portable check
an agent can run in any repo with no linter config. The "unique function names"
grep step in `references/typescript.md` is the same technique applied to one rule.

**ast-grep upgrades the durable ones from text to AST.** `rg` matches strings,
so it false-positives on comments and string literals and false-negatives across
reformatting. [ast-grep](https://ast-grep.github.io/) (`sg`, Rust, production)
matches tree-sitter AST patterns with `$VAR` metavariables and gates via
`sg scan` (non-zero exit, YAML rules), polyglot from one binary. Use `rg` for
quick / throwaway assertions and ast-grep for the boundary rules you want to
keep — it also subsumes `no-restricted-syntax` rules that don't need type
information. It is syntax-only, so type-aware boundaries (import resolution,
`allowTypeImports`) still belong in ESLint / oxlint.

## Purity: keeping the functional core pure

The `architecture` skill's functional-core rules — inject clock and randomness,
parse config at startup, no IO in the domain — are mechanically enforceable,
but the obvious rules don't work: `no-restricted-globals` and Biome's
`noRestrictedGlobals` ban **bare identifiers only**, so `Date.now()`,
`Math.random()`, and `process.env.X` (member expressions) sail straight
through. What works:

- **ESLint `no-restricted-properties`**, scoped to the pure layer
  (`files: ["src/domain/**"]`) — the rule that actually catches
  member-expression effects. No Biome equivalent; a genuine ESLint hold-out.
- **`no-restricted-imports` patterns** for IO modules (`node:fs`, `node:http`,
  infra directories) in the same scoped block, with `allowTypeImports` for port
  types.
- **ast-grep** for cross-language or call-shape precision — zero-arg
  `new Date()`, method chains — as YAML rules gated by `sg scan`.
- **Rust**: clippy `disallowed-methods` (`std::env::var`,
  `SystemTime::now`) and `disallowed-types` on infra types. Granularity is
  crate-wide, so give the pure core its own crate.

See `references/purity-boundaries.mjs` for the drop-in flat-config block plus
the equivalent ast-grep rule. The no-config escape hatch is grep
(`! rg -n "new Date\(|Date\.now\(|Math\.random\(" packages/core/src`) — the
portable greppable-invariants fallback for repos with no linter config; weaker
than the AST rules because it matches comments and strings too.

## Boundary contracts (cross-service compatibility)

Anything crossing a service boundary is a public contract (the
`event-driven-architecture` skill's framing) — and contract breakage is
mechanically checkable by diffing the schema against a baseline. publint/attw
(see `references/typescript.md`) cover the npm package shape; these cover the wire:

| Contract | Gate with | Notes |
|---|---|---|
| Protobuf | `buf breaking --against '.git#branch=main'` | Rule sets ladder from `FILE` (generated-code compat, default) to `WIRE` (wire-only). |
| OpenAPI 3.0/3.1 | `oasdiff breaking base.yaml revision.yaml --fail-on ERR` | The default over Azure openapi-diff. Core CLI + action are OSS; a hosted/Pro tier exists, so the Atlas-lint paywall precedent applies — watch. |
| GraphQL | `graphql-inspector diff` (non-zero on breaking) | Single schema. Federated graphs need Cosmo `wgc subgraph check` — composition breaks only show across the supergraph. |
| Rust public API | `cargo semver-checks` | Diffs rustdoc JSON against the released baseline; auto-run by release-plz; not exhaustive (proves the breaks it finds, not their absence). |
| TS public `.d.ts` surface | `@microsoft/api-extractor` with a committed `.api.md` report | CI runs *without* `--local` and fails when the surface changed unreviewed; dev regenerates with `--local` and commits the diff. |

For consumer-driven contracts, `pact-broker can-i-deploy` is the deploy gate
(the method itself lives in the `testing` / `event-driven-architecture`
skills). Avro/JSON-Schema have no standalone single-binary gate — a schema
registry's compatibility check is the production path.

All of these diff against a baseline (git ref, published schema, committed
report), so they belong in CI / pre-push, not pre-commit. Command patterns in
`references/contract-gates.md`.
