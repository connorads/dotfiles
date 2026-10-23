Steps 1 and 3 are the **deterministic floor**: they only auto-reuse an exact-normalized match, never a fuzzy one. Semantic reuse ("close enough") is the agent's explicit call via [Reuse before you resolve](#reuse-before-you-resolve) — it never happens automatically. The agent gets back **one line**; candidates, scores, provenance stay on disk.

## Stamping provenance when mounting a resolved video

`resolve` never writes composition HTML itself — mounting a `<video>` element
into a composition is always the agent's own edit. When the mounted video's
manifest record has `provenance.provider === "heygen.video"` (check
`.media/manifest.jsonl` or the one-line resolve output for the provider name),
add `data-media-source="heygen"` to that `<video>` tag. Leave the attribute off
entirely for every other provider (`ltx.local`, an adopted/local file, etc.) —
this is not a general provider taxonomy, just the one signal render telemetry
tracks today.

## Adopt existing projects
