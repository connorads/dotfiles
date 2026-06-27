---
name: mechanical-enforcement
description: Catalogue of preferred linter rules, TypeScript flags, clippy thresholds, and architectural boundary checks for making bug classes and design drift mechanically impossible. Use when setting up linting in a new project, hardening an existing project, responding to a class of bug by encoding a rule, or deciding which linter to reach for on a given stack. Pairs with the `hk` skill which handles wiring hooks.
---

# Mechanical Enforcement

Rules a reviewer would otherwise have to remember belong in a linter. This skill is the curated catalogue of rules, the linters that enforce them, and the rationale for each — so a new project can be hardened without re-deriving the set.

This is a **content skill**, not a tool. It provides rules and snippets. For wiring those rules into git hooks, see the `hk` skill.

## Principles

1. **Mechanical over social**. If a rule relies on a reviewer remembering it, it will drift. Encode it in a linter, a type, or a test — never in a convention.
2. **Types first, lint second, tests third**. Prefer `strict` TypeScript / Pydantic / clippy to a custom lint rule. Reach for a lint rule when the type system can't express it. Reach for a test only when neither can.
3. **Architectural boundaries are linter rules**. Layers (domain ← infra, utilities ← server, UI ← schemas) are enforced with `no-restricted-imports` / `no-restricted-syntax`, not trusted to vigilance.
4. **Auto-fix where possible, gate where not**. Formatters and whitespace fixers run with `fix = true` and re-stage. Correctness rules gate the commit.
5. **Prefer opinionated presets, override minimally**. Ultracite for Biome, `@commitlint/config-conventional` for commits, `next/core-web-vitals` for Next. Only override with a comment explaining *why*.
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
| TypeScript / React / Next | Biome (via [Ultracite](https://www.ultracite.ai/) presets `core`, `react`, `next`) | Biome | oxlint (Rust) for native `no-restricted-imports` / `no-restricted-syntax` / `jsx-a11y` / `import/no-cycle`; ESLint flat config only for import-type boundaries + framework plugins (next, storybook); knip for dead-code / unused-deps | `tsc --noEmit` strict (+ `tsgo` fast local check — see typecheck below) | Ultracite is the default for new projects. Raw Biome only if Ultracite doesn't support the framework. |
| TypeScript (library / node) | Biome | Biome | oxlint (Rust) for boundary rules; knip for dead-code / unused-deps | `tsc --noEmit` strict | Skip ESLint — oxlint covers boundary rules in Rust; reach for ESLint only for import-type boundaries or framework plugins. Add publint + attw as a post-build publish gate. |
| Python | ruff format | ruff | vulture for whole-project dead-code audits | basedpyright recommended (or pyright); ty as beta supplement | `ruff` replaces black + isort + flake8 + pylint. See Python sections below. |
| Rust | rustfmt | clippy (`-D warnings`) | cargo-deny; cargo-machete (unused deps) | `cargo check` | `clippy::pedantic` selectively; full pedantic is too noisy. See Rust sections below for thresholds and common allows. |
| Go | gofmt / gofumpt | golangci-lint | — | `go vet` | Enable `errcheck`, `govet`, `staticcheck`, `revive`. |
| SQL | sqruff (`sqruff fix`) | sqruff (`sqruff lint --dialect <x>`) | sqlfluff (Python) for dbt/Jinja | — | Rust "Ruff for SQL". Lints the SQL the query-layer boundary quarantines. Beta — start advisory, verify dialect coverage before blocking. |
| Shell / POSIX `sh` | shfmt `-ln=posix` | ShellCheck `--shell=sh` | checkbashisms, multi-shell runtime tests | — | Use for portable `.sh`; run behaviour tests under real target shells. |
| Bash | shfmt `-ln=bash` | ShellCheck `--shell=bash` | bats-core for black-box CLI tests | — | Bats is Bash-based; good for CLI contracts and Bash scripts. |
| zsh | shfmt `-ln=zsh` | — | `zsh -n`, isolated zsh runtime tests | — | ShellCheck does not support zsh; use parser/format checks plus native tests. |
| Markdown | rumdl | rumdl | — | — | Handles frontmatter too. |
| Nix | nixfmt | deadnix + statix | — | — | |
| YAML | — | yamllint | — | — | |
| TOML | taplo (`taplo fmt`) | taplo (`taplo lint` + JSON-schema) | — | — | Format + lint + schema-validate `Cargo.toml` / `*.toml` config. Maintenance is in limbo (no release since 0.10.0, May 2025) — watch [`tombi`](https://github.com/tombi-toml/tombi) as the successor. |
| Commit messages | — | commitlint (`@commitlint/config-conventional`) | — | — | One-line config. See `references/commitlint.config.js`. |
| Secrets | — | gitleaks | — | — | Always add — cheap, high-signal. |
| Typos | — | [typos](https://github.com/crate-ci/typos) | — | — | Fast, auto-fixes, tiny false-positive rate. |
| GitHub Actions / CI | — | [zizmor](https://github.com/zizmorcore/zizmor) | — | — | Security audit of `.github/workflows/*.yml` + `action.yml`. SARIF + `--format=github` annotations. Complements gitleaks, not overlapping. |

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

`tsc --noEmit` strict is the authoritative gate. As of mid-2026 the native Go
compiler (Project Corsa) has reached RC — `typescript@rc` is `7.0.1-rc`, GA
estimated ~late July 2026 — and is ~10× faster with near-parity `--noEmit`
checking, so it earns an explicit place as the fast local / pre-commit check
rather than the passing mention it had before.

| Tool | Default use | Notes |
|---|---|---|
| `tsc --noEmit` (TS 6) | Authoritative blocking gate | The required CI check until tsgo GA is verified on the project, then promote tsgo to primary. |
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
baseline workflow for existing projects. See `references/python-typecheck.toml`.

| Tool | Default use | Notes |
|---|---|---|
| basedpyright | Primary gate with `typeCheckingMode = "recommended"` | Prefer `[tool.basedpyright]` in `pyproject.toml`; use `--writebaseline` only during adoption, never in CI. |
| basedpyright `all` | Greenfield or deliberately strict projects | Higher friction; enable only once the codebase wants that contract. |
| pyright | Compatibility fallback | Use `pyright --warnings` so warnings fail CI. |
| ty | Optional beta supplement | Pin tightly, start advisory, and do not replace basedpyright yet while diagnostics are still unstable. |

Suppressions must be narrow and rule-coded: `# pyright: ignore[reportX]`,
`# ty: ignore[rule-name]`, or `# type: ignore[ty:rule-name]`. Avoid bare
`# type: ignore`; keep unused-ignore diagnostics enabled so suppressions expire.

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

### TypeScript: what Biome 2.x covers (and the ESLint hold-outs)

Biome 2.x (pin `$schema` to the current release — 2.5.x as of mid-2026) has
absorbed much of what previously forced an ESLint flat config. Move those rules
into `biome.json` and keep ESLint only for what genuinely remains.

| Capability | Biome rule | Status | Replaces |
|---|---|---|---|
| Ban modules / globals by path or glob | `noRestrictedImports`, `noRestrictedGlobals` | stable | most ESLint `no-restricted-imports` / `no-restricted-globals` |
| Custom project-local AST rules | GritQL plugins (`.grit` via `linter.plugins`) | stable (code fixes in 2.5) | many `no-restricted-syntax` rules and some greppable invariants |
| Floating / misused promises | `noFloatingPromises`, `noMisusedPromises` (`types` domain) | nursery → advisory | a typescript-eslint class nothing else here catches |
| Import cycles | `noImportCycles` (`project` domain) | stable but scanner-heavy | overlaps madge — madge stays primary on perf (see Import hygiene) |

Genuine ESLint hold-outs — keep ESLint for these:

- **Import-type-aware boundary rules.** `noRestrictedImports` still can't allow `import type X` while banning the value import, so layer rules that must stay type-visible (`allowTypeImports`) need typescript-eslint.
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

#### Greppable invariants (agent self-audit tier)

Some boundaries are awkward or impossible for `no-restricted-imports` to see:
cross-package leaks in a monorepo, raw-string patterns, "this directory must
stay framework-free". Encode these as **grep assertions that must return zero
matches** — a cheap pre-flight an agent runs before declaring work done, and
that wires into an hk step where it should gate.

```bash
# each line must find NOTHING; `! rg` turns a match into a non-zero (failing) exit
! rg -n "from ['\"]express['\"]" packages/core/src                 # core stays framework-free
! rg -n "new Date\(|Date\.now\(|Math\.random\(" packages/core/src  # no un-injected clock/rng in the domain
! rg -n "sql\`" packages/*/src --glob '!packages/db/**'            # raw SQL only in the query layer
```

This sits between lint and review. Prefer a real `no-restricted-imports` /
`no-restricted-syntax` rule when the linter *can* express the boundary — it runs
in-editor and is harder to bypass. Reach for grep for the cross-file,
cross-package, and string-level cases ESLint can't see, and as a portable check
an agent can run in any repo with no linter config. The "unique function names"
grep step below is the same technique applied to one rule.

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

A faster Rust alternative, **fallow**, covers the same graph plus cycles and
boundary checks, but its core is MIT while the high-confidence runtime layer is
paid (open-core) and the tool is young — keep knip as the reference and treat
fallow as a watch.

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

### Testing

| Rule | Encode with | Prevents |
|---|---|---|
| No `.only` committed | Biome `noFocusedTests` (Ultracite default); or ESLint `vitest/no-focused-tests` | Accidentally skipping the rest of the suite in CI |
| No inline regex in assertions | Biome `useTopLevelRegex` | Flaky matches and poor error messages |
| Coverage threshold enforced pre-commit | hk step running `vitest run --coverage` + vitest config `thresholds: { 100: true }` | Untested branches slipping in. Use `/* v8 ignore next */` for unreachable defensive code. |
| No mocks in unit tests | Convention + review | Tests that pass but mask integration bugs |

### Secrets & supply chain

| Rule | Encode with | Prevents |
|---|---|---|
| No committed secrets | gitleaks pre-commit step | Token leaks |
| Pinned dependencies with quarantine | pnpm `minimum-release-age`, npm `min-release-age`, uv `exclude-newer`, mise `install_before` | Compromised releases |
| No `--no-verify` | Documented in project CLAUDE.md / AGENTS.md; not technically preventable | Bypassing the whole gate. Cultural rule — reinforce in every project's agent docs. |
| Pinned + safe GitHub Actions workflows | [zizmor](https://github.com/zizmorcore/zizmor) (gate on exit ≥ 11) | Unpinned actions (`unpinned-uses`), dangerous triggers (`dangerous-triggers` — `pull_request_target`/`workflow_run`), template injection into `run:` (`template-injection`), over-broad `permissions:` (`excessive-permissions`), impostor commits, typosquatted actions |

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
tier 1 (format/fix)     → trailing-whitespace, newlines, typos, rumdl, biome fix
tier 2 (lint/gate)      → biome check, eslint, gitleaks, yamllint, check-merge-conflict, zizmor --offline (glob: .github/workflows/*.{yml,yaml} + action.yml)
tier 3 (typecheck)      → tsc --noEmit strict (TS 6, authoritative) + tsgo --noEmit (TS 7, fast local gate)
tier 4 (test)           → vitest run --coverage
commit-msg              → commitlint
```

The typical mapping (Rust):

```text
tier 1 (format/fix)     → trailing-whitespace, newlines, typos, cargo-fmt
tier 2 (lint/gate)      → cargo-clippy -D warnings, gitleaks, cargo-deny
tier 3 (typecheck)      → cargo check (usually redundant with clippy but catches cfg issues)
tier 4 (deps/test)      → cargo machete (unused deps), cargo test (scoped to changed crates via glob)
```

The typical mapping (Python):

```text
tier 1 (format/fix)     → trailing-whitespace, newlines, typos, ruff check --fix, ruff format
tier 2 (lint/gate)      → ruff check, gitleaks, yamllint, check-merge-conflict
tier 3 (typecheck)      → basedpyright (optional pinned ty check as advisory/secondary)
tier 4 (dead code/test) → vulture at min_confidence=100 after baseline cleanup; pytest/coverage
```

The typical mapping (Shell):

```text
POSIX sh tier 1/2 → shfmt -ln=posix --diff, shellcheck --shell=sh, checkbashisms, parse/run under target shells
Bash tier 1/2     → shfmt -ln=bash --diff, shellcheck --shell=bash, bats-core or equivalent behaviour tests
zsh tier 1/2      → shfmt -ln=zsh --diff, zsh -n, native zsh behaviour tests
```

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

### Cross-stack

- `references/hk-steps.pkl` — worked hk.pkl step graph
- [Ultracite](https://www.ultracite.ai/) — Biome preset bundle
- [hk](https://hk.jdx.dev) — git hook manager
