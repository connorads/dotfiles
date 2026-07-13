# Mechanical Enforcement — TypeScript / JS

Per-stack rules for TypeScript and JavaScript: type-safety flags, type
checking, error handling, formatting, the Biome-vs-ESLint split, UI and import
hygiene, dead code, library publishing, shipped-artifact gates, and test lints.
Routed from the picks table and rules-catalogue index in `SKILL.md`. Boundary
rules (`no-restricted-imports` patterns, transitive graph gates, purity) live in
`references/architecture-boundaries.md`.

- [Type safety](#type-safety)
- [Type checking](#type-checking)
- [Error handling](#error-handling)
- [Formatting (oxfmt, with Biome as the stable fallback)](#formatting-oxfmt-with-biome-as-the-stable-fallback)
- [What Biome 2.x covers (and the ESLint hold-outs)](#what-biome-2x-covers-and-the-eslint-hold-outs)
- [UI hygiene (React / Next)](#ui-hygiene-react--next)
- [Import hygiene](#import-hygiene)
- [Dead code (knip)](#dead-code-knip)
- [Library publishing (publint + attw)](#library-publishing-publint--attw)
- [Asserting on shipped artifacts](#asserting-on-shipped-artifacts)
- [Testing](#testing)

## Type safety

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

## Type checking

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

## Error handling

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No bare `catch` / swallowed errors | Biome `noCatchAssign`, `useErrorMessage`; ESLint `no-empty` with `allowEmptyCatch: false` | Errors disappearing into the void | Narrow in the catch (`catch (e) { if (e instanceof FooError) ... }`) or rethrow. |
| No catch-all re-throw without cause | Custom `no-restricted-syntax` catching rethrows without `{ cause }` | Losing error context | Required pattern: `throw new Error("while doing X", { cause: e })`. |
| Prefer Result types at domain boundaries | Convention + review; no linter | Exception-driven control flow in pure code | Exceptions live at the imperative shell only. |
| No `console.*` in prod code | Biome `noConsole` with `allow: ["warn", "error"]` | Logs leaking to user consoles | Use the project's logger. |

## Formatting (oxfmt, with Biome as the stable fallback)

The recommended default for new projects is the all-oxc stack: oxlint for
linting (it already owns the boundary rules in `references/architecture-boundaries.md`) plus **oxfmt** for
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

It is pre-1.0 (check the oxfmt releases page for current status), so Biome via Ultracite
(`--linter biome`) stays the documented stable fallback. Promote oxfmt to the
sole pick at 1.0. When migrating an existing repo, dry-run the diff first and
land the reformat as an isolated commit.

## What Biome 2.x covers (and the ESLint hold-outs)

Biome 2.x (pin `$schema` to your installed release) has absorbed much of what
an ESLint flat config was once needed for. Move those rules
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
- **Member-expression bans.** Biome has no `no-restricted-properties` equivalent, so `Date.now` / `Math.random` / `process.env` purity bans stay in ESLint — see Purity in `references/architecture-boundaries.md`.
- **Mature framework / a11y plugins.** `jsx-a11y`, `eslint-plugin-react-hooks` edge cases, and `next/core-web-vitals` remain broader than Biome's ported domains.

GritQL plugins can't be shared across repos (by design), so a reusable
cross-repo invariant pack still lives in a shared ESLint config or the
greppable-invariants tier. Enabling the `types` / `project` domains turns on
Biome's project scanner — real perf cost, so treat those rules as advisory, not
a blocking gate.

## UI hygiene (React / Next)

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No raw `<input>` / `<button>` / `<a>` outside the component library | `no-restricted-syntax` on `JSXOpeningElement[name.name='input']` (etc.) in app/feature code | Drift from the design system | Exempt the UI library path (`src/components/ui/**`). Error message points at the wrapper component. |
| `jsx-a11y/recommended` on | ESLint `plugin:jsx-a11y/recommended` via flat config | Accessibility regressions | Turn off `no-noninteractive-tabindex` — the axe-mandated `scrollable-region-focusable` pattern conflicts. |
| No inline styles | Biome `noInlineStyles` (or ESLint `react/forbid-dom-props`) | Design-system bypass | Allow `style` on one or two charting components with a disable comment. |
| `useTopLevelRegex` (Biome) | default in Ultracite | Regex recompiled on every call; inline regex in test assertions | Prefer `.toThrow("Cannot submit:")` over `.toThrow(/Cannot submit:/)`. |

## Import hygiene

| Rule | Encode with | Prevents |
|---|---|---|
| Sorted + grouped imports | Biome `organizeImports` on format | Merge conflicts; inconsistency |
| No cycles | oxlint `import/no-cycle` (Rust, multi-file — retires madge) or [madge](https://github.com/pahen/madge) (`madge --circular`); Biome `noImportCycles` is stable but scanner-heavy | Module init-order bugs |
| No default exports (optional) | Biome `noDefaultExport` / ESLint `import/no-default-export` | Inconsistent naming at import sites; poor rename refactoring. Exempt Next.js pages/layouts where defaults are required. |
| Unique function names | `no-restricted-syntax` on duplicate `FunctionDeclaration` identifiers across a file; fallback is a grep-based hk step | Duplicate helpers being written instead of discovered. Grep check catches the cross-file case ESLint can't. |

## Dead code (knip)

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
risk are covered under Transitive architecture tests in
`references/architecture-boundaries.md`.

## Library publishing (publint + attw)

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

## Asserting on shipped artifacts

publint/attw above validate a published package's shape; the same "gate the
built output, not the source" discipline applies to any site's first-load
surface. Three tiers, cheapest-to-verify first:

| Layer | Off-the-shelf? | Gate with |
|---|---|---|
| Byte / time budgets | yes | **size-limit** (`@size-limit/file` for raw bytes, `preset-app` for time-to-run); non-zero exit in CI. `size-limit-action` (andresz1) wraps it for PR comments — a *community* action, not first-party. |
| Runtime metrics (LCP / CLS / perf score) | yes | **Lighthouse CI** (`budget.json` or per-URL assertions) + **unlighthouse** (site-wide crawl). Both need a served preview + Chrome; sample multiple runs — perf assertions flake. |
| Semantic first-load HTML invariants | no — bespoke | a Node checker that reads `dist/*.html` and exits non-zero |

**Don't reach for** bundlesize (unmaintained — last release 0.18.x, 2024) or
statoscope (webpack/rspack `stats.json` only — no Astro/Vite fit). Treat the
version literals here as illustrative; confirm against the live registry.

The third tier is the interesting one: it is the **typed generalisation of the
greppable-invariants tier** (`references/architecture-boundaries.md`) and a sibling to publint/attw's post-build
gate. Where grep asserts "this string does not appear", a first-load checker
asserts structural facts about the shipped HTML — font-preload count within
budget, `crossorigin` present, the preload `href` matching an inline
`@font-face url()` byte-for-byte, a metric-matched fallback face present,
rendered copy staying inside the font subset's glyph coverage. When the site is
prerendered, `dist/*.html` IS the shipped bytes, so asserting on the files is
asserting on what users get.

The discipline that makes it trustworthy: **keep the constraint set as one
shared module** imported by both the generator and the checker (e.g. the glyph
ranges the subsetter emits and the coverage assertion reads), so they cannot
drift. Honest scope: some of these checks are size-limit-able (a raw byte
ceiling is just a budget), and glyphhanger/subfont already cover the
*extraction* half of glyph coverage. The genuinely bespoke part is the
**semantic cross-reference** (preload ↔ `@font-face` href match) and the
**scoped-coverage assertion against a shared config** — no off-the-shelf tool
does "rendered copy ⊆ this subset, scoped to text ranges". See the `web-perf`
skill's `verify.md` (Tier 0 for the checker shape, section 5 for the LHCI /
unlighthouse measurement-tool gotchas) for why each invariant matters.

## Testing

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
