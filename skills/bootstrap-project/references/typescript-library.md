# TypeScript library

Recipe ID: `typescript-library`
Last verified: 2026-09-04 against pnpm 11.25.0.

## Scaffold

Create an empty directory, preselect Node 24 and pnpm 11 with `mise exec`, then
run inside it:

```sh
pnpm init --bare
```

Use `src/index.ts` as the public entry point. The TypeScript and mechanical
enforcement skills own runtime target, exports, compiler settings and lint
rules.

## House delta and proof

- Set explicit package exports, exact `packageManager`, lockfile and native
  package scripts.
- Test observable behaviour through exported APIs.
- Prove typecheck, lint, tests, package build and consumption from a packed
  archive rather than only imports from source.

Source: `pnpm init --help`, verified live on the date above.
