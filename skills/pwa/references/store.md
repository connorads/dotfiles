# Store packaging

Wrapping an installed PWA for Google Play (a Trusted Web Activity) and why the
App Store has no equivalent. Every claim here is **documented, not observed**:
no device or Play Console ran for this skill.

## Contents

- [What a TWA is](#what-a-twa-is)
- [The fingerprint that must be in assetlinks.json](#the-fingerprint-that-must-be-in-assetlinksjson)
- [Hosting assetlinks.json](#hosting-assetlinksjson)
- [Address bar visible: troubleshooting order](#address-bar-visible-troubleshooting-order)
- [Bubblewrap and PWABuilder](#bubblewrap-and-pwabuilder)
- [Listing, review, updates](#listing-review-updates)
- [iOS](#ios)
- [Shipping procedure](#shipping-procedure)

## What a TWA is

A Custom Tabs mode, not a WebView: the user's browser renders the live site
full screen. Storage is the browser's; the Android host app cannot read cookies
or `localStorage`. The browser UI is hidden only when Digital Asset Links
verification passes at launch; otherwise a Custom Tab with an address bar shows.
Chrome 72+ supports it; other browsers may.

Since Chrome 86 a failed verification, an HTTP 404/5xx, or an offline request
that does not return 200 counts as a crash in Android vitals. A service worker
with an offline fallback prevents the last one.

## The fingerprint that must be in assetlinks.json

**List Google Play's app signing key**, not only the upload key Bubblewrap or
PWABuilder generated. With Play App Signing, Play re-signs the bundle, so the
installed APK carries a different certificate from the local build. The failure
hides until release: a sideloaded build verifies, and the Play install shows an
address bar.

Get the key from Play Console > Protect with Play > Play app signing (PWABuilder
docs: Setup > App integrity > App signing). List both fingerprints:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.example.app",
    "sha256_cert_fingerprints": ["<PLAY_APP_SIGNING_SHA256>", "<UPLOAD_KEY_SHA256>"]
  }
}]
```

Sources: Play Console help (app signing) and Bubblewrap/PWABuilder docs.
PWABuilder's Android output is Bubblewrap, so those two count as one source.

## Hosting assetlinks.json

- At `https://<domain>/.well-known/assetlinks.json` - the origin root, even
  when the PWA lives under a subpath.
- HTTP 200 only; no redirects (301/302 are not followed).
- `Content-Type: application/json`, valid TLS.
- A cross-origin redirect (bare domain to `www`) breaks verification even with
  correct JSON. Package the canonical origin: follow redirects with `curl -I`.
- Changes propagate slowly (up to seven days on Android 15+). Serve the file
  `Cache-Control: no-cache`. Rotate keys by adding the new fingerprint, waiting,
  then removing the old one.

## Address bar visible: troubleshooting order

1. Play app signing fingerprint missing from the file.
2. File not at the origin root, not 200, wrong Content-Type.
3. Cross-origin redirect before the start URL.
4. JSON invalid or `package_name` wrong.
5. Cached old file on the device: clear Chrome's site data.
6. Read the expected fingerprint on device with the Asset Links Tool app, or
   `adb logcat | grep -e OriginVerifier -e digital_asset_links`.

A "Chrome is in use" first-run banner is normal; only a visible address bar
means verification failed. `bubblewrap fingerprint generateAssetLinks` emits an
empty array when `twa-manifest.json` holds no fingerprints.

## Bubblewrap and PWABuilder

- **Bubblewrap** (`@bubblewrap/cli` 1.25.0, verified 2026-09-24): Node plus
  **JDK 17 exactly**. `bubblewrap init --manifest <url>`, `build` (emits
  `app-release-bundle.aab`), `update`, `fingerprint add`. `twa-manifest.json` is
  the source of truth: `update` overwrites hand edits to the Android project.
- **PWABuilder**: the same engine with a GUI. Its download contains
  `signing-key-info.txt` with the key and store passwords in plain text: move it
  to secure storage and never commit the download.
- `packageId` is permanent for a listing. Without Play App Signing, a lost
  signing key means the listing can never be updated.

## Listing, review, updates

- Play listing graphics are uploaded in the Console, never read from the
  manifest: icon 512x512 PNG, feature graphic 1024x500, at least 2 screenshots
  with the longest side at most **2x** the shortest (Chrome's install dialog
  allows 2.3x, so one image set may not satisfy both).
- Play's minimum-functionality policy rejects thin wrappers; wrapping a site
  you do not own is spam. PWABuilder advises age rating 13+.
- Web content updates live with no resubmission. The wrapper needs a new
  `versionCode` for name, icon, colour, display, orientation, origin changes,
  and for Play's target API deadlines (API 36 required from 2026-08-31, verified
  2026-09-22).

## iOS

No TWA equivalent. PWABuilder's iOS output is a WKWebView wrapper whose repo was
archived 2025-09-11 and is community-only, and App Store guideline 4.2 rejects
apps that are "a repackaged website". App Store distribution is a separate
native project, not a packaging step.

## Shipping procedure

1. Installable in Chrome and passing `pwa-check.mjs`, with an offline fallback.
2. Resolve the canonical origin with `curl -I`.
3. `bubblewrap init`; check `packageId` before anything else.
4. Build, sideload, confirm no address bar.
5. Upload to a **closed test track** with Play App Signing on.
6. Add the Play app signing fingerprint to `assetlinks.json`; deploy.
7. Install from the track; confirm no address bar.
8. Complete the listing against Play's rules; promote.
