# Cloudflare TanStack Start

Recipe ID: `cloudflare-tanstack-start`

Last verified: 2026-11-13 against `@tanstack/cli` 0.72.16, `cf` 1.0.0-beta.28
and `@cloudflare/vite-plugin` 2.0.0-beta.v.12.

## Scaffold

Preselect Node 24 and pnpm. Scaffold with TanStack's CLI, without its
deployment add-on:

```sh
pnpm dlx @tanstack/cli@<version> create <name> --framework React \
  --package-manager pnpm --no-git --no-intent --no-examples \
  --toolchain biome --non-interactive --no-install
```

`--toolchain` is the linter and formatter choice; `mechanical-enforcement`
owns it. Do not add `--deployment cloudflare`. That add-on writes
`wrangler.jsonc`, a `wrangler` devDependency and a `wrangler deploy` script.

Do not use C3 (`create-cloudflare`) here: it still writes a Wrangler project
for TanStack.

Install, commit the untouched scaffold, then add Cloudflare:

```sh
pnpm install
pnpm add -D -E cf@<version>
CI=1 pnpm exec cf init . --package-manager pnpm
```

`CI=1` makes autoconfig apply its edits without prompting. `cf init --dry-run`
validates arguments only and shows no plan; review `git diff` instead. Never run
`cf init`, `cf dev`, `cf build` or `cf deploy` in a directory that has a
Wrangler config: `cf migrate` owns that case.

## Generated contract

`cf init .` produces:

- `cloudflare.config.ts` from `cf/config`, with the TanStack server entry as
  the Worker entrypoint. It is the only deployment configuration.
- The Cloudflare Vite plugin in `vite.config.ts`, with
  `viteEnvironment: { name: "ssr" }`, and an exact beta
  `@cloudflare/vite-plugin` devDependency.
- `.cloudflare/types` in the `tsconfig.json` include. The `**/*.ts` glob skips
  dot-directories, so the include is required.
- `deploy: cf deploy` and `cf-typegen: cf workers types` scripts.

`cf build` writes `.cloudflare/output/` and `.cloudflare/types/index.d.ts`.

## House delta

- Rewrite scripts to the `cf` entrypoints: `dev: cf dev`, `build: cf build`,
  `typecheck: cf workers types && tsc --noEmit`, `deploy: cf deploy`. Drop
  `preview`, `cf-typegen` and `generate-routes`; the last runs `vite build`
  outside `cf`. `cf dev` runs Vite itself, so the `dev` script does not
  recurse.
- Commit `src/routeTree.gen.ts` after the first build. Typecheck fails with
  TS2307 on a checkout without it, and the build regenerates it.
- Add `.cloudflare/` to `.gitignore`; `cf init` does not.
- Run the project formatter over `vite.config.ts`. `cf init` appends its
  plugin without following the file's style and drops the final newline.
- Remove the dead `pnpm.onlyBuiltDependencies` block from `package.json`;
  `pnpm-workspace.yaml#allowBuilds` holds the decisions. Review each
  `allowBuilds` entry with `supply-chain-hardening`.
- Record a decision for `workerd`; `cf init .` adds it without one. A cold
  install with clean pnpm config, as in Workers Builds, fails with
  `ERR_PNPM_IGNORED_BUILDS` until it has one. `workerd: false` worked for
  build, dev and deploy.
- Pin `@tanstack/*` dependencies; the scaffold leaves them on `latest`. Use
  `pnpm add -E` with the installed versions.
- `cf` and `@cloudflare/vite-plugin` 2.x are prereleases, and `cf` publishes
  them on `latest`. Keep both exact and upgrade them deliberately.
- Add a real test and native test script, numeric mise selectors, exact
  `packageManager`, lockfile, canonical pnpm lifecycle checker and hk wiring.

`cf dev` accepts no host or port arguments. It serves Vite on
`localhost:5173`, which satisfies the loopback rule.

## Proof

```sh
pnpm run build
pnpm run typecheck
pnpm run deploy --dry-run
```

The dry run builds and validates without credentials or API calls. For the
local smoke, run `pnpm run dev` and request `/` for a 200. `cf dev` logs a
failed fetch of the `Request.cf` object when offline and continues.

`cf build --mode` fails for TanStack Start (cloudflare/cf#532, open). Use
environment variables, not modes, until it closes.

After an authorised deployment, smoke the public application route. A green
`cf deploy` alone is insufficient.

Sources: [cf first Worker and existing apps](https://developers.cloudflare.com/cf/get-started/first-worker/),
[cloudflare.config.ts](https://developers.cloudflare.com/cf/projects/cloudflare-config/),
[Wrangler users](https://developers.cloudflare.com/cf/wrangler/),
[TanStack CLI](https://tanstack.com/start/latest/docs/framework/react/quick-start).
