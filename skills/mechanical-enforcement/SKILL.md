---
name: mechanical-enforcement
description: Catalogue of preferred linter rules, TypeScript flags, clippy thresholds, import-boundary checks, contract-compat gates, and architecture tests for making bug classes and design drift mechanically impossible. Use when setting up linting in a new project, hardening an existing project, responding to a class of bug by encoding a rule, or deciding which linter to reach for on a given stack. Pairs with the `hk` skill which handles wiring hooks.
---

# Mechanical Enforcement

Rules a reviewer would otherwise have to remember belong in a linter. This skill is the curated catalogue of rules, the linters that enforce them, and the rationale for each — so a new project can be hardened without re-deriving the set.

This is a **content skill**, not a tool. It provides rules and snippets. For wiring those rules into git hooks, see the `hk` skill.

## Principles

1. **Mechanical over social**. If a rule relies on a reviewer remembering it, it will drift. Encode it in a linter, a type, or a test — never in a convention.
2. **Types first, lint second, tests third**. Prefer `strict` TypeScript / Pydantic / clippy to a custom lint rule. Reach for a lint rule when the type system can't express it. Reach for a test only when neither can.
3. **Architectural boundaries are linter rules**. Layers (domain <- infra, utilities <- server, UI <- schemas) are enforced with `no-restricted-imports` / `no-restricted-syntax`, or with graph checks when the rule is transitive, not trusted to vigilance.
4. **Auto-fix where possible, gate where not**. Formatters and whitespace fixers run with `fix = true` and re-stage. Correctness rules gate the commit.
5. **Prefer opinionated presets, override minimally**. Ultracite for the TS lint/format toolchain (oxlint/oxfmt or Biome), `@commitlint/config-conventional` for commits, `next/core-web-vitals` for Next. Only override with a comment explaining *why*.
6. **The *why* lives with the rule**. Every non-obvious override has an inline comment saying what would break if it were removed.

## When to use this skill

- Setting up linting in a new project → pick linters from the table below, copy snippets from `references/`, wire with the `hk` skill.
- Hardening an existing project → audit against the rules catalogue, add the missing ones.
- A bug just happened → ask "what rule would have caught this mechanically?" and add it here.
- Choosing a linter for an unfamiliar stack → see the picks table.

## Linter picks by stack

Use the tool in the **Primary** column first; reach for the **Also** column only when the primary can't express the rule.

| Stack | Formatter | Primary linter | Also | Type-check | Notes |
|---|---|---|---|---|---|
| TypeScript / React / Next | oxfmt or Biome, via [Ultracite](https://www.ultracite.ai/) (`--linter oxlint` / `biome`) — see TypeScript: formatting | Biome | oxlint (Rust) for native `no-restricted-imports` / `no-restricted-syntax` / `jsx-a11y` / `import/no-cycle`; dependency-cruiser for transitive graph boundaries; ESLint flat config only for import-type boundaries + framework plugins (next, storybook); knip for dead-code / unused-deps | `tsc --noEmit` strict (+ `tsgo` fast local check - see typecheck below) | Ultracite is the default for new projects; the all-oxc stack (oxlint + oxfmt) is the recommended provider, Biome the stable fallback. Raw Biome only if Ultracite doesn't support the framework. |
| TypeScript (library / node) | oxfmt or Biome | Biome | oxlint (Rust) for direct boundary rules; dependency-cruiser for transitive graph boundaries; knip for dead-code / unused-deps | `tsc --noEmit` strict | Skip ESLint - oxlint covers most boundary rules in Rust; reach for ESLint only for import-type boundaries or framework plugins. Add publint + attw as a post-build publish gate. |
| Python | ruff format | ruff | import-linter for layer / forbidden / independence contracts (tach is a watch — see Python boundaries); vulture for whole-project dead-code audits | basedpyright recommended (primary); pyrefly (Rust) fast secondary; ty still beta | `ruff` replaces black + isort + flake8 + pylint. See Python sections below. |
| Rust | rustfmt | clippy (`-D warnings`) | cargo-deny; cargo-machete (unused deps) | `cargo check` | `clippy::pedantic` selectively; full pedantic is too noisy. See Rust sections below for thresholds and common allows. |
| Go | gofmt / gofumpt | golangci-lint | go-arch-lint for declarative component `mayDependOn` maps; `gomodguard_v2` for module allow/block lists (v1 is deprecated in golangci-lint) | `go vet` | Enable `errcheck`, `govet`, `staticcheck`, `revive`. depguard with per-`files:` rules gates layers — see Go boundaries. |
| SQL | sqruff (`sqruff fix`) | sqruff (`sqruff lint --dialect <x>`) | sqlfluff (Python) for dbt/Jinja | — | Rust "Ruff for SQL". Lints the SQL the query-layer boundary quarantines. Beta — start advisory, verify dialect coverage before blocking. |
| Shell / POSIX `sh` | shfmt `-ln=posix` | ShellCheck `--shell=sh` | checkbashisms, multi-shell runtime tests | — | Use for portable `.sh`; run behaviour tests under real target shells. |
| Bash | shfmt `-ln=bash` | ShellCheck `--shell=bash` | bats-core for black-box CLI tests | — | Bats is Bash-based; good for CLI contracts and Bash scripts. |
| zsh | shfmt `-ln=zsh` | — | `zsh -n`, isolated zsh runtime tests | — | ShellCheck does not support zsh; use parser/format checks plus native tests. |
| Markdown | rumdl | rumdl | — | — | Handles frontmatter too. In oxc-stack repos oxfmt also formats Markdown — see TypeScript: formatting. |
| Nix | nixfmt | deadnix + statix | — | — | |
| YAML | — | yamllint | — | — | In oxc-stack repos oxfmt also formats YAML — see TypeScript: formatting. |
| TOML | taplo (`taplo fmt`) | taplo (`taplo lint` + JSON-schema) | — | — | Format + lint + schema-validate `Cargo.toml` / `*.toml` config. Maintenance is in limbo (no release since 0.10.0, May 2025) — watch [`tombi`](https://github.com/tombi-toml/tombi) and oxfmt as successors; taplo's JSON-schema validation has no oxfmt equivalent. |
| Commit messages | — | commitlint (`@commitlint/config-conventional`) | — | — | One-line config. See `references/commitlint.config.js`. |
| Secrets | — | gitleaks | — | — | Always add — cheap, high-signal. |
| Typos | — | [typos](https://github.com/crate-ci/typos) | — | — | Fast, auto-fixes, tiny false-positive rate. |
| GitHub Actions / CI | — | [zizmor](https://github.com/zizmorcore/zizmor) + [actionlint](https://github.com/rhysd/actionlint) | — | — | Run both — minimal overlap. zizmor = security audit of `.github/workflows/*.yml` + `action.yml` (SARIF + `--format=github` annotations); actionlint = correctness (expression type-checks, `needs:` graph, runner labels; shells out to an installed ShellCheck for `run:` blocks — not embedded). actionlint is an hk builtin. |
| Postgres migrations | — | [squawk](https://squawkhq.com/) | eugene (watch — `eugene trace` only) | — | Rust, static — no DB needed in CI (`squawk 'migrations/*.sql'`; failure level configurable). Atlas `migrate lint` is paid. `eugene trace` observes real lock acquisition against a temp Postgres — ad-hoc for high-contention migrations; never wire `eugene lint` (duplicates squawk via the same pg_query.rs parser; pre-1.0, solo-maintained). Neither replaces `lock_timeout` / `statement_timeout` in the migration runner. MySQL/SQLite: gap. |
| API / event contracts | — | buf breaking / oasdiff / graphql-inspector | cargo-semver-checks, api-extractor | — | Baseline-diff gates for cross-service contracts — see Boundary contracts. |

## Rules catalogue

Rules are organised by **concern**, not by linter. Each entry gives: what it prevents, how to encode it, and known exceptions.

### Type safety

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Full strict mode | `tsconfig.json`: `"strict": true` | Most null/undefined footguns | Non-negotiable. |
| Indexed access returns `T \| undefined` | `"noUncheckedIndexedAccess": true` | `arr[0].foo` crashing on empty arrays | See `references/typescript-strict.jsonc`. |
| Exact optional properties | `"exactOptionalPropertyTypes": true` | Conflating `x?: T` with `x: T \| undefined`; writing `undefined` into a merely-optional field | Stricter than `strict`. Add `\| undefined` to optionals that are genuinely nullable. |
| Index-signature keys need bracket access | `"noPropertyAccessFromIndexSignature": true` | Typo'd dynamic keys (`cfg.hostnam`) silently typed instead of flagged | Stricter than `strict`. Declared properties keep dot access. |
| Dead code fails build | `"noUnusedLocals": true`, `"noUnusedParameters": true` | Drifted imports, zombie variables | Prefix with `_` to intentionally keep an unused param. |
| Only erasable TS syntax | `"erasableSyntaxOnly": true` (TS 5.8+) | `enum`, `namespace`, constructor param props — things that don't survive pure type-stripping | Enables deno/bun/swc/esbuild interop without a TS runtime. Breaks existing code using `enum`; migrate to `as const` unions. |
| No `any` | Biome `noExplicitAny` (error) | Escape hatch from the type system | Use `unknown` + narrowing. |
| No `as Type` assertions | ESLint `@typescript-eslint/consistent-type-assertions` with `assertionStyle: "never"` | Silent lies to the compiler | Allowed exceptions (document each with `eslint-disable-next-line` + reason): `as const`, DOM APIs after null checks, untyped-library interop, intentionally-invalid test fixtures. |
| No `!` non-null assertion | ESLint `@typescript-eslint/no-non-null-assertion` | Silent runtime crashes | Use a proper null check or throw a narrowed error. |
| Prefer `import type` | Biome `useImportType` | Accidental runtime imports of type-only modules | Auto-fixable. |

### TypeScript: type checking

`tsc --noEmit` strict is the authoritative gate. The native Go compiler
(Project Corsa, TS 7) is ~10× faster with near-parity `--noEmit` checking, so
it earns the fast local / pre-commit slot while `tsc` keeps the blocking gate.

| Tool | Default use | Notes |
|---|---|---|
| `tsc --noEmit` (TS 6) | Authoritative blocking gate | The required CI check until tsgo is verified stable on the project, then promote tsgo to primary. |
| `tsgo --noEmit` (TS 7) | Fast local / pre-commit check | Invoked as `tsgo` from `@typescript/native-preview`, or as `tsc` from `typescript@rc`. Same strict flags. |

Hard caveats while pre-GA:

- **Library builds stay on `tsc`.** tsgo declaration (`.d.ts`) emit still has gaps (declaration maps, `--build` / project-reference orchestration) — do not generate published artefacts with it yet.
- **The lint stack stays on TS 6.** The programmatic API (Strada) lands in 7.1, so typescript-eslint / ts-morph / custom transformers can't ride tsgo until then. Install side-by-side via `typescript@npm:@typescript/typescript6` if a tool needs the old API.

### Error handling

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No bare `catch` / swallowed errors | Biome `noCatchAssign`, `useErrorMessage`; ESLint `no-empty` with `allowEmptyCatch: false` | Errors disappearing into the void | Narrow in the catch (`catch (e) { if (e instanceof FooError) ... }`) or rethrow. |
| No catch-all re-throw without cause | Custom `no-restricted-syntax` catching rethrows without `{ cause }` | Losing error context | Required pattern: `throw new Error("while doing X", { cause: e })`. |
| Prefer Result types at domain boundaries | Convention + review; no linter | Exception-driven control flow in pure code | Exceptions live at the imperative shell only. |
| No `console.*` in prod code | Biome `noConsole` with `allow: ["warn", "error"]` | Logs leaking to user consoles | Use the project's logger. |

### Shell and zsh correctness

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| POSIX scripts stay POSIX | `shellcheck --shell=sh`, `checkbashisms`, tests under target shells (`dash`, `busybox sh`, `bash --posix`, etc.) | Bashisms and portability drift | ShellCheck's `sh` dialect means POSIX `sh`, not whatever `/bin/sh` points to locally. |
| Bash scripts pass static analysis | `shellcheck --shell=bash`, `shfmt -ln=bash --diff` | Quoting, globbing, parse, and maintainability footguns | Keep ShellCheck disables narrow and documented. |
| zsh parses cleanly | `zsh -n`, `shfmt -ln=zsh --diff` | Syntax and formatting drift | ShellCheck does not support zsh; do not fake it with `--shell=bash`. |
| Shell tests are hermetic | Test harness owns `PATH`, temp dirs, `HOME`/`ZDOTDIR`, and shell options | Ambient-machine failures | Put exact harness patterns in the testing skill; this skill gates the invariant. |

See `references/shell-quality.md` for copy-paste hook and CI command patterns.

### Python: Ruff format + lint

Ruff is the default Python formatter and linter. It replaces Black, isort,
Flake8, pyupgrade, and most Pylint-style low-level checks. Use an explicit,
stable rule set in shared templates; do not use `ALL` as the baseline because
new Ruff releases can add rules and turn upgrades into behaviour changes. See
`references/python-ruff.toml` for a drop-in `pyproject.toml` snippet.

Ruff 0.15 (2026) ships a one-time style-guide reformat and block-level
suppression comments (`# ruff: disable[RULE]` / `# ruff: enable[RULE]`) — prefer
those over file-wide `noqa`, and let the reformat land deliberately under the
release-age quarantine rather than as surprise churn on upgrade.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Stable baseline checks | `select = ["E", "F", "UP", "B", "SIM", "I", "RUF"]` | Syntax/style drift, Pyflakes bugs, stale Python syntax, common bug patterns, import disorder | Add noisier families per project once clean. |
| Formatter owns wrapping | Ruff format + ignore `E501` | Formatter/linter disagreement on line length | Re-enable `E501` only when the team wants hard line-length gates. |
| Safe fixes only by default | `ruff check --fix --show-fixes`; no `--unsafe-fixes` in hooks/CI | Mechanical rewrites changing semantics | Run unsafe fixes only as reviewed one-offs. |
| Tests get test-shaped ignores | per-file ignores for `tests/**` | Lints fighting idiomatic tests | Commonly relax `S101`, `ARG`, `FBT`, `PLR2004`, `D`, `ANN`. |
| Generated/migration files stay explicit | `exclude` for generated trees; per-file ignores for migrations | Generated/framework output obscuring real failures | Ignore whole generated trees; relax migrations narrowly. |

Optional high-signal rule families once a project is ready: `C4`, `PIE`, `RET`,
`PTH`, `LOG`/`G`, `T10`, `T20`, `PT`, `S`, `ARG`, `TC`, `PERF`. Treat `D`,
`ANN`, `PL`, `TRY`, `FBT`, `TD`, and `FIX` as policy-heavy; useful in strict
projects, noisy as defaults.

### Python: type checking

Use basedpyright as the default blocking type gate. Its `recommended` mode is
the best shared default: broad diagnostics, fail-on-warnings behaviour, and a
baseline workflow for existing projects. The fast Rust newcomers are catching
up — pyrefly is production (1.x), ty still beta — but basedpyright stays the gate
on maturity, conformance, and its MIT licence. See
`references/python-typecheck.toml`.

| Tool | Default use | Notes |
|---|---|---|
| basedpyright | Primary gate with `typeCheckingMode = "recommended"` | Prefer `[tool.basedpyright]` in `pyproject.toml`; use `--writebaseline` only during adoption, never in CI. |
| basedpyright `all` | Greenfield or deliberately strict projects | Higher friction; enable only once the codebase wants that contract. |
| pyright | Compatibility fallback | Use `pyright --warnings` so warnings fail CI. |
| pyrefly | Fast secondary / migration aid (Rust) | Meta's checker reached stable 1.x (~92% conformance, production at Instagram/PyTorch). Strong fast pre-filter and mypy/pyright-config migration path, but it doesn't follow strict semver — a bump can add errors — so keep basedpyright as the authoritative gate. |
| ty | Watch (beta, 0.0.x) | Astral's checker; fastest of the field and best uv/ruff fit, but diagnostics are explicitly unstable and conformance trails the others. Advisory only — re-evaluate at 1.0. |

Suppressions must be narrow and rule-coded: `# pyright: ignore[reportX]`,
`# pyrefly: ignore[rule]`, `# ty: ignore[rule-name]`, or
`# type: ignore[ty:rule-name]`. Avoid bare `# type: ignore`; keep unused-ignore
diagnostics enabled so suppressions expire.

### Python: dead code (Vulture)

Use Vulture for whole-project dead-code audits, not as a Ruff replacement. Ruff
/ Pyflakes already cover unused imports and local variables; Vulture adds
broader unused functions, classes, attributes, properties, and unreachable code.
See `references/python-vulture.toml`.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Whole-repo analysis | Run `vulture` from repo root; do not pass only changed files | False confidence from incomplete reachability | Include `src`, `tests`, scripts, and whitelist files. |
| Conservative gate | `min_confidence = 100` | Dynamic Python false positives blocking commits | Use lower confidence only for manual cleanup reports. |
| Whitelist intentional dynamic use | `vulture_whitelist.py` checked into the repo | Broad excludes hiding real dead code | Prefer whitelists over `ignore_names` / `ignore_decorators`; exclude only generated/vendor/build trees. |

### TypeScript: formatting (oxfmt, with Biome as the stable fallback)

The recommended default for new projects is the all-oxc stack: oxlint for
linting (it already owns the boundary rules below) plus **oxfmt** for
formatting, selected together via Ultracite's provider flag —
`ultracite init --linter oxlint` generates both `oxlint.config.ts` and
`oxfmt.config.ts` (one flag picks the whole toolchain; there is no separate
formatter flag). With oxlint doing the linting, Biome's role in this stack is
format-only — no integrated lint+format advantage — so the faster formatter
wins.

Why oxfmt: it passes 100% of Prettier's JS/TS conformance tests, runs ~30×
faster than Prettier and ~3× faster than Biome, formats ~20 file types, is
adopted by vuejs/core, turborepo and sentry-javascript, and sits under
VoidZero (acquired by Cloudflare; projects stay MIT under a neutrality
pledge). `oxfmt --migrate=prettier` / `--migrate=biome` converts existing
config, making the switch near-zero.

It is pre-1.0 (beta as of mid-2026), so Biome via Ultracite
(`--linter biome`) stays the documented stable fallback. Promote oxfmt to the
sole pick at 1.0. When migrating an existing repo, dry-run the diff first and
land the reformat as an isolated commit.

### TypeScript: what Biome 2.x covers (and the ESLint hold-outs)

Biome 2.x (pin `$schema` to the current release — 2.5.x as of mid-2026) has
absorbed much of what previously forced an ESLint flat config. Move those rules
into `biome.json` and keep ESLint only for what genuinely remains.

| Capability | Biome rule | Status | Replaces |
|---|---|---|---|
| Ban modules / globals by exact specifier | `noRestrictedImports`, `noRestrictedGlobals` | stable | simple ESLint `no-restricted-imports` / `no-restricted-globals` — plain strings only, no glob `patterns`, so path-family bans stay in ESLint |
| Package privacy via JSDoc visibility | `noPrivateImports` (`@package` / `@private` tags) | stable | the eslint-plugin-import `no-internal-modules` niche |
| Custom project-local AST rules | GritQL plugins (`.grit` via `linter.plugins`) | stable (code fixes in 2.5) | many `no-restricted-syntax` rules and some greppable invariants |
| Floating / misused promises | `noFloatingPromises`, `noMisusedPromises` (`types` domain) | nursery → advisory | a typescript-eslint class nothing else here catches |
| Import cycles | `noImportCycles` (`project` domain) | stable but scanner-heavy | overlaps madge — madge stays primary on perf (see Import hygiene) |

Genuine ESLint hold-outs — keep ESLint for these:

- **Import-type-aware boundary rules.** `noRestrictedImports` still can't allow `import type X` while banning the value import, so layer rules that must stay type-visible (`allowTypeImports`) need typescript-eslint.
- **Member-expression bans.** Biome has no `no-restricted-properties` equivalent, so `Date.now` / `Math.random` / `process.env` purity bans stay in ESLint — see the Purity section.
- **Mature framework / a11y plugins.** `jsx-a11y`, `eslint-plugin-react-hooks` edge cases, and `next/core-web-vitals` remain broader than Biome's ported domains.

GritQL plugins can't be shared across repos (by design), so a reusable
cross-repo invariant pack still lives in a shared ESLint config or the
greppable-invariants tier. Enabling the `types` / `project` domains turns on
Biome's project scanner — real perf cost, so treat those rules as advisory, not
a blocking gate.

### Architectural boundaries

Use `no-restricted-imports` and `no-restricted-syntax` to make illegal graphs uncompilable. The catalogue of patterns:

- **Pure layer cannot import side-effectful layer.** `files: ["src/utilities/**"]` + `no-restricted-imports` banning `next/cache`, `next/headers`, `next/navigation`, ORM runtime modules. Use `allowTypeImports: true` for types you still want visible. Exempt one or two *intentionally* coupled files (`queries.ts`, `revalidate.ts`) via `ignores`.
- **UI cannot import schemas directly.** `files: ["src/components/**"]` + `no-restricted-imports patterns` banning `@/collections/*` (or whichever path holds your DB schemas). UI should depend on *generated types*, not schema source — otherwise a UI tweak forces a migration.
- **Raw SQL only in the query layer.** `no-restricted-syntax` on `TaggedTemplateExpression[tag.name='sql']` everywhere except `src/db/**`. Also ban raw driver imports (`ImportDeclaration[source.value='postgres']`) outside the same directory. **sqruff** (Rust) then lints / formats that quarantined SQL — see the picks table.
- **Dynamic `import()` only via named wrappers.** `no-restricted-syntax` on `ImportExpression` outside `next/dynamic` / `React.lazy`. Prevents ad-hoc chunking that defeats SSR.

Full working snippets live in `references/eslint-boundaries.mjs`.

**oxlint (Rust) is the fast, Rust-first way to run these.** As of mid-2026 oxlint
is production (v1.7x; 1.0 shipped Jun 2025) with native `no-restricted-imports`,
`no-restricted-syntax`, `jsx-a11y`, and a multi-file `import/no-cycle` — so it
takes the boundary-rule role this skill kept ESLint around for, with no Node
dependency tree, and retires madge (see Import hygiene). Two adjacent pieces are
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

#### Transitive architecture tests

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
knip for unused exports, unused files, and unused dependencies.

See `references/dependency-cruiser.cjs` for a copyable TypeScript config shape.

#### Python boundaries (import-linter)

[import-linter](https://import-linter.readthedocs.io/) is the default: declare
`layers` / `forbidden` / `independence` contracts in `pyproject.toml` and gate
with `lint-imports` (non-zero exit). Two properties make it the pick — it gates
transitive import *chains* natively (an A→B→C path breaks a forbidden A→C
contract), and it includes `if TYPE_CHECKING:` imports by default, so type-only
coupling can't launder a boundary. Its grimp graph engine is Rust-accelerated,
so speed is not a differentiator for the newer rivals. Mature but
single-maintainer. See `references/python-import-linter.toml`.

**tach** (Rust) is opt-in for the two jobs import-linter has no primitive for:
`strict` public-interface enforcement (consumers may only import a module's
declared interface — blocks deep imports of internals) and guided incremental
adoption on legacy codebases (`tach mod` / `tach sync`). Know its caveats: it
checks direct declared edges only — it does **not** gate transitive chains; and
`tach sync` auto-allowlists existing imports, so unreviewed output bakes
accidental coupling in as permanently-allowed edges. It was abandoned once
(its company pivoted away from dev tools) and revived under a solo community
maintainer — bus factor ~1 with a prior death, so discount its star lead.
If ArchUnit-style tests inside pytest are wanted instead, prefer PyTestArch
over pytest-archon.

#### Go boundaries

depguard inside golangci-lint covers direct layer gating: multiple named rules
scoped by `files:` globs (e.g. a `domain` rule denying `myapp/internal/infra`
and the DB driver). Reach for
[go-arch-lint](https://github.com/fe3dback/go-arch-lint) when a real component
architecture warrants a declarative map — `components` + `deps.mayDependOn` in
`.go-arch-lint.yml`, gated with `go-arch-lint check`. `gomodguard_v2` is the
module-level sibling: allow/block whole modules with recommended replacements.

#### Rust boundaries

There is no import-linter equivalent — the pattern is structural. Make layers
separate workspace crates so the compiler enforces the DAG (the domain crate
simply has no path to infra). Back it with cargo-deny `[bans]` `wrappers`
("only app/api may depend on infra" — see `references/cargo-deny.toml`),
`cargo modules dependencies --acyclic` in CI where layering matters, and clippy
`disallowed-types` / `disallowed-methods` for coarse in-crate bans (see
`references/clippy-thresholds.toml`). cargo-pup (declarative architecture
lints; nightly-only) is a watch.

#### Greppable invariants (agent self-audit tier)

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
grep step below is the same technique applied to one rule.

**ast-grep upgrades the durable ones from text to AST.** `rg` matches strings,
so it false-positives on comments and string literals and false-negatives across
reformatting. [ast-grep](https://ast-grep.github.io/) (`sg`, Rust, production)
matches tree-sitter AST patterns with `$VAR` metavariables and gates via
`sg scan` (non-zero exit, YAML rules), polyglot from one binary. Use `rg` for
quick / throwaway assertions and ast-grep for the boundary rules you want to
keep — it also subsumes `no-restricted-syntax` rules that don't need type
information. It is syntax-only, so type-aware boundaries (import resolution,
`allowTypeImports`) still belong in ESLint / oxlint.

### Purity: keeping the functional core pure

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

### UI hygiene (React / Next)

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No raw `<input>` / `<button>` / `<a>` outside the component library | `no-restricted-syntax` on `JSXOpeningElement[name.name='input']` (etc.) in app/feature code | Drift from the design system | Exempt the UI library path (`src/components/ui/**`). Error message points at the wrapper component. |
| `jsx-a11y/recommended` on | ESLint `plugin:jsx-a11y/recommended` via flat config | Accessibility regressions | Turn off `no-noninteractive-tabindex` — the axe-mandated `scrollable-region-focusable` pattern conflicts. |
| No inline styles | Biome `noInlineStyles` (or ESLint `react/forbid-dom-props`) | Design-system bypass | Allow `style` on one or two charting components with a disable comment. |
| `useTopLevelRegex` (Biome) | default in Ultracite | Regex recompiled on every call; inline regex in test assertions | Prefer `.toThrow("Cannot submit:")` over `.toThrow(/Cannot submit:/)`. |

### Import hygiene

| Rule | Encode with | Prevents |
|---|---|---|
| Sorted + grouped imports | Biome `organizeImports` on format | Merge conflicts; inconsistency |
| No cycles | oxlint `import/no-cycle` (Rust, multi-file — retires madge) or [madge](https://github.com/pahen/madge) (`madge --circular`); Biome `noImportCycles` is stable but scanner-heavy | Module init-order bugs |
| No default exports (optional) | Biome `noDefaultExport` / ESLint `import/no-default-export` | Inconsistent naming at import sites; poor rename refactoring. Exempt Next.js pages/layouts where defaults are required. |
| Unique function names | `no-restricted-syntax` on duplicate `FunctionDeclaration` identifiers across a file; fallback is a grep-based hk step | Duplicate helpers being written instead of discovered. Grep check catches the cross-file case ESLint can't. |

### TypeScript: dead code (knip)

The TypeScript analogue of Vulture. `tsc`'s `noUnusedLocals` and madge only see
inside a file or the cycle graph; they never flag an unused *export*, an
orphaned file, or an unused / unlisted dependency. knip does — one tool for
unused files, exports, exported types, enum/class members, and unused
`dependencies` / `devDependencies`. `ts-prune` and `depcheck` are both archived;
knip is the successor. See `references/knip.jsonc`.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Whole-project graph | knip from the repo root (it builds the full import graph) | Orphaned files and dead exports drifting in | 150+ framework plugins teach it implicit entry points (next, vitest, storybook). |
| Gate in production mode | `knip --production` in CI | Test-only utilities being flagged as dead | Default (dev) mode is fine locally; `--production` drops test files for the gate. |
| Adopt before blocking | report-only first, then gate on exit code | A noisy first run blocking every commit | Tune `knip.json` for dynamic / implicit entries, then flip to blocking. |

A faster Rust alternative, **fallow**, covers the same dead-code graph plus
cycles — keep knip as the reference; fallow's boundary limits and open-core
risk are covered under Transitive architecture tests.

### TypeScript: library publishing (publint + attw)

For published packages, nothing in the lint / typecheck stack validates the
*shipped* shape. Two complementary, production tools close that gap — both gate
on a non-zero exit:

| Tool | Checks | Notes |
|---|---|---|
| publint | `package.json` `exports` / `main` / `module` / `types` resolve to real files; ESM/CJS format and condition order | Pure static, fast. Lints the packed tarball, so it only sees what ships. |
| `@arethetypeswrong/cli` (attw) | the shipped `.d.ts` resolve for consumers across node10 / node16-CJS / node16-ESM / bundler modes | Pick a `--profile` (e.g. node16, esm-only) so you don't fail on modes you don't support. Use `--pack`. |

These run **after the build**, against the built `dist` + generated `.d.ts`, so
they belong in a CI / pre-publish gate (pre-push or the release workflow), not
pre-commit. There is no Rust equivalent — attw drives `tsc` itself and publint
is already fast pure-JS, so the usual Rust-first preference doesn't apply. If the
library builds with tsdown (Rust/Rolldown), it can run both inline
(`tsdown --dts --publint --attw`). Pin both under the release-age quarantine —
they ship pre-1.0 and move fast. For monorepos, **sherif** (Rust) additionally
enforces dependency-version consistency across workspaces.

### Boundary contracts (cross-service compatibility)

Anything crossing a service boundary is a public contract (the
`event-driven-architecture` skill's framing) — and contract breakage is
mechanically checkable by diffing the schema against a baseline. publint/attw
above cover the npm package shape; these cover the wire:

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

### Testing

Enable Biome's `test` domain — it covers the generic rules natively
(`noFocusedTests`, `noSkippedTests`, `noDuplicateTestHooks`, `noExportsInTest`,
`noExcessiveNestedTestSuites`; nursery: `noConditionalExpect`, `useExpect`).
Framework-specific rules stay in ESLint; the vitest plugin is
`@vitest/eslint-plugin` (`eslint-plugin-vitest` is its pre-ESLint-9 name).

| Rule | Encode with | Prevents |
|---|---|---|
| No `.only` / `.skip` committed | Biome `noFocusedTests` (Ultracite default) + `noSkippedTests`; or `@vitest/eslint-plugin` `no-focused-tests` | Accidentally skipping the rest of the suite in CI |
| Assertion-free tests | Biome `useExpect` (nursery) or `@vitest/eslint-plugin` `expect-expect` | Tests that run code but assert nothing — the mechanical half of the testing skill's Assertion Quality note |
| No inline regex in assertions | Biome `useTopLevelRegex` | Flaky matches and poor error messages |
| Coverage threshold enforced pre-commit | hk step running `vitest run --coverage` + vitest config `thresholds: { 100: true }` | Untested branches slipping in. Use `/* v8 ignore next */` for unreachable defensive code. |
| No mocks in unit tests | Convention + review | Tests that pass but mask integration bugs |
| Flaky Playwright waits | eslint-plugin-playwright `no-wait-for-timeout`, `missing-playwright-await` | Timeout sleeps and unawaited async assertions — the two commonest flaky-e2e causes. Biome has no Playwright rules. |

### Secrets & supply chain

| Rule | Encode with | Prevents |
|---|---|---|
| No committed secrets | gitleaks pre-commit step | Token leaks |
| Pinned dependencies with quarantine | pnpm `minimum-release-age`, npm `min-release-age`, uv `exclude-newer`, mise `install_before` | Compromised releases |
| Detect deps that slipped the quarantine | osv-scanner against lockfiles (`mise run supply-audit`) | Malware (OSV `MAL-*`) + CVEs in already-installed deps — the detective half a time-based age-gate can't see |
| No `--no-verify` | Documented in project CLAUDE.md / AGENTS.md; not technically preventable | Bypassing the whole gate. Cultural rule — reinforce in every project's agent docs. |
| Pinned + safe GitHub Actions workflows | [zizmor](https://github.com/zizmorcore/zizmor) (gate on exit ≥ 11) | Unpinned actions (`unpinned-uses`), dangerous triggers (`dangerous-triggers` — `pull_request_target`/`workflow_run`), template injection into `run:` (`template-injection`), over-broad `permissions:` (`excessive-permissions`), impostor commits, typosquatted actions |

The quarantine and gitleaks rows are *preventive* — they slow adoption so the
community can flag a bad release, but nothing detects malware that already
slipped through (the 2026 worm waves shipped packages with valid provenance).
**osv-scanner** is the *detective* layer: it matches every lockfile ecosystem
(npm/pnpm, Cargo, uv/pip, Go, …) against the OSV database, including the `MAL-*`
malicious-package advisories an age-gate can't see. Run it in a project dir
(`osv-scanner scan source -r .`, wired as `mise run supply-audit` via
`aqua:google/osv-scanner`) and gate it in CI for repos that matter. Native
`pnpm` / `npm` / `bun audit` are GHSA-only (no malware) — an advisory fallback,
not a substitute. Socket (behavioural SCA + install firewall) is a watch:
stronger detection, but SaaS / telemetry / proprietary, against this skill's
local-OSS grain.

### Rust: type safety & correctness

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Deny all default warnings | `clippy -D warnings` | Warnings accumulating silently | Non-negotiable baseline. |
| Pedantic lints (selective) | `[workspace.lints.clippy] pedantic = { level = "warn", priority = -1 }` | Broader code quality issues | Start at `warn`, promote to `deny` once clean. Allow noisy lints per-project — see common allows table below. |
| Unused results | clippy `let_underscore_must_use`, `unused_results` | Silently discarding important return values | Complements `#[must_use]` annotations. |
| Unsafe visibility | `[workspace.lints.rust] unsafe_code = "warn"` | Unsafe blocks spreading unnoticed | `warn` not `deny` — FFI crates need escape hatch with per-crate override. |

### Rust: complexity thresholds (clippy.toml)

All settings go in `clippy.toml` at the workspace root. See `references/clippy-thresholds.toml` for a drop-in file.

| Setting | Default | Recommended | Prevents |
|---|---|---|---|
| `too-many-lines-threshold` | 100 | 100 | Functions too long to review in one screen. Per-fn `#[allow(clippy::too_many_lines)]` for faithful translations (e.g. ASM ports). |
| `too-many-arguments-threshold` | 7 | 7 | God-functions with too many inputs. |
| `cognitive-complexity-threshold` | 25 | 25 | Deeply nested/branching logic. |
| `type-complexity-threshold` | 250 | 250 | Deeply nested generics. |
| `max-fn-params-bools` | 3 | 3 | Boolean-parameter blindness. |
| `max-struct-bools` | 3 | 3 | Structs that should use enums instead. |
| `disallowed-names` | `["foo","baz","quux"]` | `["foo","bar","baz","quux"]` | Placeholder names leaking into prod. |

### Rust: common pedantic allows

When enabling `clippy::pedantic`, these lints are typically too noisy. Allow them at workspace level and document why so projects don't re-derive the set. See `references/rust-workspace-lints.toml` for a drop-in config.

| Lint | When to allow | Why |
|---|---|---|
| `cast-possible-truncation` | Numeric/embedded/emulator code | Intentional width casts are the norm |
| `cast-possible-lossless` | Same | Would flag every `u8 as u16` |
| `cast-precision-loss` | Float/audio/timing code | `f64 as f32` is intentional |
| `cast-sign-loss` | Bitwise/register code | `i32 as u32` is intentional |
| `module-name-repetitions` | Always | Idiomatic Rust (`error::Error`) |
| `must-use-candidate` | Always | Too many suggestions, low signal |
| `missing-errors-doc` | Non-library crates | Only useful for published APIs |
| `missing-panics-doc` | Non-library crates | Same |
| `similar-names` | Domain code with similar identifiers | Register names, coordinate pairs |
| `unreadable-literal` | Code with hex addresses/constants | `0x3CD70` shouldn't need `0x0003_CD70` |
| `wildcard-imports` | Test modules, enum re-exports | Common Rust pattern |
| `struct-excessive-bools` | State/config structs | Game state, feature flags |

### Rust: workspace lint wiring

Requires Rust 1.74+. Define lints once in root `Cargo.toml`, inherit in each crate. FFI/sys crates get per-crate overrides. See `references/rust-workspace-lints.toml` for a complete template.

```toml
# Root Cargo.toml
[workspace.lints.clippy]
pedantic = { level = "warn", priority = -1 }
# ... project-specific allows ...

[workspace.lints.rust]
unsafe_code = "warn"

# Each crate's Cargo.toml
[lints]
workspace = true

# FFI crate override example
[lints.clippy]
missing-safety-doc = "allow"
```

### Rust: supply chain (cargo-deny)

[cargo-deny](https://github.com/EmbarkStudios/cargo-deny) enforces dependency policy. See `references/cargo-deny.toml` for a template `deny.toml`.

| Concern | Config section | What it catches | Notes |
|---|---|---|---|
| Known vulnerabilities | `[advisories]` | CVEs in transitive deps via RustSec DB | Set `severity = "low"` to flag everything. |
| Licence compliance | `[licenses]` with allowlist | Unapproved or missing SPDX licences | Use `[[licenses.clarify]]` for deps with missing metadata. |
| Banned crates | `[bans]` | Specific crates (e.g. `openssl` → use `rustls`) or duplicate versions | `multiple-versions = "warn"` catches dep tree bloat. |
| Registry restriction | `[sources]` | Deps from unknown registries or git repos | `unknown-registry = "deny"`, `unknown-git = "warn"`. |

### Rust: unused dependencies (cargo-machete)

clippy and cargo-deny don't flag dependencies declared in `Cargo.toml` but never
used. [cargo-machete](https://github.com/bnjbvr/cargo-machete) does — a fast,
text-level scan that gates on a non-zero exit (`cargo machete`) and removes them
with `--fix`. Fewer deps means a smaller build and attack surface.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No unused deps | `cargo machete` (tier-4 hygiene) | Dead dependencies bloating the build and attack surface | False positives for deps used only via proc-macros / build scripts — suppress narrowly with `[package.metadata.cargo-machete] ignored`. |
| Exhaustive variant | `cargo udeps` on demand | Missed unused deps from machete's text-level scan | More precise but needs nightly + a full compile; too slow for a default hook, so keep it on-demand. |

### Commit messages

```js
// commitlint.config.js
export default { extends: ["@commitlint/config-conventional"] };
```

Wire via hk's `commit-msg` hook (see `references/hk-steps.pkl`). Nothing else to configure.

## Composition with the `hk` skill

This skill gives you *what* to enforce. The `hk` skill gives you *how* to wire it.

The typical mapping (TypeScript):

```text
tier 1 (format/fix)     → trailing-whitespace, newlines, typos, rumdl, oxfmt (or biome fix)
tier 2 (lint/gate)      → biome check, eslint, gitleaks, yamllint, check-merge-conflict, zizmor --offline + actionlint (hk builtin) (glob: .github/workflows/*.{yml,yaml} + action.yml)
tier 3 (typecheck)      → tsc --noEmit strict (TS 6, authoritative) + tsgo --noEmit (TS 7, fast local gate)
tier 4 (test)           → vitest run --coverage
commit-msg              → commitlint
```

The typical mapping (Rust):

```text
tier 1 (format/fix)     → trailing-whitespace, newlines, typos, cargo-fmt
tier 2 (lint/gate)      → cargo-clippy -D warnings, gitleaks, cargo-deny
tier 3 (typecheck)      → cargo check (usually redundant with clippy but catches cfg issues)
tier 4 (deps/test)      → cargo machete (unused deps), cargo test (scoped to changed crates via glob), cargo modules dependencies --acyclic where layering matters
```

The typical mapping (Python):

```text
tier 1 (format/fix)     → trailing-whitespace, newlines, typos, ruff check --fix, ruff format
tier 2 (lint/gate)      → ruff check, lint-imports (when contracts exist), gitleaks, yamllint, check-merge-conflict
tier 3 (typecheck)      → basedpyright (primary); optional pinned pyrefly/ty as advisory/secondary
tier 4 (dead code/test) → vulture at min_confidence=100 after baseline cleanup; pytest/coverage
```

The typical mapping (Shell):

```text
POSIX sh tier 1/2 → shfmt -ln=posix --diff, shellcheck --shell=sh, checkbashisms, parse/run under target shells
Bash tier 1/2     → shfmt -ln=bash --diff, shellcheck --shell=bash, bats-core or equivalent behaviour tests
zsh tier 1/2      → shfmt -ln=zsh --diff, zsh -n, native zsh behaviour tests
```

Baseline-diff gates run at pre-push / CI, not pre-commit: the contract gates
(buf breaking / oasdiff / cargo-semver-checks / api-extractor) and squawk
scoped to migration globs (`migrations/**/*.sql`).

Use `fix = true` + `stash = "git"` on pre-commit so tier 1 auto-fixes and re-stages. See `references/hk-steps.pkl` for a full worked example.

## Adding a new rule

When a bug escapes to review or production, the retro question is: **what rule would have caught this mechanically?**

1. Identify the smallest AST pattern, import, or type flag that expresses the rule.
2. Pick the linter that already owns that concern (see picks table).
3. Add it, with an inline comment explaining the failure mode it prevents.
4. Add an entry to the relevant rules-catalogue section above (in this SKILL.md) with the same rationale.
5. If it's a new *type* of rule worth sharing, add a snippet to `references/`.

## References

### Shell

- `references/shell-quality.md` — ShellCheck/shfmt/checkbashisms/zsh command patterns and hook notes

### TypeScript / JS

- `references/typescript-strict.jsonc` — strict `compilerOptions` block (drop-in)
- `references/biome-ultracite.jsonc` — Biome config extending Ultracite with override pattern
- `references/eslint-boundaries.mjs` — layered `no-restricted-imports` + `no-restricted-syntax` examples
- `references/purity-boundaries.mjs` — functional-core purity rules (`no-restricted-properties` + ast-grep equivalent)
- `references/dependency-cruiser.cjs` - transitive TypeScript graph-boundary config template
- `references/knip.jsonc` — knip dead-code / unused-deps config (drop-in)
- `references/commitlint.config.js` — one-line conventional-commits config

### Rust

- `references/clippy-thresholds.toml` — `clippy.toml` with recommended complexity thresholds (drop-in)
- `references/rust-workspace-lints.toml` — `[workspace.lints]` block with pedantic + common allows (drop-in)
- `references/cargo-deny.toml` — `deny.toml` template for licence/advisory/ban enforcement (drop-in)

### Python

- `references/python-ruff.toml` — Ruff formatter/linter `pyproject.toml` snippet (drop-in)
- `references/python-typecheck.toml` — basedpyright default plus pyright/ty notes (drop-in)
- `references/python-vulture.toml` — conservative Vulture dead-code config (drop-in)
- `references/python-import-linter.toml` — import-linter layer/forbidden/independence contracts + tach sketch

### Cross-stack

- `references/hk-steps.pkl` — worked hk.pkl step graph
- `references/contract-gates.md` — command patterns + CI placement for buf breaking, oasdiff, graphql-inspector, cargo-semver-checks, api-extractor, pact can-i-deploy
- [Ultracite](https://www.ultracite.ai/) — Biome preset bundle
- [hk](https://hk.jdx.dev) — git hook manager
