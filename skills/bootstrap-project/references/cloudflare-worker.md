# Cloudflare Worker

Recipe ID: `cloudflare-worker`

Last verified: 2026-11-13 against `cf` 1.0.0-beta.28.

For a Worker or API with no frontend framework.

## Scaffold

Preselect Node 24 and pnpm. Run exactly:

```sh
pnpm dlx cf@<version> init <name> --package-manager pnpm
```

It asks no questions in an empty target and has no template or framework
option. It does not initialise Git. Its closing hint prints `npx cf dev`;
use `pnpm run dev`.

## Generated contract

- `cloudflare.config.ts` from `cf/config`, with the entrypoint imported
  `with { type: "cf-worker" }` and one example text binding.
- `vite.config.ts` with the Cloudflare Vite plugin; no Wrangler and no
  Wrangler config.
- `src/index.ts` reading `env` from `cloudflare:workers`.
- Scripts `dev: cf dev`, `build: cf build`, `deploy: cf deploy` and
  `typecheck: cf workers types && tsc`.
- `.gitignore` already covers `.cloudflare/`.
- `pnpm-workspace.yaml#allowBuilds` approves esbuild and workerd.

## House delta

- Pin `cf` and `@cloudflare/vite-plugin` to exact versions. The scaffold
  writes a caret range on the `cf` prerelease and the plugin's moving `beta`
  dist-tag.
- Review each `allowBuilds` entry with `supply-chain-hardening`.
- Add a real test and native test script, numeric mise selectors, exact
  `packageManager`, lockfile, canonical pnpm lifecycle checker and hk wiring.

## Proof

```sh
pnpm run typecheck
pnpm run build
pnpm run deploy --dry-run
```

The dry run lists the bindings and makes no API calls. Run `pnpm run dev` and
request `/` for a 200. After an authorised deployment, smoke the public route.

Sources: [cf first Worker](https://developers.cloudflare.com/cf/get-started/first-worker/),
[cf projects](https://developers.cloudflare.com/cf/projects/).
