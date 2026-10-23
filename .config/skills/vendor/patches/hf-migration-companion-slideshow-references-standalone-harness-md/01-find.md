```

**Sourcing SFX files:** resolve each one with `npx hyperframes media-use resolve --type sfx --intent "<whoosh | click | transition>" --project .` (Openverse CC0 / CC BY, bundled library offline; CC BY credits land in a `CREDITS.md` beside the resolved files), copy the files to a local `sfx/` directory next to `demo.html` and reference them by relative path. Do not fetch SFX at render time — the HyperFrames determinism rule forbids runtime network requests; pre-download and commit them.

---
