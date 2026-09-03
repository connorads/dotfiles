# Mechanical Enforcement - TypeScript publishing

Two tiers `typescript.md` does not carry: the dependency and manifest gates that
run on every commit, and the post-build gates that run against the packed
tarball. The drop-in is `references/typescript-publish-gates.sh`. knip's own
flags and traps belong to `typescript.md`, Dead code; the `.api.md` recipe to
`references/contract-gates.md`, TypeScript - @microsoft/api-extractor. Every
version below is npm `latest` on 2026-09-03 as well as the installed one, except
pnpm (11.20.0 installed, 11.25.0 latest, identical on every case here).

## Contents

- [Dependencies](#dependencies)
- [Build config](#build-config)
- [Publishing gates](#publishing-gates)
- [Release gates](#release-gates)
- [Parity gaps](#parity-gaps)

## Dependencies

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Lockfile matches every manifest | `pnpm install --frozen-lockfile`, spelled explicitly in CI | Manifest drift | `ERR_PNPM_OUTDATED_LOCKFILE`, exit 1. It does not re-verify cached tarball integrity. |
| Nothing left to dedupe | `pnpm dedupe --check` | Two copies one install would collapse | Independent from the frozen check; it can also fail while the lock is out of sync. Read-only; exit 1. |
| Cross-package versions agree | `sherif --fail-on-warnings` at pre-commit | One dependency at two versions across a workspace | Sub-millisecond. Also gates `unordered-dependencies`, `types-in-dependencies`, `root-package-manager-field`, `empty-dependencies`. |
| Version policy and manifest shape | `syncpack lint` and `syncpack format --check` in CI | Drift sherif's fixed rule set has no vocabulary for, plus unsorted manifest keys | Two commands: `lint` ignores formatting entirely. v13 command names exit 1 with a deprecation banner. |
| Manifest fields are valid | `npmPkgJsonLint .` with an explicit rc | `"version": "not-a-version"`, a `type` outside `module`/`commonjs`, a bogus SPDX `license` | Exit **2** on findings, **3** on a config error. The `validate-pyproject[all]` twin, and the nearest thing to one. |
| Licence inventory | `pnpm licenses list --json --prod` piped to a `jq` denylist | A copyleft dependency arriving unnoticed | Advisory, not a gate: see the guard below. |

- **Bare `--lockfile-only` cancels CI's implicit frozen default.** It may rewrite a drifted lock and exit 0. Explicit `--frozen-lockfile --lockfile-only` still fails on manifest drift. Spell the frozen flag in CI and keep lockfile-writing commands out of gates.
- **A deleted lockfile passes.** With `node_modules` present pnpm reconstructs `pnpm-lock.yaml` from `node_modules/.pnpm-workspace-state-v1.json` before the frozen check runs, prints "Already up to date" and exits 0. Only a tree with neither the lock nor that state file reports `ERR_PNPM_NO_LOCKFILE`. On a dev machine the deletion is invisible.
- **Dropping `--check` inverts `pnpm dedupe`.** The bare command mutates `pnpm-lock.yaml` and exits 0 (lock md5 `29f804e5` to `3c5b75ae` on the drifted fixture). It is one word from a read-only gate to a lockfile writer that always passes. It also cannot be scoped: `--filter` is rejected outright, and a down registry is a 70-second exit 1 that reads like a finding, which is the argument for CI over pre-commit.
- **sherif's coverage is exactly the workspace glob, with no signal outside it.** A `services/api` package holding `lodash-es: ^3.0.0` while `packages/*` agree reports "No issues found", exit 0. A glob matching nothing prints one warning, "across 0 packages", and exits **0** without `--fail-on-warnings`. Nothing inside sherif cross-checks the glob against the manifests on disk, so the out-of-glob package needs an external package-count assertion. Verified 2026-09-03 against sherif 1.13.0.
- **A narrowly scoped syncpack version group silently removes those instances from the default group.** Version groups are a partition, first match wins: with a group pinning `lodash-es` for `@fx/core` only, core at `^4.17.0` beside app at `^4.18.0` reports "No issues found", exit 0. Add a group and either keep a catch-all or accept that the cross-package check stops covering that dependency. Filter *values* are never validated either, so a typo'd package or dependency name is inert forever at exit 0, and `--source` matching nothing exits 0. Verified 2026-09-03 against syncpack 15.3.3.
- **`pnpm licenses list` is inventory and cannot become a gate.** It always exits 0, has no allow-list flag, and omits `link:` and `workspace:` dependencies entirely: a vendored GPL-3.0-only package added with `pnpm add link:vendor/gplpkg` appears in `dependencies` and in neither the table nor `--json`. `file:` deps of the same directory are listed, so the omission is invisible by inspection.
- **Guard the empty set before `jq`.** With no production dependencies the command writes the plain sentence `No licenses in packages found` to stdout at exit 0, and `jq` then exits 5 on a legitimately clean project:

```sh
out=$(pnpm licenses list --json --prod)
case "$out" in '{'*) ;; *) exit 0 ;; esac   # "No licenses in packages found"
printf '%s' "$out" | jq -e 'keys - ["MIT","ISC","Apache-2.0","BSD-2-Clause","BSD-3-Clause"] | length == 0'
```

- Keys are SPDX *expressions*, so `pako@2.1.0` arrives as `(MIT AND Zlib)` and fails an allow-list of bare identifiers, and a package with no `license` field becomes the literal key `Unknown`. Rejected: `license-checker-rseidelsohn` (`--onlyAllow` is a substring match, so MIT admits `(MIT AND GPL-3.0)`, and `--failOn GPL-3.0` misses `GPL-3.0-only`) and `licensee` (crashes on pnpm's isolated tree at exit 1, indistinguishable from a finding). Both verified 2026-09-02.
- **npm-package-json-lint fails closed on its own config and open on a missing manifest.** An invalid rule name and a missing rc file both exit 3; pointed at a directory holding a config but no `package.json` it prints nothing and exits 0. It carries 130 rules and **none** of them reads `exports`, so it is a field-shape gate only. It does not flag unknown top-level keys, and nothing else does either: `pnpm pack --dry-run` on a manifest carrying all three field defects plus an unknown key exits 0 and prints `package: ok-name@not-a-version`. Verified 2026-09-03 against npm-package-json-lint 11.0.0.
- Also rejected as an exports gate: `package-json-validator` ships no bin at all (`ERR_PNPM_DLX_NO_BIN`) and `sort-package-json` is a formatter. Adopting either reads as "exports are linted" while nothing resolves a condition target.

knip is the declared-versus-imported half. Run it as `knip --dependencies`
(shorthand for `--include dependencies,unlisted,binaries,unresolved,catalog,catalogReferences`)
and see `typescript.md`, Dead code for the `!` production markers and the rest:

| deptry code | knip issue type | Notes |
|---|---|---|
| `DEP001` import with no declared dependency | `unlisted`, plus `binaries` for a binary named in `scripts` | knip resolves `scripts` binaries, which is the usual `DEP002` false positive. |
| `DEP002` declared dependency nothing imports | `dependencies` | |
| `DEP003` import satisfied only transitively | none, and the shape barely exists under pnpm | The default isolated linker leaves a transitive-only package unresolvable from the project root (`MODULE_NOT_FOUND`), so it surfaces as `unresolved` and as a tsc error. `node-linker=hoisted` reopens the gap with no gate. |
| `DEP004` dev dependency imported from production code | `knip --strict` | `--strict` implies `--production`. |
| `DEP005` stdlib module declared as a dependency | none | |

## Build config

The publishing build is a second tsconfig extending the typecheck one, with its
own `include` so the test tree stays out of the emitted surface. The flags and
their failure modes are in `typescript.md`, Type safety; what is specific to
emit:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false, "declaration": true, "declarationMap": true,
    "rootDir": "src", "outDir": "dist",
    "noEmitOnError": true,
    "rewriteRelativeImportExtensions": true,
    "isolatedDeclarations": true
  },
  "include": ["src"]
}
```

- **`noEmitOnError` is a write guard, not a clean guard.** Introducing a type error and rebuilding exits 1 and leaves the previous build in place, byte-identical and internally consistent, so every downstream gate then lints last week's artefact. Clear `dist` before the build. Without the flag the same build exits **2** and writes the broken output; never branch on 1 versus 2 (`typescript.md`, Type checking).
- **`allowImportingTsExtensions` inherited from the typecheck config makes emit a config error** unless `rewriteRelativeImportExtensions` joins it: `error TS5096`, exit 1, no `dist` written. That pairing then conflicts with `paths`: an aliased `import type { Order } from "@app/domain/order.ts"` reports `error TS2877` at exit 1, and only when the alias is actually imported, so a `paths` block alone looks fine.
- **`isolatedDeclarations` is library-only and belongs to this config, not the typecheck one.** Its scope is the tsconfig `include`, so reusing the test-including config enforces published-surface annotation discipline on files that never ship. On the fixture it reports `error TS9010` on `export const region = process.env["REGION"]`, exit 1, and the whole build stops. It needs `declaration` or `composite`, otherwise `TS5069` exits 1 and short-circuits every other diagnostic.

## Publishing gates

Pack once, then point every gate at the same tarball. Order matters: a failing
build must not reach publint, and attw exits 0 on a package with no types at
all, so it has to run after both.

```sh
rm -rf dist && pnpm build || exit 1
TGZ=$(pnpm pack --pack-destination .pack --json | jq -r '.filename')   # absolute path
publint run "$TGZ" --strict || exit 1
attw "$TGZ" --profile esm-only -f json > .pack/attw.json || exit 1
jq -e '.analysis.types.kind? == "included"' .pack/attw.json || exit 1
```

- **publint gates on errors only, and `--strict` promotes warnings but never suggestions.** Verified 2026-09-03 against publint 0.3.24: an `exports` glob matching no files prints under `Warnings:` at exit 0 and under `Errors:` at exit 1 with `--strict`; a package with a `module` field and no `sideEffects` prints a `Suggestions:` line at exit 0 with **and** without `--strict`. `USE_SIDE_EFFECTS`, `USE_FILES`, `USE_LICENSE`, `USE_TYPE` and `USE_ENGINES_NODE` can never gate.
- **A typo'd flag is accepted in silence.** `--stricct` on the same tarball reprints the warning and exits 0. `--level bogus` is accepted too. publint has no config file and no rule scoping, so the flags are its whole configuration surface and its whole attack surface.
- **`--pack false` keeps `FILE_DOES_NOT_EXIST` and drops `FILE_NOT_PUBLISHED`**, which is the one check worth having: on `files: ["dist/**/*.js"]` the packed view exits 1 and `--pack false` exits 0. The auto packer is `pnpm pack`, which force-includes `main`/`exports` targets; `--pack npm` is the strict view, and linting the tarball path is stricter still, since an unpublished file is then simply absent.
- **`exports` with no `"."` key and no `main` is silently clean while the package is unimportable**: exit 0 under `--strict`, because the missing-root-entrypoint check only runs when `main` or `module` is also present. That is the modern ESM-only shape publint's own guidance pushes you toward.
- **attw returns 0 when the package ships no types.** `getExitCode` opens `if (!analysis.types) return 0`, so a build that stops emitting declarations goes green on all three profiles. `-f json` then emits `"types": false`, a boolean, so the unguarded `jq -e '.analysis.types.kind == "included"'` crashes at exit 5 rather than evaluating; `.kind?` gives exit 0 typed and 4 untyped. Verified 2026-09-03 against @arethetypeswrong/cli 0.18.5, which pins typescript 5.6.1-rc as a hard dependency and analyses the package with that resolver, not the project's compiler.
- **Pick the profile from whether the package ships CJS, not from which name sounds safest.** On one clean ESM-only build: `strict` exits 1 (node10 NoResolution plus node16-cjs CJSResolvesToESM), `node16` exits 1, `esm-only` exits 0. `esm-only` is a promise not to support those two resolution modes, so write it in the README as well as `.attw.json`. Unknown keys in that file are dropped without a warning while unknown *values* fail loudly.
- **Neither tool sees the JavaScript.** attw walks the type-declaration graph; publint checks declared entry points. Deleting `dist/domain/order.js` while its `.d.ts` still ships leaves both at exit 0 on a package that throws `ERR_MODULE_NOT_FOUND` on first import. `InternalResolutionError` fires only when both files are gone.
- **Install `@arethetypeswrong/cli`.** The bare name `attw` on npm is a dependency-confusion placeholder that always exits 0, ignores every argument and writes nothing to stderr; `pnpm add -D attw` succeeds and the release-age quarantine does not fire, because the placeholder is old (verified 2026-09-02 against attw 1.0.0).

The clean-directory smoke test is the only gate that exercises the artefact as a
consumer sees it, and its two halves catch different failures. The `cd` is
load-bearing: run from the project root and the source tree shadows the install.

```sh
D=$(mktemp -d) && cp .pack/*.tgz "$D/pkg.tgz" && cd "$D"
printf '{"name":"smoke","private":true,"version":"0.0.0","type":"module"}' > package.json
pnpm add -D "file:$D/pkg.tgz" typescript@7 || exit 1
node -e 'import("<pkg>")' || exit 1                       # runtime half
printf 'import * as lib from "<pkg>"; console.log(lib);' > consumer.ts
./node_modules/.bin/tsc --noEmit --module nodenext --strict consumer.ts || exit 1
```

- Verified 2026-09-03 on node 24.19.0 with typescript 7.0.2: the missing-`.js` tarball fails the runtime half with `ERR_MODULE_NOT_FOUND` at exit 1 while the type half passes, and a tarball with no declarations passes the runtime half at exit 0 and fails the type half with `TS7016` at exit 1. Leave `skipLibCheck` at its default `false` in the consumer config: it is the only reason a leaked devDependency in the public `.d.ts` surfaces (verified 2026-09-02), and most real consumer configs set it true, so treat that class as covered here and nowhere else.
- **`"sideEffects": false` is checkable and is routinely wrong.** Bundle the built entry through rollup with only a bare `import` of it and assert the output is empty, with `treeshake.moduleSideEffects: "no-external"` so a runtime dependency does not make every package look impure. On the fixture the module-scope `process.env["REGION"]` read leaves 22 bytes standing at exit 1 while publint, attw and the smoke import are all green; a pure entry generates an empty chunk at exit 0. Resolve the entry to an absolute path first and never write `onwarn() {}`: a missing entry becomes an external import, tree-shakes away and exits **0**, silently. Verified 2026-09-03 against rollup 4.63.1.
- **A committed expected-files list is a change detector, not a correctness check.** `pnpm pack --dry-run --json | jq -r '.files[].path' | sort` diffed against a committed list catches `files:` drift, which is real: the fixture's tarball ships `dist/tsdoc-metadata.json` (written into `outDir` by api-extractor) and six source maps whose `.ts` sources are absent. Both sit in the baseline from the first run, so only the first review catches them. `prepack` does not run under `ignore-scripts`, so the listing describes whatever `dist` happens to hold.

## Release gates

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Public `.d.ts` surface is reviewed | `pnpm build && api-extractor run` | An unreviewed change to the exported type surface | The recipe, the `ae-missing-release-tag` fork and the pinned-compiler note live in `references/contract-gates.md`, TypeScript - @microsoft/api-extractor. |
| A change declares its version bump | `changeset status --since=<base>` | A merged PR that ships nothing because nobody bumped | Needs `fetch-depth: 0`. |
| The tarball carries provenance | `pnpm publish --provenance` | An unattested release, so consumers' `trustPolicy` sees weakening evidence | The consumption side is the `supply-chain-hardening` skill. |

- API Extractor's stale-output and `--local` traps live in `references/contract-gates.md`, TypeScript - @microsoft/api-extractor.
- **changesets reads git, not the working tree.** Under `--since` the changeset file must be git-tracked: untracked exits 1, `git add`-ed exits 0. Bare `changeset status` reads untracked files and is therefore not the gate.
- **Set `changedFilePatterns` or the gate demands a changeset for every README.** Verified 2026-09-03 against @changesets/cli 3.0.1: a README-only commit exits 1 under the default `["**"]` and exits 0 with `changedFilePatterns: ["src/**", "package.json"]`. Two fails-open remain: `"private": true` silences the package entirely at exit 0, and `changeset add --empty` is a one-line escape.
- **`publishConfig.provenance` does nothing under pnpm** (verified 2026-09-02 against pnpm 11.20.0), and a mis-spelled publish flag or a missing `id-token: write` publishes unattested with no message. `--provenance` is absent from `pnpm publish --help` and implemented anyway.
- tsdown bundles publint and attw inline, and only publint gates at the defaults: `--attw` alone reports at warning level and exits 0. `--attw.level error` or `--fail-on-warn` is what gates, and the help text's `--fail-on-warn (default: true)` is wrong - it resolves to false (verified 2026-09-02 against tsdown 0.22.14).
- `validate-package-exports` is a watch: its import and require checks are `import.meta.resolve` comparisons rather than real loads, and its output needs `--info` or it prints nothing. `size-limit` needs a plugin (`@size-limit/esbuild`) and bundles for the browser by default, so a Node library entry hard-fails rather than reporting a number.

## Parity gaps

State these rather than filling them with a weak gate. The canary discipline for
everything above is `typescript.md`, Gate integrity.

- **`check-wheel-contents` has no twin.** publint's `FILE_NOT_PUBLISHED` only looks at declared entry points, so a tarball can ship tests, an empty `dist` or stray top-level directories at exit 0 everywhere. The expected-files list is the closest substitute and it is a diff, not a rule.
- **`check-manifest` has no twin at all**, because npm has no source-distribution concept and the tarball is deliberately not what git contains.
- **`twine check --strict` has no twin.** Nothing validates that the README renders on the registry; publint's `USE_LICENSE` is suggestion-level and never gates.
- **`--verifytypes` has no twin.** `isolatedDeclarations` forces explicit annotations at source time and attw's `untyped-resolution` catches a resolution landing on untyped JS, but neither scores completeness of the built artefact, and attw's whole-package no-types case exits 0, the exact inverse of what `--verifytypes` exists for. The nearest assertion is the binary `jq -e '.analysis.types.kind? == "included"'`.
- In the other direction, attw and the `sideEffects` assertion have no Python analogue at all.
