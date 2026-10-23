 *
 * Needs `ffmpeg` on PATH (to decode the audio) and `@hyperframes/core` resolvable
 * from the composition's project (`pnpm add -D --save-exact @hyperframes/core@0.8.46`; honour the release-age gate and install-script protections) — the CLI bundles
 * core inline rather than shipping it as a package, so it cannot be borrowed from
 * there.
