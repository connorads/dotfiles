# iOS and iPadOS

Every claim here is **documented, not observed**: no device ran for this skill.
Say so when it matters to the answer, and ask for a device check.

## Install and standalone

- iOS/iPadOS 26 (2025-09-15): zero install requirements. Every site added to
  the Home Screen opens as a web app unless the user switched off "Open as Web
  App". (WebKit blog 17333)
- `apple-mobile-web-app-capable` has not been the standalone switch since iOS
  11.3; its remaining job is enabling `apple-touch-startup-image`.
- No install prompt API: show a hint when `navigator.standalone === false` and
  not `matchMedia('(display-mode: standalone)').matches`.

## Icons

- Manifest `icons` are used when **no `apple-touch-icon` is present** and the
  icon's `purpose` is `any` or unset (Safari iOS 15.4+). `apple-touch-icon`
  takes precedence when both exist. The screenshot fallback needs both absent
  or both unreachable. (BCD `manifests/webapp/icons.json`, WebKit blog 12445)
- So a maskable-only manifest set on a site with no touch icon gets a
  screenshot. Ship a 180px opaque `apple-touch-icon` anyway.
- Check the icon URL returns an image: an SPA catch-all that answers
  `/apple-touch-icon.png` with `index.html` is a common cause.
- Safari 26 accepts SVG and `data:` manifest icons.
- The Home Screen icon is captured when added; users re-add to pick up a change.

## Status bar and safe areas

- `apple-mobile-web-app-status-bar-style: black-translucent` draws content
  under the status bar with a transparent background, and **`theme-color` is
  ignored in that mode**. It goes with `viewport-fit=cover` and
  `env(safe-area-inset-*)` padding, or not at all. (web.dev learn/pwa)
- iOS builds no splash screen from the manifest; only
  `apple-touch-startup-image` per device size.

## Storage

- Script-writable storage (Cache API, IndexedDB, localStorage, SW
  registration) is evicted after seven days of use without user interaction.
  Home Screen apps are **not exempt**; they keep their own counter. (WebKit
  blog 14403)
- Safari and the installed Home Screen app do not share storage, so the user
  signs in again after installing.

## Push (client side)

- Web Push works only for Home Screen web apps (iOS 16.4+), and the permission
  request must come from a user gesture. On iOS, push and install are one
  decision.
- Declarative Web Push: iOS/iPadOS 18.4+, macOS Safari 18.5+. The payload is
  JSON with `"web_push": 8030` and a `notification` object with `title` and
  `navigate`; it displays without a service worker. Keep a `push` handler for
  older engines, which receive the same payload imperatively. (WebKit blog 16535)
- Server-side sending (VAPID, subscription storage) is out of scope.
