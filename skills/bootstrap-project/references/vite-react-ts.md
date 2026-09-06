# Vite React TypeScript SPA

Recipe ID: `vite-react-ts`
Last verified: 2026-09-04 against the current `create-vite` help.

## Scaffold

Preselect Node 24 and pnpm 11 with `mise exec`, then run:

```sh
pnpm create vite@latest <name> --template react-ts --no-interactive --no-immediate
```

The scaffold supplies React, TypeScript, Vite and Oxlint but no behavioural
tests. Do not replace its lint configuration before the enforcement skill has
inspected it.

## House delta and proof

- Add at least one test through the `testing` skill. A passing empty test
  command is not a gate.
- Record exact `packageManager`, numeric Node and pnpm selectors, lockfile,
  lifecycle decisions and hk wiring.
- Prove `pnpm run build`, lint, tests and a loopback-bound development server.

Source: [Vite Getting Started](https://vite.dev/guide/).
