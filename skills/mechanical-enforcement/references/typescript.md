# Mechanical Enforcement - TypeScript

Per-stack rules for TypeScript and JavaScript: the tsconfig strictness contract,
the type-check gate, lint families and suppression discipline, formatting, UI
and import hygiene, dead code, and the fail-open inventory that says which of
those gates is actually armed. Routed from the picks table and rules-catalogue
index in `SKILL.md`.

Three siblings carry the rest of the stack, one owner per fact:
`references/typescript-testing.md` (vitest, test lints, runtime backstops, bun
test), `references/typescript-publishing.md` (dependencies, lockfile, licences,
build and publish gates), `references/typescript-security.md` (security rules,
prototype pollution, ReDoS, sinks). Boundary rules live in
`references/architecture-boundaries.md`; idiom belongs to the `typescript`
skill, test strategy to `testing`, coverage to `test-coverage`, dependency
audits to `supply-chain-hardening`.

## Contents

- [Picks](#picks)
- [Type safety](#type-safety)
- [Type checking](#type-checking)
- [Lint families and suppressions](#lint-families-and-suppressions)
- [Formatting](#formatting)
- [Framework single-file components](#framework-single-file-components)
- [UI hygiene](#ui-hygiene)
- [Import hygiene](#import-hygiene)
- [Complexity](#complexity)
- [Dead code (knip)](#dead-code-knip)
- [Gate integrity](#gate-integrity)
- [Maintenance posture](#maintenance-posture)

## Picks

One owner per job. Raw oxlint plus oxfmt with a skill-owned config is the
default lint and format stack; `tsc` is the type contract; oxlint type-aware
(tsgolint) is the type-aware lint gate; vitest is the runner; knip owns dead
code and unused dependencies; a ts-morph test in vitest owns transitive
boundaries.

| Concern | Pick | Why |
|---|---|---|
| Formatter | oxfmt with `.oxfmtrc.json` | Prettier-conformant, formats JS/TS, JSON and YAML in one pass. See [Formatting](#formatting). |
| Linter | raw oxlint with `.oxlintrc.json` | Native Rust, runs on any TypeScript, owns the boundary and purity rules. Ultracite is an optional React/Next starting point, not the default. |
| Type check | `./node_modules/.bin/tsc -p tsconfig.json` (TS 7) | The one whole-program gate. See [Type checking](#type-checking). |
| Type-aware lint | oxlint `options.typeAware: true` + `oxlint-tsgolint` | The only route to floating promises, exhaustive switch and the `no-unsafe-*` family on TS 7. |
| ESLint | optional, behind a TS 6 side-by-side alias | typescript-eslint refuses TS 7 outright. Reach for it only for `eslint-plugin-regexp`, `naming-convention` and framework plugins. |
| Boundaries | ts-morph test + oxlint `import/*` + knip cycles | dependency-cruiser cannot parse TS 7. See `references/architecture-boundaries.md`, Transitive architecture tests. |
| Runner | vitest, with bun test scoped to bun-runtime zero-dependency projects | See `references/typescript-testing.md`, bun test. |

Reach past the first tool named only when it cannot express the rule. The hook
tiers a TypeScript repo wires these into, per the `hk` skill:

```text
tier 1 (format/fix)      → trailing-whitespace, newlines, typos, rumdl (Markdown), oxfmt --write
tier 2 (lint/gate)       → oxlint -c .oxlintrc.json --deny-warnings src tests, ast-grep scan, gitleaks,
                           yamllint, check-merge-conflict, zizmor --offline + actionlint (hk builtin)
tier 3 (typecheck)       → ./node_modules/.bin/tsc -p tsconfig.json (whole-project, never staged paths)
tier 4 (test/dead code)  → vitest run, the ts-morph architecture test, knip --production --strict
CI / pre-push            → knip --treat-config-hints-as-errors (dev mode), publint, attw, clean-dir smoke,
                           opengrep --error, pnpm install --frozen-lockfile
commit-msg               → commitlint
```

Drop-ins, each verified on the fixture and each opening with a comment block
naming what it gates and how to wire it: `references/typescript-strict-app.jsonc`,
`references/typescript-strict-lib.jsonc`, `references/typescript-oxlintrc.jsonc`,
`references/typescript-oxfmtrc.jsonc`, `references/typescript-ast-grep.yml`,
`references/typescript-vitest.config.ts`, `references/typescript-vitest-setup.ts`,
`references/typescript-arch-test.ts`, `references/dependency-cruiser.cjs`,
`references/knip.jsonc`, `references/typescript-publish-gates.sh`,
`references/eslint-boundaries.mjs`, `references/purity-boundaries.mjs`,
`references/biome-ultracite.jsonc`, `references/hk-steps.pkl`.

## Type safety

Two profiles, two files: `typescript-strict-app.jsonc` for an app (DOM lib,
bundler resolution) and `typescript-strict-lib.jsonc` for a published library or
Node package. Neither is a superset of the other, so copying the app config into
a library inherits DOM globals it cannot use and a resolution mode wrong for a
consumer.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Full strict mode | `"strict": true` | Most null/undefined footguns | Non-negotiable. Default on the TS 7 CLI, explicit in the config so a reader sees it. |
| Indexed access returns `T \| undefined` | `"noUncheckedIndexedAccess": true` | `arr[0].foo` crashing on an empty array | |
| Exact optional properties | `"exactOptionalPropertyTypes": true` | Conflating `x?: T` with `x: T \| undefined`, so `undefined` is written into a merely-optional field | Add `\| undefined` to optionals that are genuinely nullable. |
| Index-signature keys need brackets | `"noPropertyAccessFromIndexSignature": true` | A typo'd dynamic key (`cfg.hostnam`) typed silently instead of flagged | Collides with Biome `useLiteralKeys` - see [Lint families](#lint-families-and-suppressions). |
| Dead locals fail the build | `"noUnusedLocals"`, `"noUnusedParameters"` | Drifted imports and zombie variables | Prefix with `_` to keep an unused parameter deliberately. |
| No unreachable statements | `"allowUnreachableCode": false` | A statement after a call to a `never`-returning helper, which no syntactic rule sees | The default is `undefined`, an editor grey-out that never fails a build. oxlint `no-unreachable` catches the plain cases; this catches the type-aware ones. |
| No unused labels | `"allowUnusedLabels": false` | A label left behind by a deleted loop | Same default trap as above. |
| Every path returns | `"noImplicitReturns": true` | A `T \| undefined` lookup falling off the end, which `strict` cannot flag because `undefined` is in the annotation | Gates unannotated helpers and arrow callbacks that no explicit return type reaches. |
| No accidental switch fallthrough | `"noFallthroughCasesInSwitch": true` | A case body that runs into the next one | Verified 2026-09-03 against tsc 7.0.2: `// falls through` does **not** suppress TS7029, and a declaration-only case body counts as non-empty, so shared-setup-then-fall-through is banned too. |
| `override` is written, not inferred | `"noImplicitOverride": true` | A subclass method silently ceasing to override anything after a base rename | Adds TS4114. Abstract members and `implements` relationships are exempt by design, so an `abstract class Handler` hierarchy is not covered. |
| Type-only imports are explicit | `"verbatimModuleSyntax": true` | A re-export of a type keeping a runtime edge alive | `isolatedModules` does not cover `import { T } from "./t"; export { T }`. Hard-fails every CommonJS `nodenext` file (TS1295/TS1287), so it is an ESM demand, not a tightening. |
| Only erasable syntax | `"erasableSyntaxOnly": true` | `enum`, `const enum`, `namespace`, parameter properties, `import =`, `export =` and `<T>x` casts, none of which survive type stripping | Whole-program, not path-scopable: an `include` narrowing does not confine it, because an outward import pulls the other file in. `.d.ts` files are exempt. |
| Declarations are inferable per file | `"isolatedDeclarations": true` (library only) | A public API whose types only one whole-program compiler can compute, blocking fast `.d.ts` emit | Needs `declaration` or `composite` or it exits 1 with TS5069 and checks nothing else. Verified 2026-09-03 on tsc 7.0.2: `incremental: true` silently drops every TS9013 while unrelated errors still report. |
| Missing side-effect imports fail | default since TS 6.0 | `import "./deleted.css"` resolving to nothing | Do not write the key: it is on. `declare module "*.css"` buys the silence back for the whole asset class. |
| One era of syntax and lib | `"target": "es2025"`, `"lib": ["es2025", "esnext.disposable"]` | `using` declarations typed out of existence, or `esnext` typing Temporal into existence before a runtime ships it | `es2025` under-declares node 24 for `DisposableStack`; bare `esnext` over-declares. |
| Ambient globals are declared | `"types": ["node"]` | Every `process` and `node:*` reference failing as TS2591 | `types` defaults to `[]` from TS 6.0, and `typeRoots` does not substitute. Verified 2026-09-03 on tsc 7.0.2 with @types/node 26.4.0: without the key, `process.env["X"]` is TS2591 and exit 1. |
| The program is scoped | an explicit `"include"` | Build output and Node tooling being typechecked as app code | Without it the program is `**/*`, which pulls `dist/` and `scripts/` in and leaks `process` into browser code. Give `scripts/` its own tsconfig. |

- **`skipLibCheck` skips first-party `.d.ts` too.** Verified 2026-09-03 on tsc 7.0.2: a hand-written `bad.d.ts` naming an unresolvable type exits 0 with `skipLibCheck: true` and reports TS2304 with it off. Keep it on for the app gate, because turning it off pulls every reachable dependency `.d.ts` into the program and there is no path form of the flag; turn it off only for the release check against generated declarations.
- The cast, `any` and non-null discipline is lint, not tsconfig: oxlint `typescript/consistent-type-assertions` at `assertionStyle: "never"`, `typescript/no-explicit-any`, `typescript/no-non-null-assertion`. The idiom behind them is the `typescript` skill's.
- Record shapes: `interface` for object shapes, `type` for unions. `typescript/consistent-type-definitions: ["error", "interface"]` encodes it.

## Type checking

`./node_modules/.bin/tsc -p tsconfig.json` is the gate, invoked by explicit
path. `pnpm exec tsc` and a bare `tsc` npm script fall through to any global
compiler on `PATH`, so a missing or mis-aliased local one is invisible: on a
machine with mise-installed TypeScript the project pins one major and the gate
checks with another, exit 0 either way (verified 2026-09-03).

**Never branch on exit 1 versus 2.** TS 7 reverses the mapping TS 6 used. Held
constant on one violation, verified 2026-09-03:

| Condition | tsc 7.0.2 | tsc6 6.0.3 |
|---|---|---|
| Type error under `noEmit` | 1 | 2 |
| Unknown compiler option (TS5023), typo'd tsconfig key, missing `-p` path (TS5058) | 1 | 1 |
| Diagnostics with output files written | 2 | - |
| Same, plus `--noEmitOnError` | 1 | - |

On TS 7 the code is a function of the emit configuration, not the diagnostic
class: a config error and a type error share exit 1, and exit 2 means "errors
reported and files written anyway". Test for non-zero.

- **`tsc <file>.ts` is refused below a tsconfig.** TS5112, exit 1, nothing checked. Any per-file triage script needs `--ignoreConfig`, which then discards every flag the config sets, so it typechecks under CLI defaults rather than the project's contract. This is a false-green hazard in the other direction too: TS5112 exits 1, so a script reading only the status reads a config error as a caught violation.
- **A bare `tsc` walks up the tree** and adopts an ancestor tsconfig, silently checking a different file set from the one in the working directory. Always pass `-p`.
- **`--showConfig` is not a gate.** Verified 2026-09-03 on tsc 7.0.2: it exits 0 on removed options, unknown options and malformed JSON, echoing illegal values back unflagged. It is a diff aid for `extends` chains, paired with a real run.
- **Removed options hard-error.** `target: ES5` and `module: amd|system|umd` give TS5108; `baseUrl`, `outFile` and friends give TS5102. `baseUrl` is a two-edit migration: deleting it turns every non-relative `paths` target into TS5090, so each value needs a leading `./`. The `--opt=value` CLI form is rejected as TS5023; use `--opt value`.
- **`extends` replaces arrays and rebases `include`.** `types`, `lib`, `include` and `exclude` are replaced wholesale, with no union form (`[]` and `null` both drop the base value), and an inherited `include` resolves against the *base* config's directory. Verified 2026-09-03: a child extending `ext/base.json` reports `include: ["ext/../flags/env.ts"]`. A top-level key with a dropped letter in `include` draws no diagnostic at all, so the program silently widens; only keys inside `compilerOptions` are validated.
- **`tsc --noCheck` and `"noCheck": true` suppress unresolved imports (TS2307) and erasableSyntaxOnly grammar errors (TS1294) as well as type errors.** A deleted module passes. The tsconfig key carries no `tsc` token, so a command-string grep cannot see it; `tsc -p <cfg> --showConfig | grep -qi '"noCheck": true'` can.

**TS 7 ships no stable JS API.** Verified 2026-09-03: `import ts from
"typescript"` at 7.0.2 yields `{ version, versionMajorMinor }` and
`createProgram` is `undefined`; the API lives behind `typescript/unstable/*`.
Every tool that drives the old API is therefore either dead or running against a
compiler it bundles itself - ts-morph 28 and api-extractor both vendor an older
TypeScript, so they "work" silently against a different checker from the gate.

**typescript-eslint refuses TS 7.** Verified 2026-09-03 with eslint 10.9.1 and
typescript-eslint 8.68.0 against typescript 7.0.2: `typescript-eslint does not
support TS 7.0.`, exit 2, nothing linted. Support tracks TS 7.1. The documented
escape is Microsoft's side-by-side Option 2, and it needs both halves:

```sh
pnpm add -D "typescript@npm:@typescript/typescript6@6.0.2"   # bin: tsc6
pnpm add -D "typescript7@npm:typescript@7.0.2"               # restores .bin/tsc
```

Option 1 (aliasing `typescript` alone) is the trap: verified 2026-09-03, it
deletes `node_modules/.bin/tsc`, so `./node_modules/.bin/tsc` exits 127 while
`pnpm exec tsc` resolves a global TS 7 and reports as if the gate ran. The
second alias is what keeps the typecheck script honest.

Type-aware lint rules run through oxlint instead, with no TypeScript dependency
at all - tsgolint embeds its own typescript-go, so its semantics can diverge
from the repo's `tsc`. See [Lint families](#lint-families-and-suppressions).

There is **no tsc baseline**, so turning on `noUncheckedIndexedAccess` or
`exactOptionalPropertyTypes` on a legacy tree has no ratchet vehicle;
tsc-baseline, typescript-strict-plugin and betterer are all weak. See
`references/ratcheting.md`.

## Lint families and suppressions

**oxlint's default run is a report, not a gate.** Verified 2026-09-03 against
oxlint 1.80.0: the default `correctness` category is applied at *warn*, so a
file with a real `no-debugger` hit prints the diagnostic and exits 0. Only
`--deny-warnings` (or a per-rule `"error"`) sets the status. oxlint prints no
"found N problems" footer, so a clean run and a swallowed run are byte-identical.

Category sizes on 1.80.0, measured as the delta over the 111 default correctness
rules: suspicious 39, pedantic 108, perf 7, style 128, restriction 62, nursery 7.
None of the idiom rules below sits in `correctness`, so each has to be named.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Type-aware rules actually run | `"options": { "typeAware": true }` + `oxlint-tsgolint` dev dependency | Every type-aware rule configured at `"error"` silently doing nothing | Verified 2026-09-03: the same config without the key exits 0 on a floating promise. The config key beats `--type-aware` because it holds for the editor and any wrapper that drops argv. |
| Suppressions name their rules | `unicorn/no-abusive-eslint-disable` (restriction) | A bare `/* eslint-disable */` that also hides every rule added later | The ruff PGH004 twin. Defeated by suppressing itself - see below. |
| `@ts-` directives are disciplined | `typescript/ban-ts-comment` (pedantic) | `@ts-ignore` and description-less `@ts-expect-error` | Options: `ts-expect-error: "allow-with-description"`, `minimumDescriptionLength`, `ts-ignore`, `ts-nocheck`. No `descriptionFormat`, so it cannot demand a rule code the way PGH003 does. `.js` files escape the rule entirely. |
| Stale suppressions expire | `--report-unused-disable-directives-severity=error` | A disable comment left over the code it once covered | The RUF100 twin. Verified 2026-09-03: reports both `oxlint-disable` and `eslint-disable` spellings; root config only, rejected inside `overrides`. |
| No casts | `typescript/consistent-type-assertions: ["error", { "assertionStyle": "never" }]` | Silent lies to the compiler | Native, no ESLint needed. A chained `1 as unknown as string` emits two diagnostics at the identical column. Smart constructors need one disable each. |
| No `console` in production code | `no-console: ["error", { "allow": ["warn", "error"] }]` | Logs leaking to a user console | Syntactic: `const c = console; c.log()` and `globalThis.console.log()` both escape it. An unknown method name in `allow` is accepted and echoed back, so the exemption is inert while the gate stays maximal. |
| Object shapes are interfaces | `typescript/consistent-type-definitions: ["error", "interface"]` | Two spellings of one record shape drifting apart | Unions stay `type`. |
| Exhaustive switches | `typescript/switch-exhaustiveness-check` (type-aware, pedantic) | A union arm added without a matching case | Leave `considerDefaultExhaustiveForUnions` false (its default) - true weakens it. Leave `allowDefaultCaseForExhaustiveSwitch` true, or the rule flags the `default: return assertNever(x)` arm the `typescript` skill prescribes. |
| Promises are handled | `typescript/no-floating-promises`, `no-misused-promises` (type-aware) | A dropped rejection and a `void`-returning async callback | `no-floating-promises` is default-on at warn; `no-misused-promises` is not on at all. |
| Untyped values do not spread | the `typescript/no-unsafe-*` family (type-aware) | An `any` from an untyped dependency flowing through the whole call graph | The `reportAny` twin. `no-unsafe-type-assertion` flags branded smart constructors, so budget one disable per constructor. |

The rest of the type-aware set worth naming, all native and all needing
`typeAware`: `only-throw-error`, `restrict-template-expressions`,
`no-base-to-string`, `no-unnecessary-condition`, `prefer-readonly`,
`require-await`, `no-deprecated` (the `reportDeprecated` twin),
`strict-boolean-expressions` (its `allowString` / `allowNumber` /
`allowNullableObject` defaults let plain `string`, plain `number` and `T | null`
through, but nullable primitives already error).

Configuration mechanics that decide whether any of it is armed:

- **`plugins` replaces the default set, it does not extend it.** Verified 2026-09-03: with `"plugins": ["import"]`, a `typescript/no-explicit-any` rule at `"error"` exits 0 in silence; deleting the key restores the defaults (typescript, unicorn, oxc) and it exits 1. List every plugin the config uses, `import` and `vitest` included, or half the rules vanish.
- **An `import/*` rule with no `plugins` entry is discarded silently**, exit 0 with no output. Verified 2026-09-03 on a two-file cycle. The CLI is the opposite: `oxlint -D import/no-cycle` works with no plugin declaration.
- **The config file fails closed on an unknown rule name; the CLI fails open.** A bad name in `.oxlintrc.json` aborts the run (`Failed to parse oxlint configuration file`, exit 1, nothing linted, on stdout not stderr); inside `overrides[].rules` the header reads `Failed to build configuration.` instead. `oxlint -D no-such-rule-xyz` exits 0 with zero bytes. Keep rules in the config, never in hook flags.
- **`--rules` is a silent no-op** at 1.80.0: zero bytes, exit 0. Use `--print-config` to inspect an effective config, and note it cannot diagnose the two traps below.
- **`overrides[].files` globs resolve against the config file's directory.** Verified 2026-09-03: a config holding `files: ["src/domain/**"]` moved one level down into `hooks/` matches nothing and exits 0 with no warning, while the byte-identical file at the root exits 1. `--print-config` prints both identically. Anchor every override glob with a leading `**/`, and keep the config beside the tree it scopes.
- **An unknown key inside a `no-restricted-imports` pattern object silently drops the whole rule.** Verified 2026-09-03: `allowTypeImport` (singular, one keystroke from the correct `allowTypeImports`) turns a firing gate into exit 0 and zero output. `--print-config` echoes the typo back and `$schema` does not validate at runtime.
- **Severity `"warn"` exits 0.** A severity typo fails open where a rule-name typo fails closed.
- **A nested `.oxlintrc.json` in a subdirectory overrides the root rules** and is dropped entirely by `-c <path>`; `--disable-nested-config` turns the mechanism off. `oxlintrc.json` with no leading dot is not discovered at all, and neither is `oxlint.config.mjs`/`.js` (only `oxlint.config.ts`/`.mts` and the dotted JSON forms are).
- **oxlint walks `node_modules` unless a VCS ignore file excludes it**, drowning the run in dependency diagnostics. Always scope paths: `oxlint -c .oxlintrc.json --deny-warnings src tests`.
- **The abusive-disable rule can suppress itself.** Verified 2026-09-03: `/* eslint-disable unicorn/no-abusive-eslint-disable */` above a bare `/* eslint-disable */` exits 0 with the rule at error. `respectEslintDisableDirectives: false` does not close it - that key is prefix-scoped to `eslint-` directives, and setting it also removes those directives from the unused-directive report, so it cannot inventory an inherited suppression set. A grep for the literal rule name inside a suppression comment is the only cover.

**Biome**, where a repo is already on it. Its recommended preset is tri-level,
and the exit code follows severity rather than membership. Verified 2026-09-03
against Biome 2.5.11 with `biome explain`: `noExplicitAny`, `noNonNullAssertion`,
`noTsIgnore`, `useConst` and `useImportType` are all recommended and all default
to **warn**, so a recommended-preset run exits 0 on every one of them.

- `--error-on-warnings` lifts warnings and **not** info. Verified 2026-09-03: `useLiteralKeys` at its default info exits 0 with or without the flag. Spell `"error"` per rule for anything at warn or info; `"on"` keeps the default severity and gates nothing.
- `--diagnostic-level=error` filters warnings out *before* the exit-code decision, so it silently defeats `--error-on-warnings` and emits no output at all. It is exactly the flag someone adds to quieten a noisy log.
- **A `biome.json` containing a `//` comment is discarded in silence.** Verified 2026-09-03: `biome rage` reports `Status: Not set` and the linter runs pure defaults at exit 0. Name the file `biome.jsonc`. 2.5.11 also reports `recommended` as deprecated in favour of `preset`.
- **Nursery rules cannot be enabled from `overrides[]`.** Verified 2026-09-03: `noFloatingPromises` at `"error"` inside an override exits 0, while the same entry under top-level `linter.rules.nursery` exits 1. `domains: { types: "all" }` does not enable it either. Scoping such a rule *off* for a path does work.
- **Biome needs an ignore file** (`.gitignore`, `.git/info/exclude` or `.ignore`) in the directory holding its config, or the run dies with an `internalError/fs` and zero rule output. A 0-byte `.gitignore` does not satisfy it; one line of content does.
- **`useLiteralKeys` fights `noPropertyAccessFromIndexSignature`.** Verified 2026-09-03: `biome check --write --unsafe` rewrites `process.env["REGION"]` to `process.env.REGION`, exits 0, and leaves a tree `tsc` rejects with TS4111. The hook order runs fix before typecheck, so the lint tier reports success at the moment it breaks the typecheck tier. Suppress per site, or turn the rule off and accept losing its true positives.
- `biome migrate` rewrites a whitespace-formatted `"rules": { "recommended": true }` into `preset: "none"`, disabling the linter, and recurses into nested configs. Review its dry-run diff before `--write`; a canary file with a known recommended violation is a better check than parsing the config.
- Biome's own suppression discipline is the mirror of oxlint's: a `biome-ignore` with no reason is a parse error that fails closed, but there is no scope requirement, `biome-ignore lint:` and `biome-ignore-all` blanket a file unreported, and `suppressions/unused` is a warning. A misspelled directive keyword is invisible - the comment is never parsed as a suppression at all.

**Ultracite is a starting point, not a gate.** Version 7.10.7 generates an
oxlint or Biome preset with `ultracite init --linter oxlint|biome`. Its traps,
each of which the drop-in config has to answer: `no-console` and
`no-restricted-properties` are off on all three routes; `sort-keys` and
expression-only `func-style` are on; a block of type-aware rules is declared at
`"error"` with no `oxlint-tsgolint` installed and no `typeAware` key, so they
fail open; `ultracite init --type-aware` adds the dependency and changes no
generated config; it resolves linters from `PATH`, so a mise-global oxlint of a
different minor rejects the pinned config; its generated husky and lefthook hooks
run `pnpm dlx ultracite fix` repo-wide, unpinned and network-resolved on every
commit, with no path scoping; `--hooks` configures agent hooks, not git hooks. `ultracite check --error-on-warnings=true` is broken
on both providers - Biome rejects the `=true` form and oxlint has no such flag.

**anti-slop** (github.com/dmmulroy/anti-slop, MIT, no npm package by design) is
adopted as an optional JS-plugin block: 15 generic rules plus an Effect rule per
its README on 2026-09-03, costing roughly +0.05s per run. Read the live rule list
before wiring it. Install with
`skills add dmmulroy/anti-slop --skill install-anti-slop`, or copy `src/` to
`tools/oxlint/anti-slop/`, and wire it through `jsPlugins` with `@oxlint/plugins`
pinned to the exact installed oxlint version. Turn `no-unknown-parameters` off
for `src/boundary/**`: it fires on the `(x: unknown)` type-predicate and parser
shapes the `typescript` skill prescribes, and 14 of the 15 rules expose no
options to relax it.

## Formatting

oxfmt is the formatter. It passes Prettier's JS/TS conformance suite, runs
markedly faster than Prettier or Biome, and formats JSON and YAML as well, so an
oxc repo needs no second formatter for config files. `oxfmt --migrate=prettier`
or `--migrate=biome` converts existing config.

**rumdl owns Markdown house-wide**, so oxfmt must be told to leave it alone or
the two fight over every `.md` file. Verified 2026-09-03 against oxfmt 0.65.0
(0.66.0 held back by the release-age quarantine): `--init` writes
`.oxfmtrc.json` containing `{"ignorePatterns": []}`, and

```json
{ "ignorePatterns": ["**/*.md"] }
```

drops Markdown from the run while YAML, JSON and TS stay in it (4 files checked
to 3). `oxfmt --check` exits 1 on an unformatted file and 0 when clean. See
`references/typescript-oxfmtrc.jsonc`.

oxfmt is pre-1.0, so pin it and land any migration reformat as its own commit.
Biome's formatter is the fallback where a repo is already on Biome.

## Framework single-file components

The Rust linters do not parse framework SFCs. Point oxlint at an `.astro` file
and it reads the frontmatter but misreads the template - `{cond && <script />}`
trips `no-unused-expressions` because template JSX is parsed as plain JS. Biome
has the same blind spot.

- **Scope the JS linter to `*.ts` / `*.tsx` / `*.js` / `*.mjs`** and exclude the SFC extension from that step. The glob is the fix.
- **Let the framework checker own the SFC**, and check its compiler support before promising a gate. Registry-verified 2026-09-03: `@astrojs/check` 0.9.10 declares `typescript: ^5.0.0 || ^6.0.0` and `svelte-check` 4.7.6 declares `^5.0.0 || ^6.0.0`, both excluding TS 7; `vue-tsc` 3.3.11 declares `>=5.0.0`. All three drive the TypeScript JS API through Volar, and that API is absent from `typescript@7` (see [Type checking](#type-checking)), so an SFC project needs the TS 6 side-by-side alias for its checker. Behaviour of `vue-tsc` under TS 7 is unverified.
- **To lint inside `<script>` blocks**, add the framework's ESLint parser (`astro-eslint-parser` + `eslint-plugin-astro`, `eslint-plugin-vue`, `eslint-plugin-svelte`). oxlint and Biome cannot stand in for it, and the whole route needs the TS 6 alias.

## UI hygiene

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No raw `<input>` / `<button>` / `<a>` outside the component library | ast-grep rule scoped to app and feature code | Drift from the design system | oxlint has no `no-restricted-syntax`, so this is ast-grep or the `oxlint-plugin-eslint` JS-plugin bridge, not a native rule. Exempt `src/components/ui/**`. |
| Accessibility regressions | oxlint `jsx-a11y` rules, named individually, with `"jsx-a11y"` in `plugins` | Missing labels, roles and keyboard handlers | Verified 2026-09-03: without the plugin entry, `jsx-a11y/alt-text` at `"error"` exits 0 on a bare `<img>`. Turn off `no-noninteractive-tabindex`: it conflicts with the axe-mandated `scrollable-region-focusable` pattern. |
| No inline styles | Biome `noInlineStyles`, or an ast-grep rule | Design-system bypass | Allow `style` on charting components with a per-site suppression. |
| Imports stay sorted and grouped | Biome `assist.actions.source.organizeImports` + `biome check` | Merge conflicts on import blocks | It is an **assist** action, not a lint rule: `biome lint` never runs it. `biome check` does, and reports it at error severity. |

`useTopLevelRegex` is a **performance** rule, not a correctness or ReDoS one: it
asks that a regex literal be hoisted out of a hot function so it is compiled
once. It exempts the `g` and `y` flags, whose `lastIndex` state makes hoisting
wrong. It says nothing about catastrophic backtracking - see
`references/typescript-security.md`, ReDoS.

`jsx-a11y` is static-only. Its runtime complement - colour contrast, computed
ARIA, focus order - is the axe/pa11y gate in `references/web-delivery.md`. Run
both.

## Import hygiene

oxlint's `import` plugin owns the direct-edge half. It sees one import
statement at a time, which is why the transitive half needs the ts-morph test in
`references/architecture-boundaries.md`, Transitive architecture tests.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No cycles | `import/no-cycle` with `"plugins": ["import"]` | Module init-order bugs | `ignoreTypes` defaults true, so it is a runtime-cycle gate until you set it false. `maxDepth` silently misses deeper cycles. |
| Layer bans | `no-restricted-imports` with `patterns` in an `overrides` block | A pure layer importing an adapter | `allowTypeImports` is native and works on `patterns` despite the published docs listing it only for `paths`. `group` matches the literal specifier, so `../infra/*` misses `../../infra`: use `**/infra/**`. |
| No node builtins in the core | `import/no-nodejs-modules` | A domain module reaching for `node:fs` | Has no `allowTypeImports`, so it rejects a legitimate `import type { Stats } from "node:fs"`. Its `allow` list also needs both `node:assert` and bare `assert`. Not a substitute for `no-restricted-imports`. |
| Barrels stay small | `oxc/no-barrel-file` | A single index re-exporting a whole subsystem | Default `threshold` is 100, which is inert. Verified 2026-09-03: a two-module barrel needs `{ "threshold": 1 }` to fire. |
| Deep imports into a package | no oxlint rule | A consumer reaching past the package root | The `no-internal-modules` gap; Biome `noPrivateImports` (JSDoc `@package`/`@private`) is the nearest twin. |

Cycles in code no entry point reaches need knip, and knip only sees
entry-reachable files, so the two are complementary rather than redundant - see
[Dead code (knip)](#dead-code-knip).

Unresolved path aliases are **invisible edges**: with no tsconfig declaring
`paths`, `import/no-cycle` exits 0 on a real cycle and prints no
unresolved-import warning. oxlint auto-discovers `tsconfig.json` for this, so an
alias defined only in the bundler, or a tsconfig outside the discovery walk,
leaves those edges dark while the gate stays green.

**madge is rejected.** Its default `fileExtensions` is `["js"]`, so
`madge --circular src` reports "Processed 0 files" and exits 0 on a pure
TypeScript tree; `--extensions ts` then skips every `.tsx`; an unknown key in
`.madgerc` is ignored without a warning; and it parses through
`@typescript-eslint/typescript-estree`, so it carries the same TS 7 exclusion,
crashing with the same exit code it uses for a real finding. oxlint `no-cycle`
plus knip cycles covers it.

## Complexity

The cross-stack argument, the thresholds and the wiring live in
`references/complexity.md`, including the cross-file duplication gate. Two facts
belong here because they are properties of the linter rather than of the metric:

- Every metric rule sits in `pedantic`, `style` or `restriction`, so none is reached by a default run and each must be named. Verified 2026-09-03: a bare `oxlint src tests` on a 5-deep, 5-parameter function produces nothing.
- All seven ESLint metric rules are native Rust in oxlint, `complexity`'s `variant: "modified"` included. Cognitive complexity and duplicate-function detection are the gaps, closed through the `jsPlugins` bridge running `eslint-plugin-sonarjs`.

## Dead code (knip)

The TypeScript analogue of vulture, and the only tool here that flags an unused
*export*, an orphaned file or an unused dependency. `tsc`'s `noUnusedLocals`
sees inside one file; cycle rules see only the graph. All findings below verified
2026-09-03 against knip 6.33.0 (6.34.0 held back by the release-age quarantine,
and it is the release that fixes the `--max-issues` hole below).

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Whole-project graph | `knip` from the repo root | Orphaned files and dead exports drifting in | 150+ plugins teach it implicit entry points (vitest, next, storybook). |
| Production gate | `knip --production --strict`, with `!` on every `entry` and `project` pattern | Test-only helpers reported as dead in CI | Without the markers this exits 0 on a dead tree - see below. |
| Dev-dependency leak | `--strict` | A dev-only import reaching production code | The deptry DEP004 twin. Verified: it reports a `vitest` import from `src/` that `--production` alone passes. |
| Config drift | a separate dev-mode `knip --treat-config-hints-as-errors` | A glob that stopped matching, so the gate covers nothing | Production mode disables hints entirely, so this cannot ride on the CI gate. |
| Barrel see-through | `includeEntryExports: true` per workspace | An export dead everywhere but re-exported by `src/index.ts` | Set the config key, not the CLI flag: the flag is global and flags a library's public API too. `/** @public */` exempts a symbol. |
| Cycles | `--cycles` (or `--include ...,cycles`) plus `rules.cycles: "error"` | Tangles among entry-reachable files | Two independent switches; the default severity is warn. |

- **`--production` reads only patterns suffixed `!`.** Verified: with `{"entry": ["src/index.ts"], "project": ["src/**/*.ts"]}` and a dead file present, dev mode exits 1 and reports it while `--production` exits 0 with empty output; adding `!` restores exit 1. The negation of the unmarked `project` pattern is what empties the analysis, and production mode is the one mode that never volunteers a hint about it. This is the single most dangerous configuration in the file.
- **A misspelled key inside `rules` is a stderr warning and exit 0.** `{"rules": {"cycle": "error"}}` prints `WARNING: Ignored unknown issue type "cycle" in rules`, reports the cycle, and passes. The outer schema is strict by contrast: an unknown top-level key exits 2 and a bad severity value exits 2. Per-type severities do exist (`"off"`, `"warn"`, `"error"`), so `rules` is both the gate and the soft spot.
- **`--max-issues` with a non-numeric value silently disables the gate.** Verified on 6.33.0: `--max-issues abc` prints the full report and exits 0, because the comparison is against `Number(...)` and every comparison with `NaN` is false. The realistic trigger is a ratchet wired to a variable set to `none` or misspelled. Floor the tool at 6.34.0, which rejects a non-integer.
- **`--include` is a strict whitelist and drops what it omits.** In dev mode it silently disables `catalog` and `catalogReferences`; in production it disables `optionalPeerDependencies`. Two runs (`knip --production && knip --production --cycles`) beat one hand-maintained list.
- **Findings go to stdout and every diagnostic to stderr**, so `knip > report.txt` loses config hints, the misspelled-rule warning and every config error.
- **Cycles are found only among entry-reachable files**, unlike oxlint `no-cycle`, which walks files. Dead-but-tangled code is invisible to it. Run both.
- **`--allow-remove-files` implies `--fix`** even with no `--fix` on the command line, and deletes dynamically-imported files. There is no dry run. Never put it in an automated step.
- `ignoreDependencies` is a permanent mute with no expiry, and `--no-exit-code` is the kill switch. `@internal` is suppressed with no config at all under `--production`; `@public` and `@beta` are the zero-config suppressions in dev mode, and only the JSDoc `/** */` form is read.

The `references/knip.jsonc` drop-in is near-empty with the markers in place and
the two gate commands in comments. Rejected by name: `depcheck` (archived, exit
255 for everything), `ts-prune` (archived, exits 0 unless `--error`, cannot
resolve `.ts` specifiers), `unimported` (deprecated, no test-entry inference, so
it over-reports where knip is correct, and its `--fix` deletes a live file and
exits 0). `fallow` is a watch: fast, but verified to miss any import cycle
longer than 12 modules while documenting no depth limit.

The dependency, licence and publish tiers live in
`references/typescript-publishing.md`, Dependencies and Publishing.

## Gate integrity

Every gate in this file can fail open. Assume none is armed until a canary
proves it. One line per class, all verified 2026-09-03:

- **oxlint's default severity is warn**, so a bare run prints correctness diagnostics and exits 0. Only `--deny-warnings` or a per-rule `"error"` gates.
- **`oxlint -D <unknown-rule>` exits 0 with zero bytes**, as does a typo'd category; the same name in `.oxlintrc.json` aborts the run. Rules belong in the config, never in hook flags.
- **A type-aware rule with no `options.typeAware`** exits 0 in silence; `--type-check` without it exits 1, so only the config route fails open.
- **`plugins` replaces the default plugin set**, so listing `["import"]` alone silently disables every `typescript/*` rule; an `import/*` rule with no `plugins` entry is discarded the same way.
- **`overrides[].files` anchors to the config file's directory**, so a config moved one level down matches nothing and exits 0. `--print-config` cannot see it.
- **An unknown key inside a `no-restricted-imports` pattern object drops the whole rule**, exit 0, and `$schema` does not validate at runtime.
- **A nested `.oxlintrc.json` overrides the root** and is dropped by `-c`; `oxlintrc.json` and `oxlint.config.mjs` are not discovered at all.
- **oxlint lints `node_modules`** absent a VCS ignore file, so the target paths in the gate command are load-bearing.
- **`/* eslint-disable */` on line 1 mutes every rule**, `no-abusive-eslint-disable` can suppress itself, and `respectEslintDisableDirectives: false` hides the very directives it neuters.
- **Biome `--error-on-warnings` does not lift info**, `--diagnostic-level=error` defeats it entirely, and a `//` comment makes `biome.json` vanish with no message.
- **Biome nursery rules cannot be enabled from `overrides[]`** and exit 0 there.
- **`tsc --showConfig` exits 0** on removed options, unknown options and malformed JSON; **`--noCheck`** hides unresolved imports as well as type errors; **a misspelled top-level tsconfig key** is accepted and silently widens the program; **`skipLibCheck`** hides errors in first-party `.d.ts`; **`incremental`** drops every isolatedDeclarations diagnostic.
- **`pnpm exec tsc` falls through to a global compiler**, so the gate can pass on a project whose local TypeScript is missing or aliased away.
- **`knip --production` with no `!` markers** exits 0 on a dead tree; a misspelled key in `rules` warns on stderr and passes; `--max-issues <non-number>` disables the gate; `--treat-config-hints-as-errors` is inert under `--production`.
- **oxfmt, madge, dependency-cruiser and fallow** each have their own silent-zero-files mode - see [Formatting](#formatting), [Import hygiene](#import-hygiene) and `references/architecture-boundaries.md`.

The canary discipline: feed a gate a known violation and assert the non-zero
exit **and** that the rule's own name appears in the output, then feed the same
violation at an exempt path and assert zero. Match the rule name, not the status:
oxlint config errors and lint failures share exit 1. Keep the positive canary out
of the tree the real gate scans, in a temp copy - oxlint has no stdin mode
(verified 2026-09-03 against 1.80.0), so an on-disk canary reddens the very gate
it exists to prove.

## Maintenance posture

TypeScript itself is Microsoft's, and oxc (oxlint, oxfmt, tsgolint) sits under
VoidZero, acquired by Cloudflare with a neutrality pledge and adopted by
vuejs/core, turborepo and sentry-javascript. Biome is a community foundation with
corporate sponsors. Everything else here is effectively bus-factor one: knip,
publint, attw, sherif, ultracite, dependency-cruiser, fallow, anti-slop.

That sets a review cadence, not a veto. Pin exact versions and let the 4-day
release-age quarantine hold the newest back - which is why oxlint pins 1.80.0
against a published 1.81.0, knip 6.33.0 against 6.34.0, and oxfmt 0.65.0 against
0.66.0 on 2026-09-03. Prefer a tool that is already a dependency of one you have
(ts-morph over a second graph library), prefer a loud failure to a silent pass,
and re-run the canaries after every minor bump. A rule that changes name between
minors takes an oxlint config down, and a category promotion changes a Biome
rule's config path.
