Steps 1 and 3 are the **deterministic floor**: they only auto-reuse an exact-normalized match, never a fuzzy one. Semantic reuse ("close enough") is the agent's explicit call via [Reuse before you resolve](#reuse-before-you-resolve) — it never happens automatically. The agent gets back **one line**; candidates, scores, provenance stay on disk.

## Media provenance

Keep provider provenance in `.media/manifest.jsonl`. Do not add `data-media-source="heygen"` to composition HTML solely for render telemetry.<!-- LOCAL PATCH (connorads dotfiles): Provider provenance stays in the local manifest; agents do not add telemetry-only HTML attributes. -->

## Adopt existing projects
