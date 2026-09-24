# Service workers and caching

Caching rules that decide what an installed user sees offline and after a
deploy. Update mechanics are in [updates.md](updates.md).

## Contents

- [Does this app need a caching worker?](#does-this-app-need-a-caching-worker)
- [Strategy per content type](#strategy-per-content-type)
- [navigateFallback and the denylist](#navigatefallback-and-the-denylist)
- [Opaque responses and quota](#opaque-responses-and-quota)
- [Scope and registration](#scope-and-registration)
- [Removing a service worker](#removing-a-service-worker)

## Does this app need a caching worker?

- **Push only**: a hand-written worker with `push` and `notificationclick`
  handlers and **no fetch handler**. Chrome installs without a worker.
- **Offline**: a generated worker (Workbox via vite-plugin-pwa, or Serwist).
- **Neither**: ship the manifest alone; the app still installs in Chrome.

## Strategy per content type

- Hashed static assets: `CacheFirst` (or precache).
- HTML navigations: `NetworkFirst`, or `NetworkOnly` with a precached offline
  page. Never cache-first HTML: users keep the old page and its old asset list.
- Server-rendered, per-user HTML: `NetworkOnly`. Workbox caches regardless of
  `Cache-Control: private, no-store`, so `NetworkFirst` would store one user's
  page and replay it offline.
- API responses: `NetworkFirst` with a timeout, or not cached.

## navigateFallback and the denylist

`navigateFallback` (Workbox `NavigationRoute`) answers **navigations** from the
precached shell. It never touches `fetch()`/XHR. Observed with vite-plugin-pwa
1.3.0 on Chrome 154 (2026-09-24), denylist `[/^\/api\//]`:

- navigating to `/auth/cb?code=1` returned the app shell; the server never saw it;
- `fetch('/api/x')`, `fetch('/auth/cb?code=1')` and a `fetch` to an unlisted
  404 path all reached the server;
- adding `/^\/auth\//` to the denylist sent the navigation to the server.

So list **every path the server answers as a document**: OAuth/OIDC callbacks,
server-rendered routes, webhooks, `/health`, admin. On TanStack Start add
`/^\/_serverFn\//`. On an SSR app with no static shell, skip
`navigateFallback` and use `NetworkOnly` for navigations plus a precached
offline page.

Workbox's `setCatchHandler` sees only requests a route already tried; add a
`setDefaultHandler` if the offline page must cover unmatched requests.

## Opaque responses and quota

A cross-origin `no-cors` response is opaque (status 0), and Chrome pads its
quota cost. Observed on Chrome 154 (2026-09-24): five cached 2 KB opaque
responses raised `navigator.storage.estimate().usage` by 46 MB (~9 MiB each);
five 2 KB CORS responses raised it by 14 KB.

Workbox 7.4.1 defaults (read from `workbox-strategies` source):

- `CacheFirst`: caches status 200 only - refuses opaque.
- `NetworkFirst`, `StaleWhileRevalidate`: prepend `cacheOkAndOpaquePlugin`,
  which **caches status 0**.

So a `StaleWhileRevalidate` route over a third-party CDN fills quota fast, and
eviction deletes the **whole origin's** storage at once. Fix: request with
CORS where the host allows it, or bound the cache with `ExpirationPlugin`
(`maxEntries`, `purgeOnQuotaError: true`), or add `CacheableResponsePlugin({
statuses: [200] })`.

`navigator.storage.persist()` may return `false`; Chrome and Safari decide
silently. Treat that as normal.

## Scope and registration

- Default scope is the script's own directory. A wider scope needs the
  `Service-Worker-Allowed` header on the script, or `register()` rejects.
- Register from the page the host actually serves. On frameworks without an
  `index.html` (TanStack Start, Foldkit SSR) the plugin's HTML injection never
  runs: register from client code (`virtual:pwa-register`).
- Background sync, periodic sync and background fetch are Chrome/Edge only
  (webstatus "limited", 2026-09-22). Push is widely available.

## Removing a service worker

Deploy a worker **at the same URL** that installs, activates immediately, has
no fetch handler, deletes its caches, and unregisters:

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
```

The widely copied self-destroying recipe omits the `caches.delete` loop.
Deleting `sw.js` instead leaves some engines running the old worker.
