<!-- registry-items: allow=max-width,data-composition-src,hyperframes-registry,blend-mode,caption-style,font-family -->

**The live search is the source of truth for what the registry has.** The table(s) below are a hand-maintained sample and under-cover by design: run `hyperframes catalog --query "<what you want>" --json` — it needs nothing installed — before concluding the registry lacks something. Item names here are checked against `registry/registry.json` by `pnpm lint:skills`.

Before authoring: confirm the transcript came from the right Whisper model. CLI default `small.en` silently translates non-English audio — see [`../transcribe.md`](../transcribe.md) → "Language Rule" and [`transcript-handling.md`](transcript-handling.md) for the mandatory quality check.
