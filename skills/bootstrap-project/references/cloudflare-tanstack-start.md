# Cloudflare platform wiring (blessed path: TanStack Start)

Last verified: 2026-07. If anything below contradicts what you observe during
a bootstrap, update this file to match reality (see "Keep references honest"
in SKILL.md).

## Scaffold

```bash
pnpm create cloudflare@latest <name> --framework=tanstack-start
```

- c3 **delegates to each framework's own CLI** and layers Cloudflare config on
  top, so output tracks upstream framework releases rather than lagging them.
- Defaults to a **Workers** project; Pages requires an explicit
  `--platform=pages` (don't - Workers is the current platform).
- Other frameworks: `--framework=<x>` (c3 lists them); the platform wiring
  below applies broadly, the TanStack specifics don't.

## What the TanStack Start scaffold gives you

- `wrangler.jsonc` with `compatibility_flags: ["nodejs_compat"]`,
  `observability.enabled`, and `main: "@tanstack/react-start/server-entry"`.
- `@cloudflare/vite-plugin` wired in `vite.config`:
  `cloudflare({ viteEnvironment: { name: "ssr" } })` alongside
  `tanstackStart()` and `react()`. The Vite plugin is the current recommended
  Cloudflare setup - not the older Wrangler-only flow.
- Static assets served from `.output/public` via Workers assets.
- A `deploy` script: build + `wrangler deploy`.

## Known gaps (post-scaffold steps)

- **No bindings are scaffolded.** D1 / KV / R2 / Durable Objects must be added
  to `wrangler.jsonc` by hand; access them via `import { env } from
  "cloudflare:workers"`. Run `wrangler types` afterwards to regenerate the
  `Env` types.
- Prerendering needs `@tanstack/react-start` >= 1.138.0.

## Churn watch

- TanStack's own scaffolder migrated `@tanstack/create-start` → the unified
  `@tanstack/cli` (`pnpm dlx @tanstack/cli create`). Prefer c3 regardless - it
  delegates upstream *and* wires the Cloudflare layer.
- Wrangler can auto-detect TanStack Start and synthesise config if none
  exists; a scaffolded `wrangler.jsonc` still beats relying on that.

## Deploy

Route to the `cloudflare-workers-deployments` skill: it owns the choice
between Workers Builds (Cloudflare-hosted, Git-connected) and local
`wrangler deploy`, plus custom domains and Access.

## Watch-item: Alchemy (alchemy.run)

TypeScript-native IaC that replaces `wrangler.jsonc` as the source of truth -
resources declared in an `alchemy.run.ts` script, deployed via the Cloudflare
API, env types inferred with no codegen. Not the blessed path because (as of
mid-2026, v0.93): pre-1.0 with a parallel v2 rewrite on Effect in flight, and
TanStack Start supported only via example repos, not a first-class create
template. It still uses wrangler for local dev.

Re-evaluate when any of: v1.0 ships, the v2/Effect line settles as the single
line, or a first-class TanStack Start template appears in `alchemy create`.
