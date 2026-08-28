# Mechanical Enforcement - TypeScript / JS

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
- [Framework single-file components (.astro / .vue / .svelte)](#framework-single-file-components-astro--vue--svelte)
- [UI hygiene (React / Next)](#ui-hygiene-react--next)
- [Import hygiene](#import-hygiene)
- [Complexity and duplication](#complexity-and-duplication)
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
| Only erasable TS syntax | `"erasableSyntaxOnly": true` (TS 5.8+) | `enum`, `namespace`, constructor param props - things that don't survive pure type-stripping | Enables deno/bun/swc/esbuild interop without a TS runtime. Breaks existing code using `enum`; migrate to `as const` unions. |
| No `any` | oxlint `typescript/no-explicit-any` (native, needs `"plugins": ["typescript"]`) or Biome `noExplicitAny` (error) | Escape hatch from the type system | Use `unknown` + narrowing. |
| No `as Type` assertions | ESLint `@typescript-eslint/consistent-type-assertions` with `assertionStyle: "never"` | Silent lies to the compiler | Allowed exceptions (document each with `eslint-disable-next-line` + reason): `as const`, DOM APIs after null checks, untyped-library interop, intentionally-invalid test fixtures. |
| No `!` non-null assertion | oxlint `typescript/no-non-null-assertion` (native) or ESLint `@typescript-eslint/no-non-null-assertion` | Silent runtime crashes | Use a proper null check or throw a narrowed error. |
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

- **Library builds stay on `tsc`.** tsgo declaration (`.d.ts`) emit still has gaps (declaration maps, `--build` / project-reference orchestration) - do not generate published artefacts with it yet.
- **The lint stack stays on TS 6.** The programmatic API (Strada) lands in 7.1, so typescript-eslint / ts-morph / custom transformers can't ride tsgo until then. Install side-by-side via `typescript@npm:@typescript/typescript6` if a tool needs the old API.
- **A browser/Workers app plus Node build scripts are two tsconfig programs, not one.** Don't widen the app's strict `include` to pull the Node scripts in - it leaks `process` / `node:*` globals into app code that has no runtime access to them. Scope the app `include` to app source + tests, and give Node tooling (`scripts/`) its own tsconfig with the Node lib/types; or leave the `.ts` scripts to the linter + execution (Node 24 type-strips them at runtime, so they never need the app program's typecheck).

## Error handling

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No bare `catch` / swallowed errors | Biome `noCatchAssign`, `useErrorMessage`; ESLint `no-empty` with `allowEmptyCatch: false` | Errors disappearing into the void | Narrow in the catch (`catch (e) { if (e instanceof FooError) ... }`) or rethrow. |
| No catch-all re-throw without cause | Custom `no-restricted-syntax` catching rethrows without `{ cause }` | Losing error context | Required pattern: `throw new Error("while doing X", { cause: e })`. |
| Prefer Result types at domain boundaries | Convention + review; no linter | Exception-driven control flow in pure code | Exceptions live at the imperative shell only. |
| No `console.*` in prod code | oxlint `no-console` (native, bans all levels) or Biome `noConsole` with `allow: ["warn", "error"]` | Logs leaking to user consoles | Use the project's logger. |

## Formatting (oxfmt, with Biome as the stable fallback)

The recommended default for new projects is the all-oxc stack: oxlint for
linting (it already owns the boundary rules in `references/architecture-boundaries.md`) plus **oxfmt** for
formatting, selected together via Ultracite's provider flag -
`ultracite init --linter oxlint` generates both `oxlint.config.ts` and
`oxfmt.config.ts` (one flag picks the whole toolchain; there is no separate
formatter flag). With oxlint doing the linting, Biome's role in this stack is
format-only - no integrated lint+format advantage - so the faster formatter
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
| Ban modules / globals by exact specifier | `noRestrictedImports`, `noRestrictedGlobals` | stable | simple ESLint `no-restricted-imports` / `no-restricted-globals` - plain strings only, no glob `patterns`, so path-family bans stay in ESLint |
| Package privacy via JSDoc visibility | `noPrivateImports` (`@package` / `@private` tags) | stable | the eslint-plugin-import `no-internal-modules` niche |
| Custom project-local AST rules | GritQL plugins (`.grit` via `linter.plugins`) | stable (code fixes in 2.5) | many `no-restricted-syntax` rules and some greppable invariants |
| Floating / misused promises | `noFloatingPromises`, `noMisusedPromises` (`types` domain) | nursery → advisory | a typescript-eslint class nothing else here catches |
| Import cycles | `noImportCycles` (`project` domain) | stable but scanner-heavy | overlaps madge - madge stays primary on perf (see Import hygiene) |

Genuine ESLint hold-outs - keep ESLint for these:

- **Import-type-aware boundary rules.** `noRestrictedImports` still can't allow `import type X` while banning the value import, so layer rules that must stay type-visible (`allowTypeImports`) need typescript-eslint.
- **Member-expression bans.** Biome has no `no-restricted-properties` equivalent, and oxlint (as of 1.74) doesn't ship `no-restricted-syntax` natively - the config fails to parse (`Rule 'no-restricted-syntax' not found in plugin 'eslint'`); it needs the alpha `oxlint-plugin-eslint` JS plugin. So `Date.now` / `Math.random` / `process.env` purity bans stay in ESLint, or ride a greppable grep-then-`exit 1` hk step (the zero-dependency route - see Greppable invariants / Purity in `references/architecture-boundaries.md`). Note `no-restricted-imports` *is* native in oxlint; only the syntax/member-expression variant is not.
- **Mature framework / a11y plugins.** `jsx-a11y`, `eslint-plugin-react-hooks` edge cases, and `next/core-web-vitals` remain broader than Biome's ported domains.

GritQL plugins can't be shared across repos (by design), so a reusable
cross-repo invariant pack still lives in a shared ESLint config or the
greppable-invariants tier. Enabling the `types` / `project` domains turns on
Biome's project scanner - real perf cost, so treat those rules as advisory, not
a blocking gate.

## Framework single-file components (.astro / .vue / .svelte)

The Rust JS linters don't parse framework SFCs. Point oxlint at a `.astro` file
and it reads the frontmatter but misreads the template - an Astro expression like
`{cond && <script />}` trips `no-unused-expressions` as a false positive, because
oxlint is parsing template JSX as if it were plain JS. Biome has the same blind
spot. So:

- **Scope the JS linter to `*.ts` / `*.js` / `*.mjs`** and exclude the SFC
  extension from that step. The glob is the fix - see `hk` (glob each step to
  what the tool actually handles).
- **Let the framework's own checker own the SFC**: `astro check` (uses the Astro
  language server + `tsc` under the hood), `vue-tsc`, `svelte-check`. This is the
  type-check + template-diagnostic gate for the file the JS linter can't read.
- **To lint *inside* the SFC's `<script>` blocks**, add the framework's ESLint
  parser (`astro-eslint-parser` + `eslint-plugin-astro`; `eslint-plugin-vue`;
  `eslint-plugin-svelte`) - oxlint / Biome can't stand in for it. Reach for this
  only when you need lint rules on the script logic beyond what the framework
  checker gives.

## UI hygiene (React / Next)

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No raw `<input>` / `<button>` / `<a>` outside the component library | `no-restricted-syntax` on `JSXOpeningElement[name.name='input']` (etc.) in app/feature code | Drift from the design system | Exempt the UI library path (`src/components/ui/**`). Error message points at the wrapper component. |
| `jsx-a11y/recommended` on | ESLint `plugin:jsx-a11y/recommended` via flat config | Accessibility regressions | Turn off `no-noninteractive-tabindex` - the axe-mandated `scrollable-region-focusable` pattern conflicts. |
| No inline styles | Biome `noInlineStyles` (or ESLint `react/forbid-dom-props`) | Design-system bypass | Allow `style` on one or two charting components with a disable comment. |
| `useTopLevelRegex` (Biome) | default in Ultracite | Regex recompiled on every call; inline regex in test assertions | Prefer `.toThrow("Cannot submit:")` over `.toThrow(/Cannot submit:/)`. |

`jsx-a11y` is static-only. Its deliberate runtime complement - colour contrast,
computed ARIA, DOM/focus structure, which no static rule can see - is the
axe/pa11y gate in `references/web-delivery.md`. Run both.

## Import hygiene

| Rule | Encode with | Prevents |
|---|---|---|
| Sorted + grouped imports | Biome `organizeImports` on format | Merge conflicts; inconsistency |
| No cycles | oxlint `import/no-cycle` (Rust, multi-file - retires madge) or [madge](https://github.com/pahen/madge) (`madge --circular`); Biome `noImportCycles` is stable but scanner-heavy | Module init-order bugs |
| No default exports (optional) | Biome `noDefaultExport` / ESLint `import/no-default-export` | Inconsistent naming at import sites; poor rename refactoring. Exempt Next.js pages/layouts where defaults are required. |
| Unique function names | `no-restricted-syntax` on duplicate `FunctionDeclaration` identifiers across a file; fallback is a grep-based hk step | Duplicate helpers being written instead of discovered. Grep check catches the cross-file case ESLint can't. |

## Complexity and duplication

The cross-stack argument, the numbers, and what is report-only live in
`references/complexity.md`. This is the wiring.

**No ESLint layer is needed for these.** All seven ESLint metric rules are
native Rust in oxlint, including `complexity`'s `variant: "modified"`. Cognitive
complexity and duplicate-function detection are the only gaps, and oxlint's
`jsPlugins` bridge (alpha) runs the real `eslint-plugin-sonarjs` to close them.

**Every rule below is off until you name it.** They sit in oxlint's `pedantic` /
`style` / `restriction` categories, so `-D warnings` does not reach them.
Verified on oxlint 1.77.0: a 5-deep, 5-parameter function produces **no
diagnostics at all** on a bare run, and fires the moment the rules are named.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Branch count | oxlint `complexity: ["error", { max: 15, variant: "modified" }]` | Functions with more paths than a test suite covers | Default 20 and `classic`. **Set `variant: "modified"`** or the rule punishes the exhaustive discriminated-union `switch` you want: verified that a 5-case switch plus one `if` scores 7 classic and 3 modified. |
| Nesting depth | oxlint `max-depth: ["error", { max: 4 }]` | Arrow code, which a branch count misses because breadth and depth score alike | 4 is both the oxlint default and the cross-stack number. Keep exactly one nesting gate. |
| File size | oxlint `max-lines: ["error", { max: 300, skipBlankLines: true, skipComments: true }]` | Files that accrete several reasons to change | Both skip flags default to false. Exclude generated clients, barrels, i18n catalogues and `as const` tables **by glob** - that class is stable. |
| Function size | oxlint `max-lines-per-function: ["error", { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true }]` | Functions no reviewer reads end to end | Without `IIFEs: true`, module-level setup IIFEs escape the rule entirely. |
| Statement count | `max-statements: "off"` | Nothing `max-lines-per-function` does not already | A strict subset of function length, and its default of 10 is punitive. Two gates arguing about one concern. |
| Parameter count | oxlint `max-params: ["error", { max: 4 }]` | Call sites where two same-typed positionals swap silently | 4 rather than the oxlint/ESLint default of 3, which fires on ordinary render props and curried helpers; 4 also matches Biome's `useMaxParams` so the two routes agree. The real fix for swappable args is branded types - see the `typescript` skill. |
| Callback pyramids | oxlint `max-nested-callbacks: ["error", { max: 3 }]` | Control flow that `async`/`await` would flatten | The default 10 never fires in modern async code, so enabling it at the default buys nothing. Disable in test globs - `describe` / `it` / `beforeEach` is the whole false-positive class. |
| Anonymous call nesting | oxlint `unicorn/max-nested-calls: ["error", { max: 3 }]` | `a(b(c(d(x))))` - no named intermediates and no readable stack position | The unicorn plugin is on by default in oxlint, but this rule is off in Ultracite's core; turn it back on. |
| One class per file | oxlint `max-classes-per-file: "error"` | A module name that stops describing its contents | Free in a functional-core codebase. Error hierarchies are the standard exception. |
| Cognitive complexity | `sonarjs/cognitive-complexity: ["error", 15]` via oxlint `jsPlugins` | Code that is hard to *read* rather than hard to *cover*, because nesting is weighted | 15 is sonarjs's own default. Run this **instead of** tightening `complexity`, not alongside it. |
| Duplicate function bodies | `sonarjs/no-identical-functions: ["error", 3]` | The agent failure mode: a second copy written instead of the first being found | The threshold counts **lines**, not tokens, and the schema refuses values below 3 - so two byte-identical one-line helpers never fire. |
| Repeated string literals | `sonarjs/no-duplicate-string: ["error", { threshold: 3 }]` | A magic string typo'd in one of its five call sites | Turn it off in tests: repeated literals in test titles are idiomatic, which is why the rule is absent from sonarjs's own recommended set. Extend `ignoreStrings` rather than dropping it. |
| Compound conditions | `sonarjs/expression-complexity: ["error", { max: 3 }]` | Four or more `&&` / `\|\|` / `?:` in one expression, where precedence errors hide | The sub-statement gap: `complexity` counts branches, this counts operators inside a single expression. Treat a hit as a prompt to name the predicate. |

**oxlint aborts the entire run on an unknown rule name.** One bad entry rejects
the whole config (`Failed to parse oxlint configuration file`), exits 1, and
lints nothing. It fails closed, so a hook still blocks - but any wrapper that
treats "no diagnostics" as success turns it into a silent hole, and a rule
renamed between minors takes the gate down on upgrade. `unicorn/try-complexity`
is the live trap: it exists only in `eslint-plugin-unicorn` and oxlint rejects
it outright (verified on 1.77.0). Assert the step actually emitted diagnostics
on a known-bad fixture, not merely that it exited non-zero.

**`jsPlugins` caveats.** Alpha, no type-aware rules, and no custom parsers - so
no `.vue` / `.svelte` / `.astro`, matching the SFC guidance above. It costs
roughly a flat per-invocation Node-startup tax rather than something that scales
with file count, so it fits pre-commit but not a per-keystroke tier. Ultracite's
`js-plugins` preset declares several plugin packages; re-exporting its array
while installing only sonarjs leaves the rest unresolvable and hard-fails the
config, so install them all or hand-write the single entry.

**Ultracite's preset is not a complexity gate.** Ultracite 7.10.7 sets
`complexity` at oxlint's bare default (20, `classic`), `max-classes-per-file`,
and `max-nested-callbacks` at the default 10 that async code never reaches - and
switches `max-depth`, `max-lines`, `max-lines-per-function`, `max-params` and
`max-statements` **off**. Its two halves also disagree with each other: the
sonarjs cognitive-complexity limit is set to 20 against Biome's own default of
15. Take the preset for formatting and correctness, then set these rules
yourself.

**The Biome route has three holes**, if the repo is on Biome rather than oxlint:
no cyclomatic rule, no `max-depth`, and no `max-statements` - verified absent
from the full rule list at 2.5.11, so only oxlint or ESLint can supply them.
What Biome does have is a native port of the same S3776 cognitive metric.
Watch three traps:

- **All seven of its cap rules default below `error`** - five at `information`,
  `useMaxParams` and `noExcessiveNestedCallbacks` at `warning` - and Biome exits
  non-zero only on error-level diagnostics. A rule enabled without an explicit
  `"level": "error"` is a report, not a gate.
- **`noExcessiveLinesPerFunction` counts the body only and has no
  `skipComments`**, so an ESLint or oxlint threshold does not port across
  unchanged. Its `skipIifes` also inverts ESLint's `IIFEs` flag.
- **Group membership is not where you would guess**: `noExcessiveLinesPerFile`
  and `noExcessiveClassesPerFile` are `style`, not `complexity`, and
  `noExcessiveNestedCallbacks` is still `nursery`, so its config path will move
  on promotion. `noExcessiveNestedTestSuites` has no options at all - the depth
  of 5 is hard-coded.

**Order dead-code before size.** knip has no size dimension and the size rules
have no reachability analysis, so a `max-lines` hit on a file that is 40%
unreachable exports produces a split-the-file suggestion where the correct
action is delete-the-exports. On a large repo, put knip at pre-push/CI and the
size gate at pre-commit, and accept that the pre-commit number is measured
against a slightly stale definition of live code.

## Dead code (knip)

The TypeScript analogue of Vulture. `tsc`'s `noUnusedLocals` and madge only see
inside a file or the cycle graph; they never flag an unused *export*, an
orphaned file, or an unused / unlisted dependency. knip does - one tool for
unused files, exports, exported types, enum/class members, and unused
`dependencies` / `devDependencies`. `ts-prune` and `depcheck` are both archived;
knip is the successor. See `references/knip.jsonc`.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Whole-project graph | knip from the repo root (it builds the full import graph) | Orphaned files and dead exports drifting in | 150+ framework plugins teach it implicit entry points (next, vitest, storybook). |
| Gate in production mode | `knip --production` in CI | Test-only utilities being flagged as dead | Default (dev) mode is fine locally; `--production` drops test files for the gate. |
| Adopt before blocking | report-only first, then gate on exit code | A noisy first run blocking every commit | Tune `knip.json` for dynamic / implicit entries, then flip to blocking. |

A faster Rust alternative, **fallow**, covers the same dead-code graph plus
cycles - keep knip as the reference; fallow's boundary limits and open-core
risk are covered under Transitive architecture tests in
`references/architecture-boundaries.md`.

## Library publishing (publint + attw)

For published packages, nothing in the lint / typecheck stack validates the
*shipped* shape. Two complementary, production tools close that gap - both gate
on a non-zero exit:

| Tool | Checks | Notes |
|---|---|---|
| publint | `package.json` `exports` / `main` / `module` / `types` resolve to real files; ESM/CJS format and condition order | Pure static, fast. Lints the packed tarball, so it only sees what ships. |
| `@arethetypeswrong/cli` (attw) | the shipped `.d.ts` resolve for consumers across node10 / node16-CJS / node16-ESM / bundler modes | Pick a `--profile` (e.g. node16, esm-only) so you don't fail on modes you don't support. Use `--pack`. |

These run **after the build**, against the built `dist` + generated `.d.ts`, so
they belong in a CI / pre-publish gate (pre-push or the release workflow), not
pre-commit. There is no Rust equivalent - attw drives `tsc` itself and publint
is already fast pure-JS, so the usual Rust-first preference doesn't apply. If the
library builds with tsdown (Rust/Rolldown), it can run both inline
(`tsdown --dts --publint --attw`). Pin both under the release-age quarantine -
they ship pre-1.0 and move fast. For monorepos, **sherif** (Rust) additionally
enforces dependency-version consistency across workspaces.

## Asserting on shipped artifacts

publint/attw above validate a published package's shape; the same "gate the
built output, not the source" discipline applies to any site's first-load
surface. Three tiers, cheapest-to-verify first:

| Layer | Off-the-shelf? | Gate with |
|---|---|---|
| Byte / time budgets | yes | **size-limit** (`@size-limit/file` for raw bytes, `preset-app` for time-to-run); non-zero exit in CI. `size-limit-action` (andresz1) wraps it for PR comments - a *community* action, not first-party. |
| Runtime metrics (LCP / CLS / perf score) | yes | **Lighthouse CI** (`budget.json` or per-URL assertions) + **unlighthouse** (site-wide crawl). Both need a served preview + Chrome; sample multiple runs - perf assertions flake. |
| Semantic first-load HTML invariants | no - bespoke | a Node checker that reads `dist/*.html` and exits non-zero |

The perf/byte tiers here have accessibility, SEO, social-metadata, and
broken-link siblings that gate the same built output - see
`references/web-delivery.md`.

**Don't reach for** bundlesize (unmaintained - last release 0.18.x, 2024) or
statoscope (webpack/rspack `stats.json` only - no Astro/Vite fit). Treat the
version literals here as illustrative; confirm against the live registry.

The third tier is the interesting one: it is the **typed generalisation of the
greppable-invariants tier** (`references/architecture-boundaries.md`) and a sibling to publint/attw's post-build
gate. Where grep asserts "this string does not appear", a first-load checker
asserts structural facts about the shipped HTML - font-preload count within
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
**scoped-coverage assertion against a shared config** - no off-the-shelf tool
does "rendered copy ⊆ this subset, scoped to text ranges". See the `web-perf`
skill's `verify.md` (Tier 0 for the checker shape, section 5 for the LHCI /
unlighthouse measurement-tool gotchas) for why each invariant matters.

## Testing

Enable Biome's `test` domain - it covers the generic rules natively
(`noFocusedTests`, `noSkippedTests`, `noDuplicateTestHooks`, `noExportsInTest`,
`noExcessiveNestedTestSuites`; nursery: `noConditionalExpect`, `useExpect`).
Framework-specific rules stay in ESLint; the vitest plugin is
`@vitest/eslint-plugin` (`eslint-plugin-vitest` is its pre-ESLint-9 name).

| Rule | Encode with | Prevents |
|---|---|---|
| No `.only` / `.skip` committed | Biome `noFocusedTests` (Ultracite default) + `noSkippedTests`; or `@vitest/eslint-plugin` `no-focused-tests` | Accidentally skipping the rest of the suite in CI |
| Assertion-free tests | Biome `useExpect` (nursery) or `@vitest/eslint-plugin` `expect-expect` | Tests that run code but assert nothing - the mechanical half of the testing skill's Assertion Quality note |
| No inline regex in assertions | Biome `useTopLevelRegex` | Flaky matches and poor error messages |
| Coverage threshold enforced pre-commit | hk step running `vitest run --coverage` + vitest config `thresholds: { 100: true }` | Untested branches slipping in. Use `/* v8 ignore next */` for unreachable defensive code. |
| No mocks in unit tests | Convention + review | Tests that pass but mask integration bugs |
| Flaky Playwright waits | eslint-plugin-playwright `no-wait-for-timeout`, `missing-playwright-await` | Timeout sleeps and unawaited async assertions - the two commonest flaky-e2e causes. Biome has no Playwright rules. |
