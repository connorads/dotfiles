# Cloudflare TanStack Start

Recipe ID: `cloudflare-tanstack-start`

Last verified: 2026-09-04 against Create Cloudflare 2.72.3 and the generated
TanStack Start project.

## Scaffold

Preselect Node 24 and pnpm 11. Run exactly:

```sh
pnpm create cloudflare@latest <name> --framework=tanstack-start \
  --platform=workers --no-deploy --no-git --no-open
```

Do not add `-y` or `--accept-defaults`. C3 2.72.3 still exits successfully but
creates the Hello World Worker instead of TanStack Start. Verify TanStack and
React dependencies in `package.json` before accepting the scaffold.

C3 delegates to TanStack's current CLI and then adds Cloudflare wiring. The
observed scaffold has no `AGENTS.md`, tests, test script or Vitest dependency.
Do not preserve earlier workarounds for those absent files.

## Generated contract

- `wrangler.jsonc` selects Workers, `nodejs_compat` and the TanStack server
  entry.
- `vite.config.ts` composes TanStack Start with the Cloudflare Vite plugin.
- Routes live under `src/routes/`; `src/routeTree.gen.ts` is generated and may
  need an explicit formatter or linter exclusion.
- A build emits `dist/client` and `dist/server/wrangler.json`. The generated
  Wrangler file is the effective deployment configuration and supplies the
  static assets directory.

C3 may print a current compatibility date while retaining an older date in
`wrangler.jsonc`. Inspect the file and review intervening compatibility notes
before changing it.

## House delta

- Add a real test and native test script. An empty or absent test runner is not
  a gate.
- Review generated `pnpm-workspace.yaml#allowBuilds` entries. The observed
  scaffold approved esbuild, lightningcss, sharp and workerd. Do not inherit
  those decisions without the supply-chain owner.
- Remove obsolete `pnpm.onlyBuiltDependencies` metadata when the current pnpm
  reports it as ignored.
- Add numeric mise selectors, exact `packageManager`, lockfile, canonical pnpm
  lifecycle checker and hk wiring.

## Proof

Run native lint, test and build checks. Build before the direct Wrangler
rehearsal because its generated entry does not exist beforehand:

```sh
pnpm run build
pnpm exec wrangler deploy --dry-run
```

`pnpm run deploy --dry-run` is also a safe generated-script rehearsal at the
verified versions. Bare `pnpm deploy --dry-run` is not the package script and
errors under pnpm 11.25.0.

After an authorised deployment, smoke the public application route. A green
Wrangler command alone is insufficient.

Sources: [Cloudflare TanStack Start guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/),
[automatic configuration](https://developers.cloudflare.com/workers/framework-guides/automatic-configuration/),
[Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/).
