# TypeScript CLI

Recipe ID: `typescript-cli`
Last verified: 2026-09-04 against pnpm 11.25.0.

## Scaffold

Create an empty directory, preselect Node 24 and pnpm 11 with `mise exec`, then
run inside it:

```sh
pnpm init --bare
```

Use `src/cli.ts` as the authored entry point. The TypeScript and mechanical
enforcement skills own runtime choice, compiler settings and lint rules.

## House delta and proof

- Set a `bin` entry, exact `packageManager`, lockfile and native package scripts.
- Add tests through the public CLI contract: arguments, exit status, stdout,
  stderr and filesystem effects.
- Prove typecheck, lint, tests, package build and one installed CLI invocation.

Source: `pnpm init --help`, verified live on the date above.
