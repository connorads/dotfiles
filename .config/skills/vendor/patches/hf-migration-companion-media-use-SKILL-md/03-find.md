| Images, icons | Asset search, 75k+ | Local FLUX (mflux), if installed |
| Logos (`logo`) | | theSVG, GitHub avatar, favicon; never redrawn |
| Voiceover (`voice`) | HeyGen voices, voice cloning | `npx hyperframes tts` (Kokoro on device; Python 3.10+ with `pip install kokoro-onnx soundfile`) |
| A presenter speaking | Avatar video (`--type video`) | Local LTX for generic clips, if installed |
| Transcripts | | `npx hyperframes transcribe` (Parakeet or whisper) |
| Cutouts | `heygen background-removal` | `npx hyperframes remove-background` |
| Grades, LUTs, looks | | `npx hyperframes media-treatment` |

**Host apps.** Inside an app that gives you its own media tools, use those first. When `HEYGEN_API_BASE` is set, the host pays for HeyGen: don't ask for the `heygen` CLI or a sign-in, and when a call is refused, relay the host's message as written and stop.

**HeyGen.** Install the [`heygen` CLI](https://developers.heygen.com/cli) and sign in with `heygen auth login --oauth`: the OAuth session carries a free allowance on subscription credits; an API key (`--api-key`) bills API credits. Check setup with `npx hyperframes media-use resolve --doctor`. When a request needs HeyGen (a presenter or avatar, a HeyGen voice, catalog music) and `heygen` is missing or signed out, tell the person how to get it: the install link, `heygen auth login --oauth` for the free allowance, or an API key for credits. Then offer the free path or wait. Beyond `resolve`, the same CLI makes text-to-video (`heygen video-agent create`), avatar videos with a recorded track (`heygen video create`), cloned voices (`heygen voice clone create`), dubbing (`heygen lipsync`), translated videos (`heygen video-translate`) and short clips from a long video (`heygen ai-clipping`): recipes in `references/operations.md`.

**Free.** Every tool in the free column needs no account; local models are opt-in installs (`references/setup-providers.md`). Without `heygen`, `resolve` for music, images and icons fails and says so; credit CC BY sounds (`audio/references/sfx.md`). `--local-only` skips every network provider.
