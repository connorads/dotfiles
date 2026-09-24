# Verify

Lighthouse removed its PWA category in 12.0.0 (2024-04-22); 13.5.0 lists no
install, manifest or service-worker audit and rejects `--only-categories=pwa`
(observed 2026-09-24). A CI step asserting `categories.pwa.score` reads
`undefined`. Verify with these instead.

## Contents

- [The build output](#the-build-output)
- [Installability in CI](#installability-in-ci)
- [By hand in DevTools](#by-hand-in-devtools)
- [Updates](#updates)
- [Playwright constraints](#playwright-constraints)
- [Device checklist](#device-checklist)

## The build output

`node <skill-dir>/scripts/pwa-check.mjs --dir <deployed-output-dir> [--url <origin>]`

It checks the manifest link and JSON, the 144px `any` icon gate, declared vs
real icon sizes, `purpose` typos, `display_override`, screenshot geometry, that
every registered worker exists in the served directory, the `navigateFallback`
denylist, and with `--url` the manifest Content-Type and the worker's
Content-Type and Cache-Control on the deployed origin. Exit 1 on any FAIL.
Point `--dir` at what the host serves (`dist/`, `.output/public/`, `out/`), not
the source tree.

## Installability in CI

Chrome's own evaluator over CDP, the same one DevTools shows:

```js
// Node 22+ (global WebSocket). Chrome started with --remote-debugging-port=9222
// (any free port; match it below) and its own --user-data-dir.
const [page] = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const send = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  ws.addEventListener('message', function on(e) {
    const m = JSON.parse(e.data);
    if (m.id === n) { ws.removeEventListener('message', on); resolve(m.result); }
  });
  ws.send(JSON.stringify({ id: n, method, params }));
});
await send('Page.navigate', { url: process.argv[2] });
await new Promise((r) => setTimeout(r, 2500));
const { installabilityErrors } = await send('Page.getInstallabilityErrors');
console.log(JSON.stringify(installabilityErrors));
process.exit(installabilityErrors.length ? 1 : 0);
```

An empty list means installable. Validate the probe once against a page with no
manifest: it must report `no-manifest`, or an empty result proves nothing.
Playwright's Chromium exposes the same call through `page.context().newCDPSession(page)`.

## By hand in DevTools

Application panel:

- **Manifest**: the Installability section lists the same errors; *Computed App
  Id* is the identity to keep; the maskable preview shows the safe zone.
- **Service workers**: *Update on reload*, *Bypass for network*, and the waiting
  worker's *skipWaiting*. *Stop* exposes state kept in module scope.
- **Storage**: *Clear site data* unregisters and clears in one step.

Android: `about://webapks` shows installed WebAPK values and schedules an
update. Desktop: `chrome://web-app-internals`.

## Updates

1. Serve build N; open it; confirm the worker is active and controlling.
2. Deploy build N+1 with a tab still open.
3. Navigate once within scope: the new worker must reach `waiting` and the
   prompt must appear in that session, with no second reload.
4. Accept: the page reloads onto N+1, and no request 404s on an old chunk.

## Playwright constraints

- Service workers are Chromium-only in Playwright.
- `page.route()` does not see requests a worker's fetch handler answered; set
  `serviceWorkers: 'block'` when a test relies on interception, and test the
  worker in a separate suite.
- Cache storage and registrations outlive a page; use a fresh context per test.

## Device checklist

State which of these ran; do not imply the rest.

- iOS: add to Home Screen, icon, standalone launch, status bar, safe areas,
  push permission from a gesture.
- Android: install, WebAPK in `about://webapks`, maskable icon crop, offline launch.
- TWA: installed from the Play test track, no address bar.
