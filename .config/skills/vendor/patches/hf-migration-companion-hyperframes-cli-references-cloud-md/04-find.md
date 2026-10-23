4. Preserve existing `.hyperframesignore` comments and rules. Add the narrowest verified-unneeded root-relative paths; prefer an exact directory or file over a broad wildcard.
5. Never ignore `index.html`, the selected composition, mounted sub-compositions, fonts, images, audio, video, scripts, or manifests merely because they are large. Never ignore all of `assets/`.
6. Rerun dry-run until the archive is below the limit, then run `npx hyperframes check`. Remember that `check` sees the source directory, so it cannot prove a dynamically computed asset path remains in the filtered archive; the reference audit is still required.

Example:
