# Text To Speech

`npx hyperframes tts` synthesizes locally with Kokoro. It does not accept a
`--provider` or `--words` flag. For HeyGen audio plus word timestamps, use the
bundled `heygen-tts.mjs` script below.

> **Run the Preflight first — no credential is not a green light to silently use the local voice.** Before generating a voiceover, complete the sign-in **Preflight** (see `../../SKILL.md` → Preflight): run `npx hyperframes auth status`, recommend signing in, and **STOP for the user's choice** (sign in for HeyGen voices, or continue offline with local Kokoro). This applies to a one-off "generate a voiceover" request just as much as inside a full workflow.

## Narrating a HyperFrames docs video
