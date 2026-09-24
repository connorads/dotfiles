# Toolchain per framework

The fastest-rotting content in this skill. Re-check versions with
`pnpm view <pkg> version time.modified` before pinning; the figures below are
verified 2026-09-24.

## Contents

- [Package state](#package-state)
- [Vite SPA](#vite-spa)
- [Next.js](#nextjs)
- [TanStack Start](#tanstack-start)
- [Foldkit](#foldkit)
- [Others](#others)

## Package state

| Package | Latest | Published | State |
|---|---|---|---|
| `vite-plugin-pwa` | 1.3.0 | 2026-05-05 | maintained; defaults `registerType: 'prompt'` |
| `workbox-*` | 7.4.1 | 2026-05-04 | maintained, not developed |
| `serwist`, `@serwist/next`, `@serwist/vite` | 9.5.12 | 2026-07-22 | one maintainer, monthly cadence |
| `next-pwa` | 5.6.0 | 2022-08-23 | unmaintained |
| `@ducanh2912/next-pwa` | 10.2.9 | 2024-09-18 | unmaintained |

**Install gotcha**: `workbox-build` 7.4.1 depends on
`@trickfilm400/rollup-plugin-off-main-thread@^3.0.0-pre1`, a personal-scope
prerelease fork. pnpm's `trustPolicy: no-downgrade` refuses to install
`vite-plugin-pwa` until that package is in `trustPolicyExclude`. That exclusion
is the user's supply-chain decision: surface it, do not add it silently.

## Vite SPA

`vite-plugin-pwa` with `generateSW`, the manifest in `vite.config`, and the
plugin-injected link and registration. Render the prompt component, or every new
worker waits forever. Denylist every server-owned navigation
([service-workers.md](service-workers.md#navigatefallback-and-the-denylist)).

## Next.js

The official guide ships a manifest (`app/manifest.ts`) and a push-only worker,
and defers offline caching to Serwist. Use `@serwist/next` for caching. The
`next-pwa` forks are webpack plugins; Next 16 builds with Turbopack.

## TanStack Start

Observed 2026-09-24 on `@tanstack/react-start` 1.168.56, Nitro
3.0.260311-beta, Vite 8.3.0, `vite-plugin-pwa` 1.3.0:

| Config | Exit | Result |
|---|---|---|
| `VitePWA({ registerType, manifest: {...} })` | 0 | writes `dist/sw.js`; served `.output/public/` has `registerSW.js` pointing at `/sw.js` and **no `sw.js`** |
| `VitePWA({ manifest: false })` | 1 | Workbox: "Couldn't find configuration for either precaching or runtime caching" |
| recipe below | 0 | `.output/public/sw.js` present, shell precached, denylist in place |

Nitro moves the client build to `.output/public/`; the plugin writes to Vite's
top-level `outDir`. Tracked in TanStack/router#4988 (open). Start has no
`index.html`, so the plugin's HTML injection never runs either.

Recipe (SPA mode; pure SSR has no static shell to fall back to):

```ts
// vite.config.ts
tanstackStart({ spa: { enabled: true } }),
nitro(),
VitePWA({
  registerType: 'autoUpdate',
  injectRegister: null,
  outDir: '.output/public',
  integration: { closeBundleOrder: 'pre' },
  manifest: { /* ... */ },
  workbox: {
    navigateFallback: '/_shell.html',
    navigateFallbackDenylist: [/^\/api\//, /^\/_serverFn\//],
    // Nitro writes _shell.html after the plugin's glob runs.
    additionalManifestEntries: [{ url: '/_shell.html', revision: process.env.BUILD_ID ?? String(Date.now()) }],
  },
}),
```

```tsx
// src/client.tsx - register here; there is no index.html to inject into
import { StartClient } from '@tanstack/react-start/client'
import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })
hydrateRoot(document, <StrictMode><StartClient /></StrictMode>)
```

Add `workbox-window` as a direct dependency: `virtual:pwa-register` imports it,
and under pnpm's strict layout the build otherwise fails with `Rolldown failed
to resolve import "workbox-window"`.

Put the manifest link in `__root.tsx`'s `head().links`. Then run
`pwa-check.mjs --dir .output/public`; exit 1 means the worker is not where
Nitro serves from. Escape hatch: skip the plugin and run `workbox-build`
`generateSW` against `.output/public` after `vite build`. On Rsbuild, no Vite
plugin applies.

## Foldkit

Observed 2026-09-24 on `foldkit` 0.163.0, `@foldkit/vite-plugin` 0.24.0 (SSR
example): HTML rendered by build A with JS from build B left the body `inert`,
`aria-hidden`, marked `data-foldkit-refused`, behind a dialog "This page could
not start safely. Reload to get the current version." Clicks did nothing and it
did not recover. Every local build mints a new `FOLDKIT_BUILD_ID`.

- **SPA mode**: the Vite SPA path.
- **SSR/SSG**: no `navigateFallback`; `NetworkOnly` for navigations; an offline
  page precached with the same build id as its JS; register from the client
  entry (the build deletes `index.html` from the client bundle).

Foldkit is pre-1.0 with experimental SSR; re-check against the current minor.

## Others

- **SvelteKit**: built-in `src/service-worker.js` and `$service-worker`.
- **Angular**: `@angular/service-worker` with `SwUpdate`.
- **Astro, Nuxt**: `@vite-pwa/astro`, `@vite-pwa/nuxt`.
- **React Router 7**: no maintained integration; use the Vite SPA path.
