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
6. **The _why_ lives with the rule**. Every non-obvious override has an inline comment saying what would break if it were removed.

## When to use this skill

- Setting up linting in a new project → pick linters from the table below, copy snippets from `references/`, wire with the `hk` skill.
- Hardening an existing project → audit against the rules catalogue, add the missing ones.
- A bug just happened → ask "what rule would have caught this mechanically?" and add it here.
- Choosing a linter for an unfamiliar stack → see the picks table.

## Linter picks by stack

Use the tool in the **Primary** column first; reach for the **Also** column only when the primary can't express the rule.

| Stack | Formatter | Primary linter | Also | Type-check | Notes |
|---|---|---|---|---|---|
| TypeScript / React / Next | Biome (via [Ultracite](https://www.ultracite.ai/) presets `core`, `react`, `next`) | Biome | ESLint flat config — only for `no-restricted-imports`, `no-restricted-syntax`, `jsx-a11y`, framework plugins (next, storybook) | `tsc --noEmit` strict | Ultracite is the default for new projects. Raw Biome only if Ultracite doesn't support the framework. |
| TypeScript (library / node) | Biome | Biome | — | `tsc --noEmit` strict | Skip ESLint entirely unless you need boundary rules. |
| Python | ruff format | ruff | — | basedpyright strict (or pyright) | `ruff` replaces black + isort + flake8 + pylint. |
| Rust | rustfmt | clippy (`-D warnings`) | cargo-deny | `cargo check` | `clippy::pedantic` selectively; full pedantic is too noisy. See Rust sections below for thresholds and common allows. |
| Go | gofmt / gofumpt | golangci-lint | — | `go vet` | Enable `errcheck`, `govet`, `staticcheck`, `revive`. |
| Shell | shfmt | shellcheck | — | — | `-e SC2086` only with comment. |
| Markdown | rumdl | rumdl | — | — | Handles frontmatter too. |
| Nix | nixfmt | deadnix + statix | — | — | |
| YAML | — | yamllint | — | — | |
| Commit messages | — | commitlint (`@commitlint/config-conventional`) | — | — | One-line config. See `references/commitlint.config.js`. |
| Secrets | — | gitleaks | — | — | Always add — cheap, high-signal. |
| Typos | — | [typos](https://github.com/crate-ci/typos) | — | — | Fast, auto-fixes, tiny false-positive rate. |

## Rules catalogue

Rules are organised by **concern**, not by linter. Each entry gives: what it prevents, how to encode it, and known exceptions.

### Type safety

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Full strict mode | `tsconfig.json`: `"strict": true` | Most null/undefined footguns | Non-negotiable. |
| Indexed access returns `T \| undefined` | `"noUncheckedIndexedAccess": true` | `arr[0].foo` crashing on empty arrays | See `references/typescript-strict.jsonc`. |
| Dead code fails build | `"noUnusedLocals": true`, `"noUnusedParameters": true` | Drifted imports, zombie variables | Prefix with `_` to intentionally keep an unused param. |
| Only erasable TS syntax | `"erasableSyntaxOnly": true` (TS 5.8+) | `enum`, `namespace`, constructor param props — things that don't survive pure type-stripping | Enables deno/bun/swc/esbuild interop without a TS runtime. Breaks existing code using `enum`; migrate to `as const` unions. |
| No `any` | Biome `noExplicitAny` (error) | Escape hatch from the type system | Use `unknown` + narrowing. |
| No `as Type` assertions | ESLint `@typescript-eslint/consistent-type-assertions` with `assertionStyle: "never"` | Silent lies to the compiler | Allowed exceptions (document each with `eslint-disable-next-line` + reason): `as const`, DOM APIs after null checks, untyped-library interop, intentionally-invalid test fixtures. |
| No `!` non-null assertion | ESLint `@typescript-eslint/no-non-null-assertion` | Silent runtime crashes | Use a proper null check or throw a narrowed error. |
| Prefer `import type` | Biome `useImportType` | Accidental runtime imports of type-only modules | Auto-fixable. |

### Error handling

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No bare `catch` / swallowed errors | Biome `noCatchAssign`, `useErrorMessage`; ESLint `no-empty` with `allowEmptyCatch: false` | Errors disappearing into the void | Narrow in the catch (`catch (e) { if (e instanceof FooError) ... }`) or rethrow. |
| No catch-all re-throw without cause | Custom `no-restricted-syntax` catching rethrows without `{ cause }` | Losing error context | Required pattern: `throw new Error("while doing X", { cause: e })`. |
| Prefer Result types at domain boundaries | Convention + review; no linter | Exception-driven control flow in pure code | Exceptions live at the imperative shell only. |
| No `console.*` in prod code | Biome `noConsole` with `allow: ["warn", "error"]` | Logs leaking to user consoles | Use the project's logger. |

### Architectural boundaries

Use `no-restricted-imports` and `no-restricted-syntax` to make illegal graphs uncompilable. The catalogue of patterns:

- **Pure layer cannot import side-effectful layer.** `files: ["src/utilities/**"]` + `no-restricted-imports` banning `next/cache`, `next/headers`, `next/navigation`, ORM runtime modules. Use `allowTypeImports: true` for types you still want visible. Exempt one or two *intentionally* coupled files (`queries.ts`, `revalidate.ts`) via `ignores`.
- **UI cannot import schemas directly.** `files: ["src/components/**"]` + `no-restricted-imports patterns` banning `@/collections/*` (or whichever path holds your DB schemas). UI should depend on *generated types*, not schema source — otherwise a UI tweak forces a migration.
- **Raw SQL only in the query layer.** `no-restricted-syntax` on `TaggedTemplateExpression[tag.name='sql']` everywhere except `src/db/**`. Also ban raw driver imports (`ImportDeclaration[source.value='postgres']`) outside the same directory.
- **Dynamic `import()` only via named wrappers.** `no-restricted-syntax` on `ImportExpression` outside `next/dynamic` / `React.lazy`. Prevents ad-hoc chunking that defeats SSR.

Full working snippets live in `references/eslint-boundaries.mjs`.

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
| No cycles | [madge](https://github.com/pahen/madge) (`madge --circular`) in pre-commit or `eslint-plugin-import`'s `no-cycle` | Module init-order bugs |
| No default exports (optional) | Biome `noDefaultExport` / ESLint `import/no-default-export` | Inconsistent naming at import sites; poor rename refactoring. Exempt Next.js pages/layouts where defaults are required. |
| Unique function names | `no-restricted-syntax` on duplicate `FunctionDeclaration` identifiers across a file; fallback is a grep-based hk step | Duplicate helpers being written instead of discovered. Grep check catches the cross-file case ESLint can't. |

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

### Commit messages

```js
// commitlint.config.js
export default { extends: ["@commitlint/config-conventional"] };
```

Wire via hk's `commit-msg` hook (see `references/hk-steps.pkl`). Nothing else to configure.

## Composition with the `hk` skill

This skill gives you *what* to enforce. The `hk` skill gives you *how* to wire it.

The typical mapping (TypeScript):

```
tier 1 (format/fix)     → trailing-whitespace, newlines, typos, rumdl, biome fix
tier 2 (lint/gate)      → biome check, eslint, gitleaks, yamllint, check-merge-conflict
tier 3 (typecheck)      → tsc --noEmit (or tsgo)
tier 4 (test)           → vitest run --coverage
commit-msg              → commitlint
```

The typical mapping (Rust):

```
tier 1 (format/fix)     → trailing-whitespace, newlines, typos, cargo-fmt
tier 2 (lint/gate)      → cargo-clippy -D warnings, gitleaks, cargo-deny
tier 3 (typecheck)      → cargo check (usually redundant with clippy but catches cfg issues)
tier 4 (test)           → cargo test (scoped to changed crates via glob)
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

### TypeScript / JS
- `references/typescript-strict.jsonc` — strict `compilerOptions` block (drop-in)
- `references/biome-ultracite.jsonc` — Biome config extending Ultracite with override pattern
- `references/eslint-boundaries.mjs` — layered `no-restricted-imports` + `no-restricted-syntax` examples
- `references/commitlint.config.js` — one-line conventional-commits config

### Rust
- `references/clippy-thresholds.toml` — `clippy.toml` with recommended complexity thresholds (drop-in)
- `references/rust-workspace-lints.toml` — `[workspace.lints]` block with pedantic + common allows (drop-in)
- `references/cargo-deny.toml` — `deny.toml` template for licence/advisory/ban enforcement (drop-in)

### Cross-stack
- `references/hk-steps.pkl` — worked hk.pkl step graph
- [Ultracite](https://www.ultracite.ai/) — Biome preset bundle
- [hk](https://hk.jdx.dev) — git hook manager
