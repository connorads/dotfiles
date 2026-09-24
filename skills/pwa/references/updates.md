# Updates

How a deploy reaches users who already have the previous worker.

## How the browser finds a new worker

- The browser compares `sw.js` byte for byte on every in-scope navigation,
  on functional events (at most once a day), and on `registration.update()`.
- `updateViaCache` defaults to `"imports"`: the main script is fetched past
  the HTTP cache on every check. Observed on Chrome 154 (2026-09-24) with
  `sw.js` served `Cache-Control: max-age=86400`: the next navigation refetched
  it and the new worker reached `waiting`. With `updateViaCache: 'all'` the
  same header held the old script and no update was found.
- So the header that matters is at the **CDN edge**, which honours `max-age`
  and `s-maxage` for its own copy: serve `sw.js` `Cache-Control: no-cache` at
  the origin *and* the CDN, and check it on the **emitted** URL
  (`pwa-check.mjs --url`). `updateViaCache: 'none'` adds `importScripts()` to
  the bypass; it does nothing about the edge.
- Keep `sw.js` at one URL and never content-hash its name. An old cached page
  pointing at a different worker URL can never discover the new one.

## The waiting worker

A new worker waits until no tab uses the old one; a reload does not end that.
Either prompt (`registerType: 'prompt'`, call `updateServiceWorker(true)` on
accept) or auto-update (`skipWaiting` + `clientsClaim`, then reload on
`controllerchange` with a guard). Prompt is the default when users can have
unsaved state.

Long-lived tabs and iOS Home Screen apps resume without navigating, so they
rarely trigger a check: call `registration.update()` on `visibilitychange` and
on an interval.

## Stale chunks after a deploy

A tab on the old build lazy-loads a chunk the new deploy deleted. Vite emits
`vite:preloadError` for this; reload on it, and keep the previous deploy's
assets available for a while.

## Framework notes

- **Foldkit SSR/SSG**: an old page with new JS is refused terminally (see
  [toolchain.md](toolchain.md#foldkit)), so an update must never serve cached
  HTML from one build to JS from the next.
- **TanStack Start**: the SW must be emitted into the served directory before
  any of this applies ([toolchain.md](toolchain.md#tanstack-start)).
