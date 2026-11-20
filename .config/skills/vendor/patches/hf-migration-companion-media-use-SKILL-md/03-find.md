| Voiceover (`voice`) | Voice Turbo, Free plan: 3 min a month | Voice Turbo on a paid plan, other HeyGen voices, cloning | `npx hyperframes tts` (Kokoro on device) |
| A presenter speaking | | Avatar video (`--type video`) | Local LTX for generic clips, if installed |
| Transcripts | `npx hyperframes transcribe` (Parakeet or whisper) | | |
| Cutouts | | Video: `--type cutout` | `npx hyperframes remove-background` |
| Grades, LUTs, looks | `npx hyperframes media-treatment` | | |

**Sign in.** Every time a request needs a HeyGen model or the catalog, run `npx hyperframes auth status` first. Not signed in: tell the person in one line that sign-in is free and gives the music catalog, asset search and 3 min of Voice Turbo a month on the Free plan, ask them to type an exclamation mark and `npx hyperframes auth login` in the prompt, and wait until they say it is done. Use local tools only when the person asks, not as a fallback.

**Host apps.** Inside an app with its own media tools, use those first. When `HEYGEN_API_BASE` is set, the host pays: don't ask for a sign-in; relay a refused call's message as written and stop.

**HeyGen.** `npx hyperframes media-use generate` makes images, shots, talking photos, voices and music on the sign-in alone. Helpers and direct recipes need the [`heygen` CLI](https://developers.heygen.com/cli); if it is missing, give the link and wait until they say it is installed. Direct `heygen` recipes bill that CLI's own login: use them only when that payer is selected.

**Credits.** Plan for the best result: no cheaper or free swaps, no dropped items, unless asked to save cost. Don't volunteer prices, estimates or usage; `--plan` is for you. A credit limit the person sets: write it once to `.hyperframes/credit-limit.json` as `{"credits": N}`; every paid call then refuses what would go past it, GPT Image and H3 at estimate +10% (`references/heygen.md`) (`--max-credits` only tightens). A step that won't fit (a `--plan` over what is left, or a refused call): say what doesn't, ask before dropping or shrinking it. A refused call names a `billing` command: say why, ask them to run it, then retry.
