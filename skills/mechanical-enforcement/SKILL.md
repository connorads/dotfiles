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
| TypeScript / React / Next | oxfmt or Biome, via [Ultracite](https://www.ultracite.ai/) (`--linter oxlint` / `biome`) — see `references/typescript.md` (formatting) | Biome | oxlint (Rust) for native `no-console` / `typescript/no-explicit-any` / `typescript/no-non-null-assertion` / `no-restricted-imports` / `jsx-a11y` / `import/no-cycle` — **not** `no-restricted-syntax` (not native as of 1.74; needs the alpha JS plugin — member-expression bans ride a grep step, see `references/architecture-boundaries.md`); dependency-cruiser for transitive graph boundaries; ESLint flat config only for import-type boundaries + framework plugins (next, storybook); knip for dead-code / unused-deps | `tsc --noEmit` strict (+ `tsgo` fast local check - see `references/typescript.md`) | Ultracite is the default for new projects; the all-oxc stack (oxlint + oxfmt) is the recommended provider, Biome the stable fallback. Raw Biome only if Ultracite doesn't support the framework. |
| TypeScript (library / node) | oxfmt or Biome | Biome | oxlint (Rust) for direct boundary rules; dependency-cruiser for transitive graph boundaries; knip for dead-code / unused-deps | `tsc --noEmit` strict | Skip ESLint - oxlint covers most boundary rules in Rust; reach for ESLint only for import-type boundaries or framework plugins. Add publint + attw as a post-build publish gate. |
| Python | ruff format | ruff | import-linter for layer / forbidden / independence contracts (tach is a watch — see `references/python.md`); vulture for whole-project dead-code audits | basedpyright recommended (primary); pyrefly (Rust) fast secondary; ty still beta | `ruff` replaces black + isort + flake8 + pylint. See `references/python.md`. |
| Rust | rustfmt | clippy (`-D warnings`) | cargo-deny; cargo-machete (unused deps) | `cargo check` | `clippy::pedantic` selectively; full pedantic is too noisy. See `references/rust.md` for thresholds and common allows. |
| Go | gofmt / gofumpt | golangci-lint | go-arch-lint for declarative component `mayDependOn` maps; `gomodguard_v2` for module allow/block lists (v1 is deprecated in golangci-lint) | `go vet` | Enable `errcheck`, `govet`, `staticcheck`, `revive`. depguard with per-`files:` rules gates layers — see `references/architecture-boundaries.md` (Go boundaries). |
| SQL | sqruff (`sqruff fix`) | sqruff (`sqruff lint --dialect <x>`) | sqlfluff (Python) for dbt/Jinja | — | Rust "Ruff for SQL". Lints the SQL the query-layer boundary quarantines. Beta — start advisory, verify dialect coverage before blocking. |
| Shell / POSIX `sh` | shfmt `-ln=posix` | ShellCheck `--shell=sh` | checkbashisms, multi-shell runtime tests | — | Use for portable `.sh`; run behaviour tests under real target shells. |
| Bash | shfmt `-ln=bash` | ShellCheck `--shell=bash` | bats-core for black-box CLI tests | — | Bats is Bash-based; good for CLI contracts and Bash scripts. |
| zsh | shfmt `-ln=zsh` | — | `zsh -n`, isolated zsh runtime tests | — | ShellCheck does not support zsh; use parser/format checks plus native tests. |
| PowerShell | PSScriptAnalyzer (`Invoke-Formatter`) | PSScriptAnalyzer (`Invoke-ScriptAnalyzer -EnableExit`) | `PSUseCompatibleSyntax` / `PSUseCompatibleCommands` / `PSUseCompatibleTypes` for the version-floor gate; a grep step for `$IsWindows` / `$IsMacOS` / `$IsLinux` (the compat rules do **not** cover automatic variables); Pester for behaviour tests | — | Target the **Windows PowerShell 5.1 floor** when the script must run on a stock Windows — the default shell is `powershell.exe` 5.1, not pwsh 7 — the pwsh analogue of the bash-3.2 contract. Point `PSUseCompatibleCommands`/`Types` at the bundled 5.1 profile (`win-8_x64_10.0.14393.0_5.1.14393.2791_x64_4.0.30319.42000_framework` — the full `compatibility_profiles` filename base; the short `desktop-5.1.*` alias doesn't resolve in 1.25). **`-EnableExit` is load-bearing** — without it the analyzer exits 0 even with findings. Config lives in a `PSScriptAnalyzerSettings.psd1`; run tests under pwsh 7 + Pester 5 (the compat gate, not the test runtime, enforces 5.1). |
| Markdown | rumdl | rumdl | — | — | Handles frontmatter too. In oxc-stack repos oxfmt also formats Markdown — see `references/typescript.md` (formatting). |
| CSS / SCSS | Biome or oxfmt (format only) | stylelint (`stylelint "**/*.css" --max-warnings=0`) | Biome's own CSS linter (recommended-tier, vanilla CSS only — no SCSS, no property order) when already on Biome; eslint-plugin-better-tailwindcss for Tailwind class *validation* (`no-unknown-classes` / `no-conflicting-classes`) | — | Extend `stylelint-config-standard` (v40, ESM-only, needs stylelint 17 / Node ≥20.19) + `stylelint-order` + `stylelint-config-css-modules`. Stylelint removed stylistic rules in v16 — a formatter owns those. Class *ordering* is now formatter territory (oxfmt native Tailwind sort / prettier-plugin-tailwindcss), so run the Tailwind plugin for validation only. Gale (Rust drop-in) is a watch — v0.1.x, single-maintainer, can't run JS plugins. |
| HTML | — | html-validate (`html-validate "**/*.html"`) | — | — | Static offline HTML5 conformance; exits non-zero on errors (`--max-warnings 0` also fails on warnings). Aggressive Node floor (22.22+/24.8+). No `<html lang>` rule — runtime a11y (axe/pa11y) owns that. See `references/web-delivery.md`. |
| Nix | nixfmt | deadnix + statix | — | — | |
| YAML | — | yamllint | — | — | In oxc-stack repos oxfmt also formats YAML — see `references/typescript.md` (formatting). |
| TOML | taplo (`taplo fmt`) | taplo (`taplo lint` + JSON-schema) | — | — | Format + lint + schema-validate `Cargo.toml` / `*.toml` config. Maintenance is in limbo (no release since 0.10.0, May 2025) — watch [`tombi`](https://github.com/tombi-toml/tombi) and oxfmt as successors; taplo's JSON-schema validation has no oxfmt equivalent. |
| Commit messages | — | commitlint (`@commitlint/config-conventional`) | — | — | One-line config. See `references/commitlint.config.js`. |
| Secrets | — | gitleaks | — | — | Always add — cheap, high-signal. |
| Typos | — | [typos](https://github.com/crate-ci/typos) | — | — | Fast, auto-fixes. Low false-positive rate on prose, but locale mode rewrites US-spelled identifiers in code — see the locale caveat below. |
| GitHub Actions / CI | — | [zizmor](https://github.com/zizmorcore/zizmor) + [actionlint](https://github.com/rhysd/actionlint) | — | — | Run both — minimal overlap. zizmor = security audit of `.github/workflows/*.yml` + `action.yml` (SARIF + `--format=github` annotations); actionlint = correctness (expression type-checks, `needs:` graph, runner labels; shells out to an installed ShellCheck for `run:` blocks — not embedded). actionlint is an hk builtin. Both are *static*; to *execute* a workflow locally before push (dynamic complement, not a linter), see [agent-ci](https://github.com/redwoodjs/agent-ci) — runs the real self-hosted runner image in Docker. |
| Postgres migrations | — | [squawk](https://squawkhq.com/) | eugene (watch — `eugene trace` only) | — | Rust, static — no DB needed in CI (`squawk 'migrations/*.sql'`; failure level configurable). Atlas `migrate lint` is paid. `eugene trace` observes real lock acquisition against a temp Postgres — ad-hoc for high-contention migrations; never wire `eugene lint` (duplicates squawk via the same pg_query.rs parser; pre-1.0, solo-maintained). Neither replaces `lock_timeout` / `statement_timeout` in the migration runner. MySQL/SQLite: gap. |
| API / event contracts | — | buf breaking / oasdiff / graphql-inspector | cargo-semver-checks, api-extractor; vacuum for baseline-free OpenAPI spec governance | — | Baseline-diff gates for cross-service contracts — see `references/architecture-boundaries.md` (Boundary contracts); spec-shape governance in `references/contract-gates.md`. |
| Custom rules / SAST | — | Opengrep (`opengrep scan --config <dir> --error`) | ast-grep for syntax-only structural rules — see `references/architecture-boundaries.md` | — | The OSS Semgrep fork (engine LGPL-2.1) after the Dec-2024 semgrep-rules relicensing: dataflow/taint custom rules across 20+ languages, Semgrep-format YAML, SARIF. Install via curl/Docker (no npm). **Default exits 0 even with findings — `--error` is load-bearing.** For authoring your own bug-class rules; see "Adding a new rule" and `references/architecture-boundaries.md` (Greppable invariants). |

> **Framework single-file components** (`.astro` / `.vue` / `.svelte`) have no
> picks row: the Rust JS linters can't parse them and misread their template
> syntax as false positives. Scope the JS linter to `*.ts/*.js/*.mjs` and let the
> framework's own checker (`astro check` / `vue-tsc` / `svelte-check`) plus its
> ESLint parser own the SFC — see `references/typescript.md` (Framework
> single-file components).
>
> **Locale spell-checker caveat.** A locale-rewriting spell hook (typos `en-gb`,
> aspell) treats US spellings as errors and auto-"fixes" them — including
> US-spelled **external identifiers inside string literals**: CLI flags
> (`--flavor`, `--color`), schema.org / HTTP protocol names (`Organization`,
> `authorization`), CSS keywords (`color`, `center`, `behavior`), and API field
> names. Rewriting those silently breaks the build or the wire — `pyftsubset
> --flavour` is "Unknown option", an `authorisation` header fails auth. Allow-list
> them **proactively** and re-check string literals after any commit the hook
> auto-fixed. Describe the class, not a fixed word list — the dictionary drifts,
> so a pinned list rots. Wire the allow-list per hk (`[default.extend-words]`;
> `hk/references/builtins-by-language.md`).

## Rules catalogue

Rules are organised by **concern**, not by linter. Each entry gives: what it prevents, how to encode it, and known exceptions. Per-stack detail is loaded on demand from `references/`:

- **TypeScript / JS** → `references/typescript.md` — type safety, type checking, error handling, formatting, Biome-vs-ESLint, UI/import hygiene, dead code, library publishing, shipped-artifact gates, test lints.
- **Python** → `references/python.md` — Ruff, type checking, dead code, boundaries.
- **Rust** → `references/rust.md` — clippy correctness, thresholds, pedantic allows, workspace wiring, supply chain, unused deps, boundaries.
- **Architectural boundaries** (cross-stack) → `references/architecture-boundaries.md` — illegal-graph rules, transitive gates, Go boundaries, greppable invariants, purity, contract gates.
- **Web delivery gates** (cross-stack) → `references/web-delivery.md` — runtime accessibility (the runtime complement to static `jsx-a11y`), HTML conformance, structured data, Open Graph metadata, broken links. Boundaries: perf → `web-perf` skill; a11y rationale → `accessibility` skill.

The cross-stack concerns below stay inline.

### Shell, zsh, and PowerShell correctness

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| POSIX scripts stay POSIX | `shellcheck --shell=sh`, `checkbashisms`, tests under target shells (`dash`, `busybox sh`, `bash --posix`, etc.) | Bashisms and portability drift | ShellCheck's `sh` dialect means POSIX `sh`, not whatever `/bin/sh` points to locally. |
| Bash scripts pass static analysis | `shellcheck --shell=bash`, `shfmt -ln=bash --diff` | Quoting, globbing, parse, and maintainability footguns | Keep ShellCheck disables narrow and documented. |
| zsh parses cleanly | `zsh -n`, `shfmt -ln=zsh --diff` | Syntax and formatting drift | ShellCheck does not support zsh; do not fake it with `--shell=bash`. |
| PowerShell stays on the 5.1 floor | `PSUseCompatibleSyntax`/`Commands`/`Types` against the bundled 5.1 profile (Error), + a grep failing on `$IsWindows`/`$IsMacOS`/`$IsLinux` outside the one OS-detection file | 7-only syntax (ternary `?:`, `??`, `&&`/`||`, `ForEach-Object -Parallel`) and cmdlets/types/automatic-vars absent in Windows PowerShell 5.1 silently breaking on a stock Windows | The compat rules cover syntax/commands/types but **not** automatic variables — hence the grep. Back with a dynamic 5.1 smoke (`powershell.exe -File …`) since static analysis can't see a `$null` deref. |
| Shell tests are hermetic | Test harness owns `PATH`, temp dirs, `HOME`/`ZDOTDIR`, and shell options | Ambient-machine failures | Put exact harness patterns in the testing skill; this skill gates the invariant. |

See `references/shell-quality.md` for copy-paste hook and CI command patterns.

### Secrets & CI hardening

| Rule | Encode with | Prevents |
|---|---|---|
| No committed secrets | gitleaks pre-commit step | Token leaks |
| One policy value spelled across many configs stays in agreement | Custom pre-commit checker: one expected constant, one (file, regex, unit) row per config, normalise units, fail on drift; glob the hook step on exactly those files | Silent policy forks — e.g. a supply-chain quarantine hand-encoded in nine files across four time units, where editing one file quietly weakens the rest |
| No `--no-verify` | Documented in project CLAUDE.md / AGENTS.md; not technically preventable | Bypassing the whole gate. Cultural rule — reinforce in every project's agent docs. |
| Pinned + safe GitHub Actions workflows | [zizmor](https://github.com/zizmorcore/zizmor) (gate on exit ≥ 11) | Unpinned actions (`unpinned-uses`), dangerous triggers (`dangerous-triggers` — `pull_request_target`/`workflow_run`), template injection into `run:` (`template-injection`), over-broad `permissions:` (`excessive-permissions`), impostor commits, typosquatted actions, missing/short Dependabot cooldown (`dependabot-cooldown`, wants ≥ 7 days), build-time code exec in dependency updates (`dependabot-execution`) |
| SHA-pins stay fresh, not stale | Dependabot `package-ecosystem: github-actions` with `cooldown: { default-days: 7 }` in `.github/dependabot.yml` | Pinned actions rotting unpatched, and a freshly-compromised release auto-bumping before the community catches it. The cooldown is itself audited by zizmor (`dependabot-cooldown`); it's the GitHub Actions arm of the release-age quarantine — rationale, config keys, and the known Actions-cooldown bug are in the supply-chain-hardening skill |

Dependency supply-chain posture — release-age quarantine keys and units,
install-script blocking, osv-scanner wiring and its MAL-vs-CVE severity split,
provenance verification, and exception discipline — lives in the
**supply-chain-hardening** skill. This skill keeps the linter-shaped controls
above and the generic config-drift-guard checker pattern.

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
4. Add an entry to the relevant rules-catalogue section — inline in this SKILL.md for a cross-stack concern, or the matching `references/` stack file — with the same rationale.
5. If it's a new *type* of rule worth sharing, add a snippet to `references/`.

### Ratcheting a gate onto non-conforming code

A hard threshold (complexity cap, coverage floor, a new `no-restricted-*` or
graph rule) fails the whole build the day it lands on a codebase that already
violates it — so it gets reverted, or slackened to a ceiling that governs
nothing. Ratchet instead (Ford/Parsons): record today's violations as a
committed baseline, fail only *new* ones, and shrink the baseline deliberately.
Write the baseline once during adoption; never refresh it in CI.

| Stack / tool | Baseline vehicle | Notes |
|---|---|---|
| ESLint | `eslint --suppress-all` → committed `eslint-suppressions.json` (v9.24+) | New violations still fail; `--prune-suppressions` as debt is paid. |
| dependency-cruiser | `depcruise-baseline` + `--ignore-known` | Makes graph/boundary rules adoptable on an already-tangled repo. |
| basedpyright | `--writebaseline` — the exemplar workflow in `references/python-typecheck.toml` | Baselined errors downgrade to hints; fixed ones auto-prune. |
| ruff | `ruff check --select CODE --add-noqa`; expire stale ones with `--extend-select RUF100 --fix` | Bulk inline suppression, not a baseline file — scope per rule. |
| golangci-lint | `--new-from-merge-base` / `--new-from-rev` | Git-diff gating; no baseline file. |
| Coverage (Vitest) | `coverage.thresholds.autoUpdate: true` | Self-tightening: bumps thresholds up as coverage rises. Run where the config edit can be committed, not in a gated CI job. |

Biome and oxlint have no baseline mechanism (open proposals only) — on a legacy
repo that needs one, carry the rule on the ESLint / dependency-cruiser layer
instead. Betterer, the generic snapshot-ratchet wrapper, is dormant — avoid.
Where no vehicle exists, fall back to severity: gate at *warning* first,
escalate to *error* after a grace window, and tighten the number release by
release.

## References

### Per-stack rule catalogues

- `references/typescript.md` — TypeScript / JS: type safety, type checking, error handling, formatting, Biome-vs-ESLint, UI/import hygiene, dead code, library publishing, shipped-artifact gates, test lints
- `references/python.md` — Python: Ruff, type checking, dead code, import boundaries
- `references/rust.md` — Rust: clippy correctness, thresholds, pedantic allows, workspace wiring, cargo-deny, cargo-machete, crate boundaries
- `references/architecture-boundaries.md` — cross-stack boundaries: illegal-graph rules, transitive graph gates, Go boundaries, greppable invariants, purity, contract gates
- `references/web-delivery.md` — cross-stack web delivery gates: runtime accessibility (axe/pa11y), HTML conformance (html-validate), structured data (schema-dts), Open Graph metadata, broken links (lychee)

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
