---
name: pwa
description: >-
  Builds, fixes and verifies Progressive Web Apps: the manifest and what each
  engine requires to install, service worker caching and updates for users who
  already installed, offline fallback, client-side push, and Play Store
  wrappers (TWA). Use when the user says make it a PWA, installable, add to
  home screen, install prompt, offline, service worker, workbox, serwist,
  vite-plugin-pwa, web push, TWA, Bubblewrap or assetlinks; when users are
  stuck on an old deploy, an update never lands, an OAuth callback returns the
  app shell, QuotaExceededError appears, the iPhone icon is a screenshot or
  the app opens with an address bar; for PWAs on Vite, Next.js, TanStack Start
  or Foldkit; or to verify a PWA now Lighthouse has no PWA category. Not for
  first-load rendering (flashes, CLS, LCP), which is web-perf, or for
  configuring a host's headers, which is cloudflare-workers-deployments.
---

# PWA

> **Which engine reads this, and what happens to the user who already
> installed the previous build?**

The first half settles every manifest and install question: behaviour differs
per engine and has changed more than once, so the published docs and the
model's memory both lag. The second half settles every caching and deploy
question: a PWA is the web app whose users keep yesterday's code, so every
change is judged by what it does to the installed cohort, not a first visit.

## Stale beliefs to drop

Each row was reproduced by agents working without this skill.

| Belief | Current fact | Evidence |
|---|---|---|
| Verify with Lighthouse's PWA audit | Lighthouse has no PWA category since 12.0.0 (2024-04-22); 13.5.0 rejects `--only-categories=pwa`. Verify per [Prove it](#prove-it) | observed 2026-09-24 |
| iOS ignores manifest icons | Safari uses manifest `icons` when no `apple-touch-icon` exists and `purpose` is `any` or unset (iOS 15.4+); `apple-touch-icon` wins when both exist. Still ship the touch icon; check `purpose` when the manifest is the only source | documented |
| A long `Cache-Control` on `sw.js` delays updates in the browser | `updateViaCache` defaults to `imports`: the browser refetches `sw.js` past its HTTP cache on every in-scope navigation. The header bites only at a **CDN edge** that honours `max-age`/`s-maxage`, or under `updateViaCache: 'all'` | observed, Chrome 154 |
| Denylisting `/api/` keeps API calls away from the shell | `navigateFallback` answers **navigations** only; `fetch()` never gets the shell. What `/api/`-only misses is every other navigation the server owns: OAuth/OIDC callbacks, server-rendered routes, webhooks, admin pages | observed |
| The manifest is complete once installable | Without `screenshots` Chrome shows the plain install prompt, not the richer dialog | documented |

## Scope

This skill owns install, the manifest, the service worker, offline, updates,
client-side push and store wrappers. It stops at:

- **web-perf** - the first load of a route with no service worker in control.
  A worker that changes first paint is a web-perf symptom whose cause lives here.
- **cloudflare-workers-deployments** (or the host's docs) - how a header lands
  at the edge. This skill names the header and the emitted URL it must be on.
- **Server-side push** - VAPID keys, subscription storage, sending.

## Wire it into the framework you have

Detect the framework and build tool from the repo before recommending anything.
One default each; the escape hatch is for when the default does not fit.

- **Vite SPA** (React, Vue, Svelte without Kit): `vite-plugin-pwa`,
  `generateSW`, `registerType: 'prompt'` with a rendered prompt.
  Escape hatch: `injectManifest` for custom fetch logic.
- **Next.js**: manifest via the App Router `manifest.ts`; caching via Serwist
  (`@serwist/next`). `next-pwa` and `@ducanh2912/next-pwa` are unmaintained
  webpack plugins - do not add them. Escape hatch: a hand-written push-only
  worker when there is no offline requirement.
- **TanStack Start**: a typical `VitePWA()` config **builds green but writes
  `dist/sw.js`, outside the `.output/public/` Nitro serves**, while
  `registerSW.js` still points at `/sw.js`. Default: the SPA-mode recipe in
  [references/toolchain.md](references/toolchain.md), then assert the file
  landed. Escape hatch: generate the worker with `workbox-build` from a
  post-build step. Rsbuild builds get no Vite plugin at all.
- **Foldkit**: SPA mode is the Vite SPA path. In SSR/SSG mode a page from one
  build with JS from another is refused terminally (inert page, shield dialog,
  no recovery), so never serve cached HTML across deploys: navigations
  `NetworkOnly`, offline fallback a page precached with the same build id.

Look up every version before pinning it (`pnpm view <pkg> version time.modified`);
recall is always behind. See [references/toolchain.md](references/toolchain.md).

## Rules that hold regardless of tool

- **Denylist every navigation the server owns** from `navigateFallback`, not
  just `/api/`. An OAuth callback answered by the shell never exchanges its code.
- **Never runtime-cache cross-origin `no-cors` responses without a bound.** Each
  opaque entry costs megabytes of quota in Chrome (2 KB responses measured
  ~9 MiB each). Workbox `NetworkFirst` and `StaleWhileRevalidate` cache opaque
  responses **by default**; only `CacheFirst` refuses them. Pair with
  `ExpirationPlugin` `maxEntries` and `purgeOnQuotaError: true`, or use CORS.
- **Keep `sw.js` at one stable URL** and serve it `Cache-Control: no-cache`
  from the CDN too - the browser skips its own cache, the edge does not.
- **Judge every caching change by the installed cohort**: what does a user on
  the previous worker see after this deploy, online and offline?

## Prove it

Lighthouse has no PWA audit. Run these instead:

1. Build, then run the checker on the directory the host serves (EXECUTE):
   `node <skill-dir>/scripts/pwa-check.mjs --dir <deployed-output-dir>`.
   Add `--url <origin>` once deployed, to read headers on the emitted URLs.
   Exit 1 means a FAIL: most often a registered worker missing from the served
   directory. Fix before anything else.
2. Prove installability in Chrome: DevTools > Application > Manifest
   (Installability section), or `Page.getInstallabilityErrors` over CDP in CI
   ([references/verify.md](references/verify.md)).
3. Prove updates: deploy twice with a tab open and watch the new worker reach
   `waiting` and the prompt appear.
4. iOS, Android WebAPK and store builds need a real device; state which
   checks ran and which did not.

## References

| When the task involves... | Read |
|---|---|
| Manifest members, `id`/`scope`/`start_url`, icons, screenshots | [references/manifest.md](references/manifest.md) |
| Why an install prompt or install option does not appear, per engine | [references/installability.md](references/installability.md) |
| Caching strategies, `navigateFallback`, offline fallback, quota, removing a worker | [references/service-workers.md](references/service-workers.md) |
| Users stuck on an old deploy, the waiting worker, update prompts, CDN headers | [references/updates.md](references/updates.md) |
| Which plugin per framework, versions, the TanStack Start and Foldkit recipes | [references/toolchain.md](references/toolchain.md) |
| iPhone/iPad: Home Screen apps, icons, status bar, storage, push | [references/ios.md](references/ios.md) |
| Play Store / TWA / Bubblewrap / PWABuilder / `assetlinks.json`, App Store | [references/store.md](references/store.md) |
| Verifying in CI or by hand, Playwright constraints, device checklist | [references/verify.md](references/verify.md) |

`scripts/check-currency.mjs` re-checks the dated claims listed in
`scripts/currency-claims.json` (maintenance, not project work);
`tests/pwa-check.bats` covers the checker; `evals/evals.json` holds the test
prompts. Evidence labels:
**observed** = reproduced on a real build or stable browser on the date given;
**documented** = vendor docs or spec only, not observed here.
