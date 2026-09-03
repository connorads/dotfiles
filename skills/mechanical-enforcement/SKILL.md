---
name: mechanical-enforcement
description: Catalogue of preferred linter rules, TypeScript flags, clippy thresholds, import-boundary checks, contract-compat gates, and architecture tests for making bug classes and design drift mechanically impossible. Use when setting up linting in a new project, hardening an existing project, responding to a class of bug by encoding a rule, or deciding which linter to reach for on a given stack. Pairs with the `hk` skill which handles wiring hooks.
---

# Mechanical Enforcement

Rules a reviewer would otherwise have to remember belong in a linter. This skill is the curated catalogue of rules, the linters that enforce them, and the rationale for each, so a new project is hardened without re-deriving the set.

A **content skill**, not a tool: rules and snippets. Wiring them into git hooks is the `hk` skill's job.

## Principles

1. **Mechanical over social**. If a rule relies on a reviewer remembering it, it will drift. Encode it in a linter, a type, or a test - never in a convention.
2. **Types first, lint second, tests third**. Prefer `strict` TypeScript / Pydantic / clippy to a custom lint rule. Reach for a lint rule when the type system can't express it. Reach for a test only when neither can.
3. **Architectural boundaries are linter rules**. Layers (domain <- infra, UI <- schemas) are enforced with `no-restricted-imports` or a graph check when the rule is transitive, never trusted to vigilance.
4. **Auto-fix where possible, gate where not**. Formatters and whitespace fixers run with `fix = true` and re-stage. Correctness rules gate the commit.
5. **Own the rule list where the rules are the point, take a preset where they are not**. `@commitlint/config-conventional` for commits and `next/core-web-vitals` for Next are presets worth inheriting; the lint set that backs an idiom is a config this catalogue owns, because a preset that silences one of those rules does it silently. Override either only with a comment saying *why*.
6. **The *why* lives with the rule**. Every non-obvious override has an inline comment saying what would break if it were removed.

## When to use this skill

- New project → pick from the table below, read that stack's reference, copy its drop-ins, wire with `hk`.
- Existing project → audit against the stack reference, add what is missing, ratchet what lands red.
- A bug just happened → "what rule would have caught this mechanically?" (Adding a new rule).
- Unfamiliar stack → the picks table.

## Picks by stack

The table names the defaults. The **Read** column is where each pick is justified, its traps listed and its hk tier map kept - read it before configuring anything.

| Stack | Format | Lint | Type-check | Read |
|---|---|---|---|---|
| TypeScript / JS | oxfmt | oxlint (+ type-aware via tsgolint); knip; a ts-morph architecture test; ESLint only behind a TS 6 alias | `tsc -p` (TS 7) | `references/typescript.md` (Picks) |
| Python | ruff format | ruff; import-linter; ast-grep; deptry; vulture; complexipy | basedpyright `recommended` | `references/python.md` (Picks) |
| Rust | rustfmt | clippy `-D warnings`; cargo-deny; cargo-machete | `cargo check` | `references/rust.md` (Picks) |
| Nix | nixfmt | deadnix + statix | `nix eval` of every host's `.drvPath` | `references/nix.md` (Picks) |
| Shell: sh, bash, zsh, PowerShell | shfmt per dialect; `Invoke-Formatter` | ShellCheck per dialect; `zsh -n`; PSScriptAnalyzer | - | `references/shell-quality.md` (Picks) |
| Go | gofmt / gofumpt | golangci-lint | `go vet` | `references/other-stacks.md` (Go) |
| SQL; Postgres migrations | sqruff | sqruff; squawk | - | `references/other-stacks.md` |
| CSS / SCSS | Biome or oxfmt | stylelint | - | `references/other-stacks.md` |
| HTML | - | html-validate | - | `references/web-delivery.md` (HTML conformance) |
| Markdown; YAML; TOML | rumdl; oxfmt; taplo | rumdl; yamllint; taplo | - | `references/other-stacks.md` |
| Commit messages | - | commitlint | - | Commit messages, below |
| Secrets; typos; GitHub Actions | - | gitleaks; typos; zizmor + actionlint | - | Secrets & CI hardening, below |
| API / event contracts | - | buf breaking; oasdiff; graphql-inspector; cargo-semver-checks; api-extractor | - | `references/contract-gates.md`; `references/architecture-boundaries.md` (Boundary contracts) |
| Code duplication | - | jscpd | - | `references/complexity.md` (Duplication) |
| Custom rules / SAST | - | Opengrep; ast-grep | - | `references/architecture-boundaries.md` (Greppable invariants) |

Framework single-file components (`.astro` / `.vue` / `.svelte`) have no row: the Rust JS linters misread their templates - see `references/typescript.md` (Framework single-file components).

**Locale spell-checker caveat.** A locale-rewriting spell hook (typos `en-gb`, aspell) auto-"fixes" US-spelled **external identifiers inside string literals** - CLI flags (`--flavor`), protocol names (`authorization`), CSS keywords (`color`, `center`), schema.org types, API fields - and silently breaks the build or the wire. Allow-list the class proactively (a fixed word list rots as the dictionary drifts) and re-check string literals after any auto-fixed commit. Wiring: hk `[default.extend-words]`, `hk/references/builtins-by-language.md`.

## Rules catalogue

Rules are organised by **concern**, not by linter: what it prevents, how to encode it, known exceptions. The routing table at the end says which reference owns which concern; only the two every repo has stay inline.

### Secrets & CI hardening

| Rule | Encode with | Prevents |
|---|---|---|
| No committed secrets | gitleaks pre-commit step | Token leaks |
| One policy value spelled across many configs stays in agreement | Custom checker: one expected constant, one (file, regex, unit) row per config, normalise units, fail on drift; glob the step on exactly those files | Silent policy forks - a quarantine hand-encoded in nine files across four time units, where editing one quietly weakens the rest |
| Every dependency build script has a recorded decision | Custom checker reading installed manifests against the allowlist (pnpm: `allowBuilds` in `pnpm-workspace.yaml`); glob on `package.json`, lockfile, workspace YAML. Ready-made: the hk skill's `assets/pnpm-build-scripts-check.mjs` | A CI-only `ERR_PNPM_IGNORED_BUILDS` that a global `ignoreScripts` hides locally. Assert statically; the reproduction command is itself a de-protection |
| No `--no-verify` | Project AGENTS.md; not technically preventable | Bypassing the whole gate |
| Workflows are correct | [actionlint](https://github.com/rhysd/actionlint) (hk builtin) | Expression type errors, a broken `needs:` graph, unknown runner labels; it shells out to an installed ShellCheck for `run:` blocks rather than embedding one |
| Workflows are pinned and safe | [zizmor](https://github.com/zizmorcore/zizmor) (gate on exit ≥ 11; SARIF or `--format=github`) | `unpinned-uses`, `dangerous-triggers` (`pull_request_target` / `workflow_run`), `template-injection` into `run:`, `excessive-permissions`, impostor commits, typosquatted actions, `dependabot-cooldown` shorter than 7 days, `dependabot-execution` |
| SHA-pins stay fresh, not stale | Dependabot `package-ecosystem: github-actions` with `cooldown: { default-days: 7 }` | Pinned actions rotting unpatched, and a freshly-compromised release auto-bumping before the community catches it - the Actions arm of the release-age quarantine |

Run zizmor and actionlint together - minimal overlap, both static. [agent-ci](https://github.com/redwoodjs/agent-ci) *executes* a workflow locally in the real runner image: a dynamic complement, not a linter. Dependency supply-chain posture (quarantine keys and units, install-script blocking, osv-scanner, provenance, the Actions-cooldown bug) is the **supply-chain-hardening** skill's; this skill keeps the linter-shaped controls above and the config-drift-checker pattern.

### Commit messages

```js
// commitlint.config.js
export default { extends: ["@commitlint/config-conventional"] };
```

Wire via hk's `commit-msg` hook (see `references/hk-steps.pkl`). Nothing else to configure.

## Composition with the `hk` skill

This skill gives you *what* to enforce; the `hk` skill gives you *how* to wire it. The generic ladder - each stack reference's Picks section maps its tools onto it:

```text
tier 1 (format/fix)          → trailing-whitespace, newlines, typos, the stack formatter (fix = true, re-staged)
tier 2 (lint/gate)           → the stack linter incl. boundary and purity rules, gitleaks, yamllint, check-merge-conflict, zizmor --offline + actionlint (glob .github/workflows/*.{yml,yaml}, action.yml)
tier 3 (typecheck)           → the stack type checker
tier 4 (deps/dead code/test) → dependency and dead-code gates, the test runner scoped to changed paths by glob
CI / pre-push                → baseline-diff contract gates (buf breaking / oasdiff / cargo-semver-checks / api-extractor), squawk on migrations/**/*.sql, publish gates, audits
commit-msg                   → commitlint
```

Baseline-diff gates run at pre-push / CI, not pre-commit: they need the base ref. Use `fix = true` + `stash = "git"` on pre-commit so tier 1 auto-fixes and re-stages. Worked example: `references/hk-steps.pkl`.

## Adding a new rule

When a bug escapes to review or production, the retro question is: **what rule would have caught this mechanically?**

1. Identify the smallest AST pattern, import, or type flag that expresses the rule.
2. Pick the linter that already owns that concern (the picks table).
3. Add it, with an inline comment explaining the failure mode it prevents.
4. Record it with the same rationale in the matching `references/` stack file (inline above only for a cross-stack concern), and as a drop-in if it is a new *type* of rule.

### Ratcheting a gate onto non-conforming code

A hard threshold (complexity cap, coverage floor, a new `no-restricted-*` or graph rule) fails the whole build the day it lands on a codebase that already violates it - so it gets reverted, or slackened to a ceiling that governs nothing. Ratchet instead (Ford/Parsons): record today's violations as a committed baseline, fail only *new* ones, shrink the baseline deliberately, and never refresh it in CI. The vehicle per tool and the traps in each: `references/ratcheting.md`.

Complexity gates are the archetype. If the number you want produces more than a couple of dozen violations, it is a refactoring backlog, not a gate - carry it as CI reporting until the backlog shrinks. A number chosen to make today's worst file pass is not a gate.

## References

| When the task involves… | Read |
|---|---|
| A TypeScript / JS project: strictness, type check, lint families, formatting, hygiene, dead code | `references/typescript.md`; drop-ins `typescript-strict-app.jsonc`, `typescript-strict-lib.jsonc`, `typescript-oxlintrc.jsonc`, `typescript-oxfmtrc.jsonc`, `typescript-ast-grep.yml`, `knip.jsonc` |
| TypeScript test gates: vitest keys, test lints, runtime backstops, bun test | `references/typescript-testing.md`; drop-ins `typescript-vitest.config.ts`, `typescript-vitest-setup.ts` |
| TypeScript dependencies and publishing: lockfile, licences, build, publint, attw, the consumer smoke | `references/typescript-publishing.md`; drop-in `typescript-publish-gates.sh` |
| TypeScript security: prototype pollution, ReDoS, the parse boundary, runtime flags, sinks | `references/typescript-security.md`; drop-in `typescript-ast-grep.yml` |
| A Python project | `references/python.md`; drop-ins `python-ruff.toml`, `python-typecheck.toml`, `python-vulture.toml`, `python-import-linter.toml`, `python-purity.toml`, `python-ast-grep.yml`, `python-pytest.toml`, `python-deptry.toml` |
| A Rust workspace | `references/rust.md`; drop-ins `clippy-thresholds.toml`, `rust-workspace-lints.toml`, `cargo-deny.toml` |
| Nix | `references/nix.md` |
| Shell: sh, bash, zsh, PowerShell | `references/shell-quality.md` |
| Go, SQL, Postgres migrations, CSS / SCSS, Markdown, YAML, TOML | `references/other-stacks.md`; Go complexity drop-in `golangci-complexity.yml` |
| Layer and graph boundaries, greppable invariants, purity, contract gates (any stack) | `references/architecture-boundaries.md`; drop-ins `typescript-arch-test.ts`, `dependency-cruiser.cjs`, `eslint-boundaries.mjs`, `purity-boundaries.mjs`; command patterns in `references/contract-gates.md` |
| Complexity and duplication: what to gate on, the numbers, off-by-default traps, jscpd | `references/complexity.md` |
| Adopting a gate on a codebase that already violates it | `references/ratcheting.md` |
| Web delivery: runtime a11y, HTML conformance, structured data, Open Graph, broken links | `references/web-delivery.md` |
| Wiring the tiers into hk | `references/hk-steps.pkl`; `commitlint.config.js`; the optional Biome preset `biome-ultracite.jsonc` |

External: [hk](https://hk.jdx.dev) (git hook manager), [Ultracite](https://www.ultracite.ai/) (an optional React/Next preset over the oxc stack, with the traps `references/typescript.md` lists).
