# Toolchain: choosing a TypeScript compiler version

Verified against typescript 7.0.2 (stable 2026-07-08). These are the
fastest-moving facts in the skill — re-verify release notes when revising.
Scope fence: compiler *version selection and migration* lives here; lint rules
and strict tsconfig flag config stay with `mechanical-enforcement`.

## What TS 7 is

- Go-native port of the compiler (~10x faster builds). The npm `typescript`
  package ships **`tsc` only** — no `tsserver` binary; editor tooling is
  LSP-based.
- **No JS API until 7.1.** Anything that `import`s the compiler
  (typescript-eslint, framework language-service plugins, custom transformers)
  cannot run on 7.0.
- `@typescript/native-preview` (the `tsgo` dev builds) is frozen, not
  npm-deprecated; nightlies now publish as `typescript@next`. Same Go engine —
  projects that typechecked under tsgo typecheck under 7.0 unchanged.

## Migration reality

- tsconfig options deprecated in 6.0 **hard-error** in 7 (e.g. `target: ES5`,
  `charset`, `outFile` module concat).
- Surprising default changes vs 5.x/6.x: `rootDir` defaults to `./` (was
  computed), `types` defaults to `[]` (was all `@types/*`), `strict` is on,
  `module` defaults to `esnext`. A project with an explicit tsconfig for each
  is unaffected; sparse configs can change behaviour silently — diff the
  resolved config, not just the errors.

## When to stay on 6.x / 5.x

- **JS-API consumers**: typescript-eslint and similar — keep the project's
  `typescript` devDependency on 6.x, or alias
  `"typescript": "npm:@typescript/typescript6@^6.0.2"`.
- **Framework language-service plugins**: Vue, Svelte, Astro, Angular still
  need the JS API — stay on 6.x there. Next.js supports TS 7 since 16.2.12
  via `experimental.useTypeScriptCli`; older Next.js stays on 6.x.
- The mechanism that makes this safe: the project's own `typescript`
  devDependency always wins over any global install — version choice is
  per-project, so one machine can host 5/6/7 projects side by side.
- Side-by-side in one project: `@typescript/typescript6` ships a **`tsc6`**
  bin, so a repo can run 7's `tsc` for speed and `tsc6` where the old
  behaviour matters during migration.
