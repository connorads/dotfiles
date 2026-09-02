# Mechanical Enforcement - Other stacks

Picks and traps for the stacks the `SKILL.md` picks table routes here: Go, SQL,
Postgres migrations, CSS / SCSS, Markdown, YAML and TOML. Every other stack has
a reference of its own.

## Go

Format with `gofmt`, or `gofumpt` for the stricter superset; lint with
`golangci-lint`; keep `go vet` in the pipeline as the compiler-adjacent check
`golangci-lint` wraps as `govet`.

- Enable `errcheck`, `govet`, `staticcheck` and `revive` explicitly - the
  linters that catch dropped errors, suspicious constructs and style drift.
- depguard's per-`files:` rules gate layers, `gomodguard_v2` allow/block-lists
  whole modules (v1 is deprecated in `golangci-lint`), and `go-arch-lint` holds
  a declarative component `mayDependOn` map - configuration in
  `references/architecture-boundaries.md` (Go boundaries).
- Complexity thresholds and the `golangci-lint` v2 config traps live in
  `references/complexity.md` (Go).

## SQL

| Concern | Pick | Notes |
|---|---|---|
| Format | `sqruff fix` | Rust-native, positioned as "Ruff for SQL" - one binary for format and lint, so the two never disagree. |
| Lint | `sqruff lint --dialect <x>` | The dialect flag is required for correct parsing; it lints the SQL that the query-layer boundary quarantines. Beta, so start advisory and verify dialect coverage before it blocks a commit. |
| dbt / Jinja | `sqlfluff` (Python) | The templated-SQL case `sqruff` does not cover. |

## Postgres migrations

| Concern | Pick | Notes |
|---|---|---|
| Lint | [squawk](https://squawkhq.com/) | Rust and static, so CI needs no database - `squawk 'migrations/*.sql'`, failure level configurable. |
| Lock observation | `eugene trace` | Watch tier. |

- Atlas `migrate lint` is paid, so it is not a default pick.
- `eugene trace` observes real lock acquisition against a temporary Postgres -
  worth running by hand for a high-contention migration.
- Never wire `eugene lint`: it duplicates squawk through the same `pg_query.rs`
  parser, and is pre-1.0 with a single maintainer.
- Neither tool replaces `lock_timeout` and `statement_timeout` in the migration
  runner - a static check cannot bound how long a lock is held.
- MySQL and SQLite have no equivalent static migration linter: a gap.

## CSS / SCSS

| Concern | Pick | Notes |
|---|---|---|
| Format | Biome or oxfmt, format-only | Either formatter owns whitespace and property placement, leaving stylelint the semantic rules. |
| Lint | `stylelint "**/*.css" --max-warnings=0` | `--max-warnings=0` is what makes a warning fail the gate. |
| Already on Biome | Biome's own CSS linter | Recommended-tier and vanilla CSS only - no SCSS, no property order - so it supplements stylelint rather than replacing it. |
| Tailwind | `eslint-plugin-better-tailwindcss` | Validation rules only: `no-unknown-classes` and `no-conflicting-classes`. |

- Extend `stylelint-config-standard` (v40 is ESM-only and needs stylelint 17 on
  Node >= 20.19), plus `stylelint-order` for property order and
  `stylelint-config-css-modules` where CSS Modules syntax would otherwise report.
- Stylelint v16 and later ship no stylistic rules - the formatter owns those, so
  do not try to recover them from a config.
- Class *ordering* is formatter territory: oxfmt's native Tailwind sort, or
  `prettier-plugin-tailwindcss`.
- Gale, the Rust drop-in for stylelint, stays a watch: v0.1.x, single
  maintainer, and it cannot run stylelint's JS plugins.

## Markdown

| Concern | Pick | Notes |
|---|---|---|
| Format and lint | `rumdl` | One tool for both, and it handles frontmatter rather than choking on it. |

- In an oxc-stack repo oxfmt also formats Markdown - see
  `references/typescript.md` (Formatting).

## YAML

| Concern | Pick | Notes |
|---|---|---|
| Lint | `yamllint` | Lint only; formatting is the repo formatter's job. |

- In an oxc-stack repo oxfmt also formats YAML - see
  `references/typescript.md` (Formatting).

## TOML

| Concern | Pick | Notes |
|---|---|---|
| Format | `taplo fmt` | Covers `Cargo.toml` and `*.toml` config alike. |
| Lint and schema | `taplo lint` plus JSON-schema validation | Schema validation catches a misspelled key that a syntax check accepts. |

- taplo's maintenance is in limbo - no release since 0.10.0, May 2025 (verified
  2026-09-02) - so watch [`tombi`](https://github.com/tombi-toml/tombi) and
  oxfmt as successors.
- oxfmt has no equivalent for taplo's JSON-schema validation, so a move to
  oxfmt formatting keeps taplo for the schema half.
