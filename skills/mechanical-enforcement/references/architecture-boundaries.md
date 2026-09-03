# Mechanical Enforcement - Architectural boundaries

The cross-stack story for principle 3 (*architectural boundaries are linter
rules*): making illegal module graphs uncompilable, transitive graph gates,
greppable invariants, functional-core purity, and cross-service contract gates.
Per-language boundary specifics live with their stack: Python in
`references/python.md`, Rust in `references/rust.md`. Routed from the picks
table and rules-catalogue index in `SKILL.md`.

## Contents

- [Architectural boundaries](#architectural-boundaries)
- [Transitive architecture tests](#transitive-architecture-tests)
- [Boundary tool matrix (TypeScript)](#boundary-tool-matrix-typescript)
- [Cycle gating on legacy graphs](#cycle-gating-on-legacy-graphs)
- [Go boundaries](#go-boundaries)
- [Greppable invariants (agent self-audit tier)](#greppable-invariants-agent-self-audit-tier)
- [Purity: keeping the functional core pure](#purity-keeping-the-functional-core-pure)
- [Boundary contracts (cross-service compatibility)](#boundary-contracts-cross-service-compatibility)

## Architectural boundaries

Scope an import ban to a layer to make illegal graphs uncompilable. The catalogue of
patterns:

- **Pure layer cannot import side-effectful layer.** `files: ["src/utilities/**"]` + `no-restricted-imports` banning `next/cache`, `next/headers`, `next/navigation`, ORM runtime modules. `allowTypeImports: true` keeps port types visible and is native in oxlint (verified 2026-09-03 against oxlint 1.80.0: the `import type` line passes, the value import exits 1). Exempt one or two *intentionally* coupled files (`queries.ts`, `revalidate.ts`) through `excludeFiles`.
- **UI cannot import schemas directly.** `files: ["src/components/**"]` + `no-restricted-imports patterns` banning `@/collections/*` (or whichever path holds your DB schemas). UI should depend on *generated types*, not schema source - otherwise a UI tweak forces a migration.
- **Raw SQL only in the query layer.** Ban the `sql` tagged template outside `src/db/**`, and the raw driver import (`postgres`) with it. The tag needs a syntax selector, so it is an ast-grep rule; the import half is a plain `no-restricted-imports` pattern. **sqruff** (Rust) then lints / formats that quarantined SQL - see the picks table in `SKILL.md`.
- **Dynamic `import()` only via named wrappers.** A selector on `ImportExpression` outside `next/dynamic` / `React.lazy`. Prevents ad-hoc chunking that defeats SSR.

**oxlint (Rust) runs the direct-edge half.** It has native `no-restricted-imports` (with
`allowTypeImports`), `no-restricted-properties`, `no-restricted-globals`, `jsx-a11y` and a
multi-file `import/no-cycle`, needs no Node dependency tree, and survives TypeScript 7 because
it never loads the project's compiler. It has **no** `no-restricted-syntax`: naming that rule in
a config file aborts the whole run (`Rule 'no-restricted-syntax' not found in plugin 'eslint'`,
exit 1, nothing linted), and spelling it as a CLI `-D` flag is a silent no-op at exit 0, so
selector rules go to ast-grep (`references/typescript-ast-grep.yml`) or to the
`oxlint-plugin-eslint` jsPlugin under an `eslint-js/` prefix. Direct rules are blind to a
barrel: a domain file importing `../index.ts`, which re-exports infra, passes at exit 0 while a
transitive gate flags it (verified 2026-09-03 against oxlint 1.80.0). The rule catalogue and its
config traps are in `references/typescript.md` (Lint families, Import hygiene); the config
drop-in is `references/typescript-oxlintrc.jsonc`, and `references/eslint-boundaries.mjs` keeps
the ESLint form for a TypeScript 6 side-by-side layer.

## Transitive architecture tests

Use "architecture test" for an executable check over the module graph: "domain must never
reach runtime", "UI must never reach server-only content", "private facts only enter through
the gated boundary". These are lint-style gates for structural drift, and they exist because
one hop defeats a direct-edge rule: a domain file importing the barrel that re-exports infra
passes every `no-restricted-imports` in the repo.

**On TypeScript 7 the gate is a ts-morph test run by vitest**, dropped in as
`references/typescript-arch-test.ts`. It builds the graph with ts-morph's `Project` over the
repo's tsconfig and asserts layer rules (no `src/domain/**` module reaches `src/infra/**`),
reachability with the offending chain named in the failure message, and package cycles,
filtering type-only edges separately so a boundary allowing shared types but not runtime values
is two assertions over one graph. Two mechanics are load-bearing, verified 2026-09-03 against
ts-morph 28.0.0. Edges come from `getLiteralsReferencingOtherSourceFiles()`, not
`getImportDeclarations()`: a module whose only edges are a dynamic `await
import("../infra/db.ts")` and an `import("../infra/db.ts").Order` type query returns **zero**
import and export declarations, so the declaration accessors miss the laundering route outright.
And the start set is asserted non-empty, because a hand-rolled path predicate has no schema - a
typo'd prefix yields 0 start modules and a green test, where the corrected form flags all five
fixture violations, barrel launder and dynamic import among them. ts-morph bundles its own
TypeScript (6.0.2 at 28.0.0), so the test resolves modules under a different compiler than the
build, which is also why it survives the cliff below.

**dependency-cruiser is the richer engine, and it stops at TypeScript 6.** 18.2.0 declares
`typescript >=2.0.0 <7.0.0`, and that is a removed-API problem rather than a version-range
oversight, so no range bump fixes it. Under TS 7 every `.ts` extension is disabled and a
directory target cruises nothing: `✔ no dependency violations found (0 modules, 0 dependencies
cruised)` at **exit 0**, the reason demoted to a `‼ missing-typescript-transpiler` note that
prints only when `options.tsConfig` is set (verified 2026-09-03 against dependency-cruiser
18.2.0 with typescript 7.0.2). Keep it in a sidecar `tools/` package owning its own
`typescript@6`, or alias the lint stack's compiler as
`typescript@npm:@typescript/typescript6@6`, an alias that ships bin `tsc6` and **removes
`node_modules/.bin/tsc`**, so a `tsc -p` script falls through to whatever is on PATH. Either
route needs its own fail-closed assertion, because the module count is the only tell:

```bash
depcruise --info | grep -qE '^[[:space:]]*✔ \.ts$' || { echo "depcruise cannot parse .ts"; exit 1; }
depcruise src --config .dependency-cruiser.cjs -T err
```

What its rules can and cannot express, verified 2026-09-03 against 18.2.0 with typescript
6.0.3 aliased in:

| Fact | Consequence |
|---|---|
| `reachable` accepts only `path` / `pathNot` | Pairing it with `via`, `viaNot` or `dependencyTypes` is a hard schema error at exit 1. A transitive rule and a type-only split are two configs and two runs. |
| `via*` applies to `circular` rules only | On a non-circular rule a `via` that matches nothing is accepted, ignored, and **widens** the rule - a via of `^MATCHES_NOTHING$` reported 2 violations. `viaNot` is deprecated in favour of `viaOnly.pathNot`. |
| `scope: "folder"` + `to: { circular: true }` is the package-cycle gate | Granularity is the module's *immediate parent directory*, so a cycle whose legs sit in different subfolders (`pkgc/src` -> `pkgd/src`, `pkgd/util` -> `pkgc/src`) reports clean at exit 0. |
| `required` rules invert the polarity | `module: { path: "^src/domain/" }, to: { path: "^src/ports/" }` fails every domain module with no port edge. Aim them at directory roots: a `required` rule is defeated by the module being absent from an entry-point cruise. |
| The exit code is the error count, masked to 8 bits | 255 errors exit 255; **256 errors exit 0**. Test `!= 0` and never `== 1` - exit 1 is also an invalid config, an invalid reporter, an unreadable file and a missing graphviz. |
| The reporter decides whether it gates | `err`, `err-long`, `teamcity`, `azure-devops` and `null` exit with the count; `json`, `markdown`, `flat`, `text` and `metrics` exit 0 on the same violations, and `github-actions` is not a reporter at all (exit 1 on a clean tree). A rule's `comment` prints under `err-long` alone, so the default `err` drops the guidance that explains the failure. `outputType` is rejected by the config schema, so every invocation site spells `-T` itself. |
| The baseline is module-precise and never expires | `depcruise-baseline` + `--ignore-known` keys a reachability entry on `from` plus rule name; `to` and the `via` chain are recorded and never compared. Rewiring a baselined module to an infra file absent when the baseline was written stays at exit 0. |

Adoption pattern on a TypeScript 6 stack:

1. Extend `dependency-cruiser/configs/recommended-strict` (7 rules at error plus a
   node_modules `doNotFollow`). Its `not-to-unresolvable` rule turns an unresolved path
   alias into a loud error rather than a silent pass. Name your own rules like invariants
   (`pure-access-not-to-runtime`, `prod-not-to-tests`) and give each a `comment`.
2. Set `options.tsConfig.fileName` so aliases resolve and `tsPreCompilationDeps: true` so
   type-only imports enter the graph. Under the default `false` that edge is absent
   entirely, so an ordinary `domain -> infra` path rule misses it too.
3. Assert `✔ .ts` from `--info` and a non-zero `summary.totalCruised`; a path
   regex matching nothing is a silent exit 0. Run `--no-cache` in hooks: the
   cache never hashes the rule set, and with a `.json` config a warm run after
   an uncommitted rule addition exited 1 against a `--no-cache` truth of 2.
4. Measure wall time. Cheap path and circular rules are close to free, each
   `reachable` rule is not. `no-orphans` is a narrow sanity check rather than a
   dead-code strategy - an orphan has no incoming *and* no outgoing edges, so
   dead code that imports anything is invisible, and knip owns unused exports,
   files and dependencies (`references/typescript.md`).

**Python routes to import-linter, not to a dependency-cruiser port.** Contracts are
transitive by default rather than behind a `reachable` flag, they see through `__init__.py`
re-exports the way `reachable` sees through a barrel, and they include `if TYPE_CHECKING:`
imports unless `exclude_type_checking_imports` is set globally - so there is no per-rule
`dependencyTypes` split, only two config files and two runs. Three feature gaps are worth
knowing before promising parity: a "reaches infra only through this named module" contract
does not exist and needs a grimp graph inside a pytest test, the way TypeScript needs the
ts-morph test above; `no-orphans` has no equivalent at all (vulture owns dead code); and
there is no `depcruise-baseline` / `--ignore-known`, so the ratchet is exact-edge
`ignore_imports` entries under `unmatched_ignore_imports_alerting = "error"`, which expire
themselves when the edge goes. Contracts, the tach carve-out, and the wiring notes are in
`references/python.md`.

Do not substitute a pytest-native direct-edge DSL for this graph gate. A rule that rejects
`domain -> infra` but accepts `domain -> application -> infra` enforces spelling, not
reachability. PyTestArch 4.0.1 and main exhibited that behaviour in a positive-control
fixture. Reuse import-linter's Grimp graph inside pytest when a custom reachability
predicate is needed.

See `references/dependency-cruiser.cjs` for a copyable TypeScript config shape.

## Boundary tool matrix (TypeScript)

When the bounded-context map outgrows per-rule import bans, one declarative direct-edge layer is
optional on top of the two gates above. Every ESLint option below needs typescript-eslint, which
refuses TypeScript 7 outright (`typescript-eslint does not support TS 7.0.`, exit 2 before a
file is linted, verified 2026-09-03 against 8.68.0) - a TypeScript 6 side-by-side layer rather
than a TS 7 option.

| Tool | Standing | Why |
|---|---|---|
| eslint-plugin-boundaries 7.2 | optional | Element types assigned to paths, rules written over the types, with a working type/value split. Direct edges only. `configs.recommended` is a no-op gate (its four exhaustiveness rules are off and it needs element descriptors), so wire explicit rule entries or `configs.strict`. An unknown element-type string in a selector matches nothing, silently. Path aliases need `settings["import/resolver"]` plus `eslint-import-resolver-typescript`. |
| eslint-plugin-import-x 4.17 | optional | The maintained home of `no-restricted-paths`, the zone-ban rule. Same resolver requirement, and without it an aliased crossing passes at exit 0 while relative ones fire - a silent half-gate. |
| @softarc/sheriff | mention only | Barrel encapsulation is real; the rest is weaker than advertised. Last release 2025-09-22, breaks outright on TypeScript 7 because it loads the compiler, no type/value split, and a missing config downgrades it to the deep-import rule with a green exit. The installable names are `@softarc/sheriff-core` and `@softarc/eslint-plugin-sheriff`. |
| fallow | watch | Fast and compiler-independent, but direct-edge only: it never sees the domain-to-infra reach and goes fully silent whenever the barrel's own zone is a legal import target, which is the common config. It also misses import cycles longer than 12 modules, and a config under any name but `.fallowrc.*` / `fallow.toml` is undiscovered and silently green. Re-verify with a barrel-laundering fixture at its next major. |
| `tsc --build` project references | adopt | Literally uncompilable: `composite: true` plus the project's own `include` rejects a cross-project source import with TS6059 + TS6307 at exit 2 (verified 2026-09-03 on typescript 7.0.2), and a plain `tsc -p` enforces it, `--build` adding only orchestration and the TS6202 cycle check. Two escapes: it launders through a built `.d.ts`; and a composite project absent from the root `references` is never visited (`--build` on the root exited 0, aiming tsc at the orphan exited 2), so assert every `*/tsconfig.json` appears there. |

## Cycle gating on legacy graphs

The transitive tools above gate cycles as binary - any cycle fails. That is the right
greenfield default, but it is unadoptable on a legacy graph already full of them, and it
misses the real signal: a cycle's danger is its *size and growth*, not its existence (von
Zitzewitz). Small same-package cycles do little harm; large cycle groups cannot be tested in
isolation, replaced, or understood, and grow release by release into an unbreakable core.
Gate by level:

- **Package / namespace / module cycles: zero-tolerance.** These layers carry
  architectural intent, so any cycle between them is a violation - this is
  where `import/no-cycle` / dependency-cruiser / `cargo modules --acyclic`
  earn their keep. Python's is import-linter's `acyclic_siblings` contract,
  which names a cycle-breaking edge in the failure message
  (`It could be made acyclic by removing 1 dependency: .infra -> .domain`).
  It compares direct dependencies among the sibling set only, so a chain
  laundered through a module *outside* the named ancestor reports KEPT and
  exit 0 - the same evasion a barrel file gives a direct-import rule. Run the
  contract at the parent package as well, which does catch it.
- **File / class cycles: small and contained is tolerable.** A group of ≤5
  confined to one package is liveable; break a group before it grows past that
  or spans packages, while the fix is one dependency inversion rather than a
  rewrite. Python needs no extra tool here: basedpyright `reportImportCycles`
  is an error under `recommended`, so a file-level cycle fails the type gate.
  It is absent from `strict`, which is one more reason `recommended` is the
  mode this skill gates on.
- **Legacy adoption: baseline, don't flood.** Wire the cycle rule through a committed
  baseline (`depcruise-baseline` + `--ignore-known`, with the module-precision caveat
  above) so only *new* cycles fail, then shrink it - the ratchet recipe in `SKILL.md`
  (Ratcheting a gate onto non-conforming code).

No OSS tool gates on cycle-*group* (strongly-connected-component) size directly;
Sonargraph-Explorer (free but proprietary) computes group-size and graph-erosion metrics - a
watch, against the local-OSS grain, same posture as Socket.

Soft complexity thresholds are the file-local half of the same erosion story (von
Zitzewitz): size, nesting depth and parameter count, enforced by each stack's own linter.
The numbers, the evidence behind each metric, and which of them are report-only rather than
gates live in `references/complexity.md`.

## Go boundaries

depguard inside golangci-lint covers direct layer gating: multiple named rules
scoped by `files:` globs (e.g. a `domain` rule denying `myapp/internal/infra`
and the DB driver). Reach for
[go-arch-lint](https://github.com/fe3dback/go-arch-lint) when a real component
architecture warrants a declarative map - `components` + `deps.mayDependOn` in
`.go-arch-lint.yml`, gated with `go-arch-lint check`. `gomodguard_v2` is the
module-level sibling: allow/block whole modules with recommended replacements.

## Greppable invariants (agent self-audit tier)

Some boundaries are awkward or impossible for `no-restricted-imports` to see:
cross-package leaks in a monorepo, raw-string patterns, "this directory must
stay framework-free". Encode these as **grep assertions that must return zero
matches** - a cheap pre-flight an agent runs before declaring work done, and
that wires into an hk step where it should gate.

```bash
# each line must find NOTHING; `! rg` turns a match into a non-zero (failing) exit
! rg -n "from ['\"]express['\"]" packages/core/src        # core stays framework-free
! rg -n "sql\`" packages/*/src --glob '!packages/db/**'   # raw SQL only in the query layer
```

**The whole-file type-checker downgrade is the canonical case in Python**,
because no checker forbids it and no ruff rule sees most of its forms. A
`# pyright: basic` header swaps the file back to the basic rule set and drops
every recommended-tier diagnostic. `# pyright: reportUnknownParameterType=false`
turns off a named rule file-wide; `=none` and `=hint` do the same, and
`=warning` demotes it below the error severity a gate reads.
`# pyrefly: ignore-errors` and `# mypy: ignore-errors` silence a file outright. ruff's PGH003 catches only the
line-level `# type: ignore`, and basedpyright's `enableTypeIgnoreComments =
false` default closes only the `# type: ignore` family. The residue is a grep:

```bash
# a pyright directive is only honoured on its own line at column 0 (indented, it
# errors), so ^# is safe to anchor on. The mode words are strict/standard/basic:
# `# pyright: off` is not a bypass, it is an unknown-directive error
! rg -n '^# *(pyright: *(basic|standard|report[A-Za-z]+ *= *(false|none|hint|warning))|pyrefly: *ignore-errors|mypy: *(ignore-errors|disable-error-code))' -g '*.py'
```

Do not tighten that pattern with a `$` anchor: `# pyrefly: ignore-errors[bad-return]`
is a real scoped whole-file form, and the pyright per-rule form takes a
comma-separated list. A pyright mode comment applies to the whole file from
wherever it sits, so one at line 400 is invisible to a reviewer opening the
header - only a whole-file grep finds it.

This sits between lint and review. Prefer a real `no-restricted-imports` /
`no-restricted-syntax` rule when the linter *can* express the boundary - it runs
in-editor and is harder to bypass. Reach for grep for the cross-file,
cross-package, and string-level cases ESLint can't see, and as a portable check
an agent can run in any repo with no linter config. The "unique function names"
grep step in `references/typescript.md` is the same technique applied to one rule.

**ast-grep upgrades the durable ones from text to AST.** `rg` matches strings,
so it false-positives on comments and string literals and false-negatives across
reformatting. [ast-grep](https://ast-grep.github.io/) (`sg`, Rust, production)
matches tree-sitter AST patterns with `$VAR` metavariables and gates via
`ast-grep scan` (non-zero exit, YAML rules), polyglot from one binary. Use `rg` for
quick / throwaway assertions and ast-grep for the boundary rules you want to
keep - it also subsumes `no-restricted-syntax` rules that don't need type
information. It is syntax-only, so type-aware boundaries (import resolution,
`allowTypeImports`) still belong in ESLint / oxlint. In a committed hook invoke
it as `ast-grep scan` - the short `sg` alias collides with `setgroup(1)` on Linux
(the wired step is in `references/hk-steps.pkl`). Two settings decide whether it
gates at all: `severity: error` (a rule at `warning` prints and exits 0) and a
`files:` glob with no leading `./` (which matches nothing, also exit 0).

It is also the only way to gate a test that asserts nothing in Python - ruff has
no `expect-expect` / `useExpect` equivalent at any rule count. The
`test-without-assertion` rule in `references/python-ast-grep.yml` is that gate:
it treats `assert`, `pytest.raises`/`warns`/`fail` and any `assert*`-named
helper call as an assertion, so delegation to an `assert_valid()` helper and
unittest's `self.assertEqual` both pass, and the rule doubles as a naming
convention for assertion helpers.

**When the rule needs data flow, not one AST shape, Opengrep is the next tier.** ast-grep
matches a single syntactic pattern; taint/injection, cross-function, and "tainted input
reaches this sink" rules need dataflow the pattern engines can't express.
[Opengrep](https://github.com/opengrep/opengrep) - the OSS Semgrep fork (engine LGPL-2.1)
that a consortium spun up after Semgrep relicensed `semgrep-rules` in December 2024 and put
CE engine features behind its commercial licence - runs Semgrep-format YAML (taint mode,
cross-file) and emits SARIF, polyglot across 20+ languages from one binary. Gate with
`opengrep scan --config <dir> --error --disable-nosem --no-git-ignore`; each flag earns its
place, verified 2026-09-03 against opengrep 1.29.0. **The default exit code is 0 even with
findings, so `--error` is load-bearing** - omit it and CI silently passes. A `// nosemgrep`
comment drops a finding and `--disable-nosem` reports it again (2 findings against 1).
Gitignored files are skipped in silence: a generated-but-committed directory took the scan
from 6 files / 2 findings to 7 / 3 under `--no-git-ignore`. The default `.semgrepignore`
also skips `tests/` - naming that directory explicitly gave `Ran 1 rule on 0 files` at exit
0, so assert a non-zero scanned-file count. Install is the curl script or a GHCR Docker
image; the `opengrep` name on npm is an unrelated placeholder. It complements gitleaks
(secrets) and the fixed-ruleset language linters: this is the tier for custom bug-class
rules no off-the-shelf linter encodes. Reach for ast-grep first for syntactic rules (faster,
lighter pre-commit); escalate to Opengrep when the rule is a dataflow or security property.
`severity: ERROR` in a rule doesn't change the CLI exit on its own. The authoring workflow
for a new bug-class rule is `SKILL.md` (Adding a new rule).

## Purity: keeping the functional core pure

The `architecture` skill's functional-core rules - inject clock and randomness, parse config
at startup, no IO in the domain - are mechanically enforceable, but no single rule covers
every ambient-effect shape. The first two rows are complementary rather than alternatives,
so a pure layer scopes both to `src/domain/**`. Verified 2026-09-03 against oxlint 1.80.0
and Biome 2.5.11 on one domain module holding every shape.

| Rule | Catches | Misses |
|---|---|---|
| `no-restricted-properties` (oxlint, ESLint) | `Date.now()`, `Math.random()`, `process.env.X` and its bracket form, destructuring, and the `import process from "node:process"` spelling. Leaves `Math.max(1, 2)` and `new Date(ms)` alone. | Zero-arg `new Date()`, the alias `const D = Date`, the `globalThis` cast. |
| `no-restricted-globals` listing the *object* (oxlint, ESLint, Biome) | The same three member expressions - a member expression's object position is a bare global reference - plus `new Date()` at any arity, and `globalThis.process.env` once `checkGlobalObject: true` is set (7 findings with the flag against 6 without). | Nothing in that set, but it over-bans: `Math.max(1, 2)` and `new Date(1700000000000)` fail with it. An `import process from "node:process"` binding defeats it. |
| `no-restricted-imports` patterns (native in oxlint) | IO modules (`node:fs`, `node:http`) and infra directories, with `allowTypeImports` sparing port types. | Barrel-laundered edges, which are the transitive gate's job. |
| `eslint-js/no-restricted-syntax` through the `oxlint-plugin-eslint` jsPlugin | Zero-arg `new Date()` precisely, through `NewExpression[callee.name='Date'][arguments.length=0]`, leaving `new Date(ms)`. The other route is `references/typescript-ast-grep.yml`. | Nothing validates the selector, so a one-character slip in the attribute path exits 0 in silence - this rule needs the canary below most. |
| Biome `noJsRestrictedProperties` (nursery since 2.5.6) | The same member-expression set from an `overrides[].linter.rules.nursery` block, covering `.tsx` and the `node:process` import with no extension list. | Zero-arg `new Date()`. Nursery membership relocates the config key on promotion. |

- **Python**: ruff `TID251` is the `no-restricted-properties` analogue and a
  stronger one, because it resolves through ruff's semantic model - `from
  datetime import datetime as dt` then `dt.now()` is caught, which is the alias
  every TypeScript rule above misses. Its scope comes from inverting a global
  table, and that inversion has its own silent-disable traps; the wiring, the
  `DTZ` caveat and the pytest-socket backstop are in `references/python.md`
  (Purity), with drop-ins `references/python-purity.toml` and
  `references/python-ast-grep.yml`.
- **Rust**: clippy `disallowed-methods` (`std::env::var`,
  `SystemTime::now`) and `disallowed-types` on infra types. Granularity is
  crate-wide, so give the pure core its own crate.

**Scoping is where this gate rots.** Keep the rules in the root `.oxlintrc.json` under
`overrides[].files`; those globs resolve against *the directory containing the config file*, not
the cwd, and every miss is exit 0 with no output. Verified silent no-ops: `srcc/domain/**`, bare
`src/domain` (which is what `.gitignore` and tsconfig `include` would accept), the same config
moved into `cfgdir/` with repo-root-relative globs, and `src/domain/**/*.ts` against a `.tsx` or
`.mts` module - write `src/domain/**/*.{ts,tsx,mts,cts}`. A one-key typo inside a `patterns`
entry (`allowTypeImport`) discards that entry the same way, and a `.gitignore`d domain directory
is skipped by a directory sweep at exit 0 while an explicit file path fires. Biome's
`overrides[].includes` behaves the same.

Because none of that fails closed, the gate needs a canary with this shape:

```bash
root=$PWD; tmp="$(mktemp -d)"; mkdir -p "$tmp/src/domain"
cp "$root/.oxlintrc.json" "$tmp/" && cp "$root/fixtures/purity_canary.ts" "$tmp/src/domain/canary.ts"
out=$(cd "$tmp" && "$root/node_modules/.bin/oxlint" --config .oxlintrc.json src/domain/canary.ts 2>&1) || true
[[ $out == *no-restricted-properties* ]] || { echo "purity gate not armed"; exit 1; }
```

Three details are load-bearing: match the **rule name** in the output rather than the exit
status, because a known-bad file trips unrelated rules and an exit-code test passes whatever the
gate does; capture with `|| true`, since oxlint exits 1 on any diagnostic; and run against a
temp copy, or the committed known-bad file reddens the real gate for good. Deleting the rule
from the config flips this canary to exit 1.

No rule in the lane resolves an alias, so `const D = Date; new D()` escapes them all. The
runtime backstop that closes the residue, a domain-project setup file whose `Date.now` and
`Math.random` spies throw, is in `references/typescript-testing.md` (Runtime backstops); the
purity `overrides` block ships inside `references/typescript-oxlintrc.jsonc`, and
`references/purity-boundaries.mjs` keeps the ESLint form for a TypeScript 6 side-by-side layer.
The no-config escape hatch is grep (`rg -n "Date\.now\(|Math\.random\(" packages/core/src`),
weaker than the AST rules because it matches comments and strings too - and `! rg` is the wrong
wrapper, because rg exits 2 on a missing or renamed directory and `!` inverts 2 to 0 exactly as
it inverts 1. Dispatch on the exit code: 1 passes, 0 fails, anything else is an error.

## Boundary contracts (cross-service compatibility)

Anything crossing a service boundary is a public contract (the
`event-driven-architecture` skill's framing) - and contract breakage is
mechanically checkable by diffing the schema against a baseline. publint/attw
(see `references/typescript.md`) cover the npm package shape; these cover the wire:

| Contract | Gate with | Notes |
|---|---|---|
| Protobuf | `buf breaking --against '.git#branch=main'` | Rule sets ladder from `FILE` (generated-code compat, default) to `WIRE` (wire-only). |
| OpenAPI 3.0/3.1 | `oasdiff breaking base.yaml revision.yaml --fail-on ERR` | The default over Azure openapi-diff. Core CLI + action are OSS; a hosted/Pro tier exists, so the Atlas-lint paywall precedent applies - watch. |
| GraphQL | `graphql-inspector diff` (non-zero on breaking) | Single schema. Federated graphs need Cosmo `wgc subgraph check` - composition breaks only show across the supergraph. |
| Rust public API | `cargo semver-checks` | Diffs rustdoc JSON against the released baseline; auto-run by release-plz; not exhaustive (proves the breaks it finds, not their absence). |
| TS public `.d.ts` surface | `@microsoft/api-extractor` with a committed `.api.md` report | CI runs *without* `--local` and fails when the surface changed unreviewed; dev regenerates with `--local` and commits the diff. |
| Python public API | `griffe check -s src <pkg> -a <git-ref>` | Structure only - every annotation change exits 0. No baseline or ratchet, so a legacy library adopts it advisory-first. The committed-report route is bespoke: `griffe dump` carries line numbers, absolute paths and private members. |
| Python `py.typed` completeness | `pyright --verifytypes <pkg> --ignoreexternal` | 100%-or-fail, no threshold flag. Run against a non-editable install of the built wheel; an editable install scores the source tree instead. |

For consumer-driven contracts, `pact-broker can-i-deploy` is the deploy gate
(the method itself lives in the `testing` / `event-driven-architecture`
skills). Avro/JSON-Schema have no standalone single-binary gate - a schema
registry's compatibility check is the production path.

All of these diff against a baseline (git ref, published schema, committed
report), so they belong in CI / pre-push, not pre-commit. Command patterns in
`references/contract-gates.md`.
