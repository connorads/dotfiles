# Cloudflare static Astro

Recipe ID: `cloudflare-astro-static`

Last verified: 2026-09-04 against current `create-astro` help and the Cloudflare
Workers static-assets contract.

## Scaffold

Use Astro directly. C3 selects Astro's Cloudflare adapter and produces an SSR
Worker, which is the wrong starting point for a static-only site.

```sh
pnpm create astro@latest <name> --template minimal --no-install \
  --no-git --no-ai --yes --skip-houston
```

Install only after inspecting the pristine output and repository lifecycle
policy.

## Platform wiring

Keep Astro in static output mode. Do not add `@astrojs/cloudflare`. Add a
Workers assets-only `wrangler.jsonc` whose assets directory is `./dist`, then
use native scripts for build and Wrangler deployment.

Astro's checker still depends on TypeScript APIs removed in TypeScript 7.
Select TypeScript 6 for `astro check` until Astro's language tools declare
TypeScript 7 support. Recheck this constraint against the installed source
whenever revising the recipe.

## House delta and proof

- Add numeric Node and pnpm selectors, exact `packageManager`, lockfile,
  lifecycle decisions and hk wiring.
- Run `astro check`, tests if authored, and `astro build`.
- Confirm `dist/` contains the expected entry document and assets.
- Rehearse with `pnpm exec wrangler deploy --dry-run` only after the build.
- After an authorised deployment, request the public root and a real asset.

Sources: [create-astro README](https://github.com/withastro/astro/blob/main/packages/create-astro/README.md),
[Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/).
