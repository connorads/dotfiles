# Manifest

What each member does, which engine reads it, and which decisions cannot be
undone for users who already installed.

## Contents

- [Identity: id, start_url, scope](#identity-id-start_url-scope)
- [Icons](#icons)
- [Screenshots and the richer install dialog](#screenshots-and-the-richer-install-dialog)
- [Serving the manifest](#serving-the-manifest)
- [Members by engine](#members-by-engine)

## Identity: id, start_url, scope

These three are fixed for the installed cohort; decide them before first release.

- **`id`** names the app. Absent, it defaults to the resolved `start_url`, so
  shipping without `id` and later changing `start_url` creates a *second* app
  for everyone already installed. A supplied `id` is resolved against the
  start_url's **origin** (not its directory) and dropped silently if
  cross-origin. For an app already published without `id`, set `id` to what
  DevTools > Application > Manifest reports as *Computed App Id*, not to a new
  value. (documented: W3C manifest; developer.chrome.com pwa-manifest-id)
- **`scope`** matches by raw string prefix: `/app` also matches `/app-admin/`.
  End it with `/`. Absent, it is the parent path of `start_url`. (documented)
- **`start_url`** is where launch lands. Adding a tracking query to it changes
  identity only when `id` is absent.

Changing `name`, `short_name` or `icons` asks the user for permission before it
applies; every other member updates silently. On Android the WebAPK re-reads the
manifest about once a day (see [installability.md](installability.md)).

## Icons

- Chrome's install gate is **one `purpose: "any"` icon of at least 144px**, or
  `sizes: "any"` (vector). A set whose only large icon is `maskable` is **not
  installable**; 143px fails with `minimum-icon-size-in-pixels=144`. (observed,
  Chrome 154 stable, 2026-09-24)
- Ship 192 and 512 `any` icons plus a separate 512 `maskable` icon anyway: the
  sizes feed launchers and splash screens, not the gate.
- An unrecognised `purpose` token (a typo like `maskabel`) makes the icon
  **ignored entirely**, with no error. Valid tokens: `any`, `maskable`,
  `monochrome`. (documented)
- Maskable safe zone: a centred circle, radius 40% of the smaller side. Keep
  the mark inside it.
- Declared `sizes` must match the file's real pixels; the checker compares them.
- Generate the set with `@vite-pwa/assets-generator` or `sharp` rather than
  writing an image pipeline.
- iOS: see [ios.md](ios.md#icons).

## Screenshots and the richer install dialog

Without `screenshots` Chrome shows the plain install prompt. With them, it shows
the richer dialog. Rules (documented: web.dev richer-install-ui):

- `form_factor: "wide"` for desktop, `"narrow"` for mobile. Desktop Chrome
  (109+) shows only `wide`.
- 320-3840px per side; longest side at most 2.3x the shortest.
- One aspect ratio per form factor; PNG or JPEG only.
- Up to 8 shown on desktop, 5 on Android.
- `description` is truncated at roughly 324 characters.

Play Store listing screenshots have a different ratio rule (2x); see
[store.md](store.md).

## Serving the manifest

- The response must have a JSON MIME type (`application/manifest+json` is the
  registered one); anything else is discarded. (documented: HTML spec)
- Only the **first** `<link rel="manifest">` in tree order counts. A `Link:`
  HTTP header does nothing.
- `.webmanifest` is the registered extension; `.json` also works.

## Members by engine

"Is it in the spec?" is the wrong question: the members are split across the W3C
manifest, W3C manifest-app-info, WICG incubations and vendor docs. Ask which
engine reads it and what happens where it is ignored.

| Member | Chromium | Safari | Firefox |
|---|---|---|---|
| `display: standalone` | yes | yes (only `standalone`/`browser`) | no desktop install |
| `display_override` | yes; only the first recognised entry counts, and `"browser"` first makes the app not installable | ignored | ignored |
| `shortcuts` | yes | macOS 17.4+ only | no |
| `screenshots`, `description` | richer install dialog | no | no |
| `orientation` | yes | no | no |
| `launch_handler`, `file_handlers`, `protocol_handlers`, `share_target` | yes | no | no |
| `scope_extensions` | Chrome 138+ | no | no |
| `edge_side_panel` | deprecated | - | - |

(documented: MDN browser-compat-data, verified 2026-09-22)
