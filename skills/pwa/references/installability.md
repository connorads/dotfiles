# Installability per engine

"Installable" means something different in each engine. The published criteria
(web.dev install-criteria, MDN) still state a 192+512 icon rule and a service
worker requirement; neither is what stable Chrome enforces.

## Chrome and Edge (desktop and Android)

Observed on Chrome 154 stable, macOS, 2026-09-24, via
`Page.getInstallabilityErrors` with `beforeinstallprompt` as a second signal:

| Manifest | Result |
|---|---|
| one `any` icon 144px | installable |
| one `any` icon 143px | `manifest-missing-suitable-icon`, `no-acceptable-icon` (min 144) |
| only a 512 `maskable` icon | same errors: not installable |
| 192 + 512 `any`, **no service worker** | installable |

So the gate is: a manifest with a name, a supported `display`, and one
`purpose: any` icon >= 144px. The service worker requirement was removed in
Chrome 108 (Android) and 112 (desktop). A worker is still needed for offline and
for Android's WebAPK crash rules in a TWA ([store.md](store.md)).

If an install option does not appear, read the errors rather than guessing:
DevTools > Application > Manifest > Installability, or the CDP call in
[verify.md](verify.md#installability-in-ci).

Other facts (documented):

- `beforeinstallprompt` is Chromium-only and never fires when the app is
  installed. Every other engine needs a written "how to install" hint.
- `prefer_related_applications: true` with a listed app suppresses the
  automatic prompt; the app stays installable from the menu.
- **Android WebAPK**: only Chrome (with Google Play services) and Samsung
  Internet mint a real WebAPK; other browsers add a shortcut. Chrome re-reads
  the manifest about once a day, backing off to 30 days on failure, and applies
  an update only when every app window is closed. `about://webapks` shows the
  installed values and can schedule an update.

## Safari

- **iOS/iPadOS/macOS 26**: zero install requirements. Every site added to the
  Home Screen opens as a web app unless the user turns off "Open as Web App".
  An address bar on iOS 26 is that toggle or an old shortcut, not a missing
  tag. (documented: WebKit blog, 2025-09-15)
- Add to Home Screen works from Chrome, Edge, Firefox and Orion on iOS 16.4+.
- macOS: File > Add to Dock, with or without a manifest (Safari 17+).
- No install prompt API exists.

## Firefox

Desktop Firefox does not install from a manifest. Taskbar Tabs (Firefox 143,
Windows) pins a site window without reading the manifest. Firefox for Android
adds to the home screen. (documented)
