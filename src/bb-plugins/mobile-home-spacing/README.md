# Mobile Home Spacing

Recent threads fill the compact start screen below its top controls. The composer
stays pinned at the bottom. Desktop layouts keep BB's default spacing.

A trusted content script adds three scoped CSS rules. They override the host's
inline scroll offset, remove its leading spacer, and align short lists at the
top. BB retains control of scrolling, composer sizing, and keyboard handling.
Disabling the plugin removes the stylesheet.

The rules depend on BB's `root-compose-compact-*` DOM attributes. If BB changes
those attributes, update the selectors against the host layout before release.
The top clearance is 56 CSS pixels, matching the host's compact toolbar clearance.

## Verification

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` in this directory.
Install Chromium once with `pnpm exec playwright install chromium` if needed.

The Chromium tests use a host-layout fixture. They check tall and short screens,
last-row scrolling above the composer, short lists, host offset rewrites,
viewport and composer resizing, desktop isolation, delayed mounting, and cleanup.
They do not prove behaviour in the Android WebView or the live BB application.

See the [workspace guide](../README.md#setup) for installation and reload commands.
