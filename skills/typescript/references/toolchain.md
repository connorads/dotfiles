# Toolchain: compiler version, runtime floor, library facts

Scope fence: compiler *version selection and migration*, the runtime floor, and every version literal the skill cites live here; lint rules and tsconfig flag values stay with
`mechanical-enforcement`, and a flag is named here only as the reason an idiom compiles or does
not. The fastest-moving facts in the skill - re-verify the dated blocks when revising (done
2026-09-03 on typescript 7.0.2 and 6.0.3, node 24.19.0 and 26.8.1, deno 2.9.5, bun 1.3.14).

## What TS 7 is

Go-native compiler, `tsc` only - no `tsserver` binary, editor tooling is LSP-based, and
`exports["."]` maps to `lib/version.cjs`, so `import ts from "typescript"` yields
`{version:"7.0.2",versionMajorMinor:"7.0"}` and `ts.createProgram` is `undefined`: code written
against the legacy `ts.*` namespace cannot run at all, and the stable ecosystem API arrives in 7.1.
A provisional one sits at `typescript/unstable/{sync,async,ast,fs,proto}` - 44 exports from
`unstable/sync`, `API`, `Program` and `Checker` among them - but it is out-of-process, spawning
the Go binary over JSON-RPC with no emit pipeline, so a first-party codemod or doc generator can use
it and a custom transformer cannot. `@typescript/native-preview` (`tsgo`) is frozen at
`7.0.0-dev.20260707.2`, nightlies publish as `typescript@next`, and both run the same engine.

## TS 6.0 defaults, and the config tsc will not show you

`strict: true`, `target: es2025`, `types: []` and `noUncheckedSideEffectImports` are **TS 6.0**
behaviour, identical on 6.0.3 and 7.0.2, so a repo skipping 6 meets all four at once. `types: []`
makes a bare `process.env` a `TS2591` until `types: ["node"]` is spelled;
`noUncheckedSideEffectImports` makes `import "./x.css"` a `TS2882`. `rootDir` defaults to `./`, so
a project with `outDir` and no explicit `rootDir` reports `TS5011` (carrying the `aka.ms/ts6` link),
**exits 2, and still emits**, to `out/src/a.js` - a build step that ignores exit status silently
relayouts its output.

Naming files on the command line beside a `tsconfig.json` is a hard error on 6.0 and 7.0 alike:
`TS5112 ... Use '--ignoreConfig' to skip this error`, exit 1. That advice discards every non-default
flag, so there is no per-file typecheck mode - scope by project. It keys on the literal filename, so
a repo whose real config is `tsconfig.base.json` keeps the pre-6 silent-defaults hole. And
`--showConfig` is not a validator: against `{"compilerOptions":{"strick":true,"target":"es5"}}` it
echoes `target: es5`, drops the misspelled key and exits 0, where `tsc -p … --noEmit` gives `TS5023`
plus `TS5108` at exit 1; it prints nothing for an unset option either, so it cannot say what a
sparse config resolves to.

## The lib ceiling

Year libs stop at `es2025`; past that only the `esnext.*` family exists, there is no `es2026`, and
a wrong value is `TS6046` listing every legal one, printed *after* the source diagnostics, so piping
through `head` hides it. `lib: ["es2025"]` under-declares node 24: `DisposableStack` and
`Array.fromAsync` are live in that runtime and absent from the lib, so correct code is rejected,
while `es2025,esnext.disposable,esnext.array` compiles both and still rejects `Temporal`. A bare
`esnext`, and equally `target: esnext` with no `lib` key at all, types `Temporal` into existence
while node 24's global is `undefined`, giving code that typechecks and throws `ReferenceError`.
Two sublibs re-open it alone because each carries `/// <reference lib="esnext.temporal" />`:
`esnext.intl` and `esnext.date`, the second being exactly what a `Date` migration reaches for.

## Erasable syntax, and what it misses

`erasableSyntaxOnly` is `TS1294` on six syntaxes, one-for-one with node's six
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` refusals: `enum` and `const enum`, `namespace` with runtime
code, parameter properties, `import x = require(…)`, `export = x`, `<T>expr` angle assertions.
`declare enum` and `declare namespace` emit nothing, so they are exempt.

**The hole:** decorators (standard, legacy and parameter) and `accessor` fields are
ECMAScript-proposal syntax, so tsc exits 0 on them under the flag while node exits 1 with a bare
`SyntaxError: Invalid or unexpected token` / `Unexpected identifier` - no `ERR_` code, no diagnostic
anywhere. Closing it takes a lint or grep canary (`mechanical-enforcement`), or a smoke run.

Migrating an `enum` to `as const` preserves numeric literals: `{ Read: 1, Write: 2 } as const` with
`type Flag = (typeof Flag)[keyof typeof Flag]` keeps the numeric union and the bitfield `|`. What
it costs is the reverse mapping - `Flag[1]` is `TS7053` where a numeric enum hands back `"Read"`
free - so code-to-name lookup needs a hand-written inverse map.

## Module resolution and the runtime floor

`moduleResolution` accepts `node16`, `nodenext` and `bundler`. With both `module` and
`moduleResolution` absent tsc is silent and permissive: `--traceResolution` prints
`Module resolution kind is not specified, using 'Bundler'.`, an extensionless relative import
typechecks, and the emitted program dies at `ERR_MODULE_NOT_FOUND`. `--showConfig` never
materialises that default, so a repo-level assertion is the only catch.

**Floor: node 24.** Node runs `.ts` by stripping types, with no type checking at all - a file the
project's own tsc rejects prints its wrong answer at exit 0 - and it ignores `tsconfig.json`
entirely, `paths` included; a directory whose `package.json` names no `"type"` adds a
`MODULE_TYPELESS_PACKAGE_JSON` warning to every run. A `.ts` script outside the tsconfig `include`
is gated by nothing, so give the scripts directory its own tsconfig. Node 26 (Active LTS 2026-10-28)
ships `Temporal` on by default and has no `--experimental-transform-types` - the flag is
`bad option`, exit 9 - so under it `erasableSyntaxOnly` is the only thing keeping a script
runnable. Deno welds the typechecker to the runtime - `deno --version` on 2.9.5 reports
`typescript 6.0.3`, the project's own devDependency unused - so a Deno project cannot typecheck on
TS 7 at all; deno and bun both execute `enum` at exit 0, so node's strip-only loader is the one
consumer that flag exists for.

## When to stay on 6.x

- **JS-API consumers.** typescript-eslint 8.68.0 throws `Error: typescript-eslint does not support
  TS 7.0.` at module load, exit 2, naming 7.1 as its target, so every type-aware ESLint rule this
  skill points at is on that side, as is any framework language-service plugin.
- A project's own `typescript` devDependency wins over any global install, so one machine hosts
  5/6/7 projects side by side - Deno excepted, above.
- Side by side in one project: `pnpm add -D @typescript/typescript6` puts a `tsc6` bin next to
  `tsc`, leaving 7 as the gate and 6 there for the tools that need it. Package version and
  compiler version differ (`6.0.2` ships `Version 6.0.3`), so read `tsc6 --version`, not the
  manifest. Aliasing `typescript` itself to the 6 package instead deletes `tsc` from `.bin`, and a
  `"typecheck": "tsc …"` script falls through to `PATH` - it fails open.

## Library facts (verified 2026-09-03)

**Latest** is `pnpm view <pkg> version`; **Installs** is what `pnpm add` resolves under the house
4-day release-age quarantine, so anything published inside the last four days is uninstallable today
and the two columns disagree. Pin what installs, not what `pnpm view` prints.

| Package | Latest | Released | Installs | Used by |
|---|---|---|---|---|
| typescript | 7.0.2 | 2026-07-08 | 7.0.2 | the typecheck gate |
| @typescript/typescript6 | 6.0.2 | 2026-07-06 | 6.0.2 | side-by-side `tsc6` 6.0.3 |
| effect | 3.22.1 | 2026-07-30 | 3.22.1 | `errors.md`, "The ladder" - v3, so v4 is `pnpm add effect@rc` |
| effect (`@rc`) | 4.0.0-rc.112 | 2026-08-25 | 4.0.0-rc.112 | the v4 `Result` module |
| better-result | 3.0.1 | 2026-08-11 | 3.0.1 | `errors.md`, "The ladder" |
| neverthrow | 8.2.0 | 2025-02-21 | 8.2.0 | `errors.md`, "The ladder" |
| true-myth | 9.4.0 | 2026-05-25 | 9.4.0 | `errors.md`, "The ladder" |
| zod | 4.5.4 | 2026-08-29 | 4.5.4 | `parsing.md`, "Schemas as boundary parsers" |
| valibot | 1.4.2 | 2026-06-28 | 1.4.2 | `parsing.md`, "Schemas as boundary parsers" |
| p-limit | 7.3.2 | 2026-08-31 | **7.3.1** | `concurrency.md`, "Bounded fan-out" |
| cockatiel | 4.0.0 | 2026-05-26 | 4.0.0 | `resources.md`, "Retries are a named policy value" |
