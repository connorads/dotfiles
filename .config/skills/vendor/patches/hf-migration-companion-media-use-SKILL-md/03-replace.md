| Voiceover (`voice`) | Voice Turbo, Free plan: 3 min a month | Voice Turbo on a paid plan, other HeyGen voices, cloning | `hyperframes tts` (Kokoro on device) |
| A presenter speaking | | Avatar video (`--type video`) | Local LTX for generic clips, if installed |
| Transcripts | `hyperframes transcribe` (Parakeet or whisper) | | |
| Cutouts | | Video: `--type cutout` | `hyperframes remove-background` |
| Grades, LUTs, looks | `hyperframes media-treatment` | | |

**Sign in.** When a request needs a HeyGen model or the catalog, run `hyperframes auth status` first. If not signed in, report the missing auth and offer the choice between signing in (`hyperframes auth login`) or using an installed local/free path; wait for the user's choice.

**Host apps.** Inside an app with its own media tools, use those first. When `HEYGEN_API_BASE` is set, the host pays: don't ask for a sign-in; relay a refused call's message as written and stop.

**HeyGen.** `hyperframes media-use generate` makes images, shots, talking photos, voices and music using configured HyperFrames auth. Helpers and direct recipes use the managed installed `heygen` CLI; if it is missing, report the prerequisite and wait for the user to install it. Direct `heygen` recipes bill that CLI's own login: use them only when that payer is selected.

**Credits and cost consent.** Confirm before making paid generation calls that the user did not explicitly request, and share `--plan` cost/credit estimates when they affect the user's decision. Honour any credit limit recorded in `.hyperframes/credit-limit.json` (`--max-credits` only tightens). If a step exceeds the limit or a call is refused, explain why and ask the user how to proceed.
