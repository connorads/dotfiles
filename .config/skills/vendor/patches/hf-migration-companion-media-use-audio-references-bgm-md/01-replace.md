
- **HeyGen retrieval — the default when credentialed.** Search HeyGen's music catalog by mood, download the top track. No generation; same `~/.heygen` / `$HEYGEN_API_KEY` credential as TTS.
- **Local generation (Lyria → MusicGen) — the fallback when there is no credential** (or when asked for explicitly). Generate a WAV from a mood prompt. There is **no `hyperframes bgm` command**; the engine spawns `scripts/lyria-recipe.py` or an inline MusicGen script directly.

> Choose the provider with the user before generating. Use the host media tool when available, otherwise the managed installed provider. Missing credentials do not authorise a sign-in, model download or local generation.

## Driving it from the request
