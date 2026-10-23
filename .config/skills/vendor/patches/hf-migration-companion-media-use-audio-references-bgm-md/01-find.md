
- **HeyGen retrieval — the default when credentialed.** Search HeyGen's music catalog by mood, download the top track. No generation; same `~/.heygen` / `$HEYGEN_API_KEY` credential as TTS.
- **Local generation (Lyria → MusicGen) — the fallback when there is no credential** (or when asked for explicitly). Generate a WAV from a mood prompt. There is **no `npx hyperframes bgm` command**; the engine spawns `scripts/lyria-recipe.py` or an inline MusicGen script directly.

> **Run the Preflight first — no credential is not a green light to silently generate locally.** Before generating, complete the sign-in **Preflight** (see `../../SKILL.md` → Preflight): run `npx hyperframes auth status`, recommend signing in, and **STOP for the user's choice** (sign in for HeyGen's music library, or continue offline with local generation). This applies to a one-off "generate a BGM" request just as much as inside a full workflow.

## Driving it from the request
