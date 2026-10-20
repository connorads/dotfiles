---
name: text-to-speech
description: Convert text to speech using ElevenLabs voice AI. Use when generating audio from text, creating voiceovers, building voice apps, or synthesizing speech in 90+ languages.
license: MIT
compatibility: Requires internet access and an ElevenLabs API key (ELEVENLABS_API_KEY).
metadata: {"openclaw": {"requires": {"env": ["ELEVENLABS_API_KEY"]}, "primaryEnv": "ELEVENLABS_API_KEY"}}
---

# ElevenLabs Text-to-Speech

Generate natural speech from text - supports 90+ languages, multiple models for quality vs latency tradeoffs. Examples default to `eleven_v4`, the latest and highest-quality model.

> **Setup, before writing any code:** if `ELEVENLABS_API_KEY` isn't set for this project, use the existing credential workflow. Report a missing credential and stop that path. Do not download a CLI or run onboarding to write project credentials. Otherwise see the [Installation Guide](references/installation.md). For JavaScript, use `@elevenlabs/*` packages only.

## Voice selection

<!-- LOCAL PATCH (connorads dotfiles): Voice casting follows the brief and project choices; example voices are not defaults, and George requires an explicit request. -->

- Use the voice the user requests. Use George only when explicitly requested for this project or character; an inherited example ID is not a request.
- Otherwise, reuse the recorded voice for this project or character, unless the brief changes or the user asks to recast. Do not carry casting between unrelated projects.
- For new casting, inspect the available voices and match the brief's language, accent, delivery and character. Never select a voice because it appears first in a list or example.
- When the brief gives enough direction, select a suitable voice and state its name and why it fits. Proceed without asking for approval.
- When the brief leaves the voice unclear, offer three suitable candidates with available preview links and ask the user to choose. Do not generate paid auditions unless requested.
- Record the chosen voice name, ID and casting rationale in the project's existing configuration or notes, per character where needed. Reuse that choice on later runs.

`selected_voice_id` in examples is a placeholder. Replace it with the chosen voice's actual ID before calling the API; always pass the selected voice explicitly.

## Quick start examples

### Python

```python
from elevenlabs import ElevenLabs

client = ElevenLabs()

audio = client.text_to_speech.convert(
    text="Hello, welcome to ElevenLabs!",
    voice_id="selected_voice_id",
    model_id="eleven_v4"
)

with open("output.mp3", "wb") as f:
    for chunk in audio:
        f.write(chunk)
```

### JavaScript

```javascript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createWriteStream } from "fs";
import { Readable } from "stream";

const client = new ElevenLabsClient();
const audio = await client.textToSpeech.convert("selected_voice_id", {
  text: "Hello, welcome to ElevenLabs!",
  modelId: "eleven_v4",
});
// convert() returns a web ReadableStream — bridge it to a Node stream to write to disk
Readable.fromWeb(audio).pipe(createWriteStream("output.mp3"));
```

### CLI

Use `say` only with the explicitly selected project voice; inspect installed CLI help for the supported voice option:

```bash
elevenlabs say --model "$SELECTED_MODEL_ID" "Hello!" --voice "$SELECTED_VOICE_ID"
```

Pipe text into `say` when another command produces the input:

```bash
echo "The build finished successfully." | elevenlabs say --model "$SELECTED_MODEL_ID" --voice "$SELECTED_VOICE_ID"
```

Use the API command when you need to set request parameters directly:

```bash
elevenlabs text-to-speech convert --voice-id selected_voice_id \
  --text "Hello!" --model-id eleven_v4 --output output.mp3
```

The CLI reads `ELEVENLABS_API_KEY` from the environment automatically.

## Models

| Model ID | Languages | Latency | Best For |
|----------|-----------|---------|----------|
| `eleven_v4` | 90+ | Standard | **Default.** Highest quality, emotional range, audio tags, voice cloning accuracy |
| `eleven_v4_turbo` | 90+ | ~100ms | Real-time v4 quality for agents and interactive apps (via [Text to Dialogue WebSocket](references/streaming.md#eleven-v4-turbo-websocket)) |
| `eleven_flash_v2_5` | 32 | ~75ms | Lowest latency, lowest cost, `stream-input` WebSocket |
| `eleven_flash_v2` | English | ~75ms | English-only, lowest latency |
| `eleven_multilingual_v2` | 29 | Standard | Previous generation; most stable on very long-form generations |
| `eleven_v3` | 70+ | Standard | Previous generation expressive model |

`eleven_turbo_v2_5` and `eleven_turbo_v2` are superseded by the Flash models (same output, lower latency) — use `eleven_flash_v2_5` / `eleven_flash_v2` instead.

**Eleven v4 notes:** supports only `stability` and `similarity_boost` voice settings (no `style` or `speed`), does not support SSML, and is not available on the `stream-input` TTS WebSocket. Direct delivery with audio tags such as `[whispers]`, `[laughs]`, `[sarcastic]`.

## Eleven v4

<!-- LOCAL PATCH (connorads dotfiles): Eleven v4 usage guidance from the 2026-09-28 launch docs, checked against the live API; upstream only lists the model IDs. -->

`eleven_v4` is the highest-quality expressive model; `eleven_v4_turbo` is its real-time variant (~100ms). Neither is a default, so always pass `model_id`. See [Eleven v4](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4) and the [prompting guide](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v4).

- **Endpoints**: ElevenLabs routes `eleven_v4` through Text to Dialogue (`client.text_to_dialogue.convert`, `inputs[]` of `{text, voice_id}`), which reads the whole scene so speakers react to each other. Create speech also accepts it for a single voice. `eleven_v4_turbo` streams through the Text to Dialogue WebSocket with one registered voice (`eleven_v4` allows 10): send `new_turn: true` at turn ends, `flush` to skip the ~40-character buffer, and `keep_alive` within the 20s idle timeout. The TTS `stream-input` WebSocket rejects v3 and v4.
- **Limits**: 10,000 characters per `eleven_v4` speech request. Keep Text to Dialogue requests to 2,000 characters of total `inputs[].text` and concatenate the chunks.
- **Settings**: only stability and similarity apply; lower stability varies delivery more. Text to Dialogue takes `settings.stability` and `settings.similarity`. Style, speed and SSML (including `<break>`) have no effect, yet requests carrying them or a misnamed field still succeed, so a wrong setting fails silently.
- **Tags**: free-form bracketed directions placed where delivery should change: `[whispers]`, `[sighs]`, `[sarcastic]`, `[Quiet, measured narration]`. Sound effects such as `[applause]` also render, so describe voice quality explicitly (`[low, gravelly voice]`) or a vague tag may come out as a sound. Match tags to the voice's character.
- **Tagging a script** (the rules of ElevenLabs' Enhance prompt): tag only sounds the voice makes; never change, add or remove words; put a tag just before or after the line it modifies; add emphasis only with CAPS, `?`, `!` or `...`.
- **Pacing and pronunciation**: ellipses add pauses and weight; CAPS add emphasis. For pronunciation, write IPA between slashes inside quotes, e.g. `"/ˌbaɪoʊˈkemɪstri/"`, with stress marks. Phoneme tags do not work on v4.
- **Dialogue**: end an interrupted line with a dash and open the next turn with `[jumping in]`.
- **Takes**: output varies and `seed` is best-effort. Generate several takes of anything user-facing and let the user choose.
- **Voices**: v4 clones reproduce the source recording, flaws included, and can sound unlike their v3 rendering. Voice Design voices may be less performative. A voice speaking another language takes that language's native accent; use `eleven_v3` when the source accent must carry, and `eleven_multilingual_v2` when style or speed control is required.

## Voice IDs

Use pre-made voices or custom voices from the dashboard, and preview a voice on the target model before casting it.

Choose from the available voices using the voice selection rules above.

```python
voices = client.voices.get_all()
for voice in voices.voices:
    print(f"{voice.voice_id}: {voice.name}")
```

## Voice Settings

Fine-tune how the voice sounds:

- **Stability**: How consistent the voice stays. Lower values = more emotional range and variation, but can sound unstable. Higher = steady, predictable delivery.
- **Similarity boost**: How closely to match the original voice sample. Higher values sound more like the original but may amplify audio artifacts.
- **Style**: Exaggerates the voice's unique style characteristics (v2/v3 models; not supported on Eleven v4).
- **Speed**: Speech speed multiplier (v2/v3 models; not supported on Eleven v4).
- **Speaker boost**: Post-processing that enhances clarity and voice similarity.

```python
from elevenlabs import VoiceSettings

audio = client.text_to_speech.convert(
    text="Customize my voice settings.",
    voice_id="selected_voice_id",
    model_id="eleven_v4",
    voice_settings=VoiceSettings(
        stability=0.5,          # Lower = more expressive, higher = more consistent
        similarity_boost=0.75,  # Higher = closer to the reference voice
    )
)
```

## Language Selection

Use `language_code` with models that support language enforcement to guide pronunciation and text normalization. Unsupported language codes are ignored, and `language_code` is not supported on `eleven_multilingual_v2`.

```python
audio = client.text_to_speech.convert(
    text="Bonjour, comment allez-vous?",
    voice_id="selected_voice_id",
    model_id="eleven_v4",
    language_code="fr"  # ISO 639-1 code
)
```

## Text Normalization

Controls how numbers, dates, and abbreviations are converted to spoken words. For example, "01/15/2026" becomes "January fifteenth, twenty twenty-six":

- `"auto"` (default): Model decides based on context
- `"on"`: Always normalize (use when you want natural speech)
- `"off"`: Speak literally (use when you want "zero one slash one five...")

```python
audio = client.text_to_speech.convert(
    text="Call 1-800-555-0123 on 01/15/2026",
    voice_id="selected_voice_id",
    model_id="eleven_v4",
    apply_text_normalization="on"
)
```

## Audio Effects

Use `audio_effects` to process the generated audio with a filter preset, perceived distance, a reverb environment, a looped background noise bed, and stereo panning. Effects do not change the cost of a request.

| Field | Range | Description |
|-------|-------|-------------|
| `filter_preset_id` | Catalog ID | Filter that colors the voice, such as `phone` or `old_radio` |
| `distance` | 0-1 (default 0) | How far the speaker sounds from the microphone |
| `environment_id` | Catalog ID | Reverb environment, such as `small_room` or `hall` |
| `send_level` | 0-1 (default 1) | How much of the voice feeds the reverb; 0 turns reverb off |
| `background_noise_id` | Catalog ID | Background noise looped under the voice, such as `cafe` or `keyboard` |
| `pan` | -1 to 1 (default 0) | Stereo position of the voice, from hard left to hard right |

List valid filter preset, environment, and background noise IDs with the catalog endpoint (`GET /v1/audio-effects/catalog`):

```python
from elevenlabs import EffectsSpecInput

catalog = client.audio_effects.get_catalog()
for environment in catalog.environments:
    print(f"{environment.environment_id}: {environment.name}")

audio = client.text_to_speech.convert(
    text="Welcome to the concert hall.",
    voice_id="selected_voice_id",
    model_id="eleven_v4",
    audio_effects=EffectsSpecInput(
        environment_id="hall",
        distance=0.3,
        pan=-0.5,
    )
)
```

Reverb and non-zero `pan` produce stereo audio and are rejected for `ulaw_*`, `alaw_*`, and `pcm_*` output formats. Unknown effect IDs return a 404 error.

## Request Stitching

When generating long audio in multiple requests, the audio can have pops, unnatural pauses, or tone shifts at the boundaries. Request stitching solves this by letting each request know what comes before/after it:

```python
# First request
audio1 = client.text_to_speech.convert(
    text="This is the first part.",
    voice_id="selected_voice_id",
    model_id="eleven_v4",
    next_text="And this continues the story."
)

# Second request using previous context
audio2 = client.text_to_speech.convert(
    text="And this continues the story.",
    voice_id="selected_voice_id",
    model_id="eleven_v4",
    previous_text="This is the first part."
)
```

## Output Formats

| Format | Description |
|--------|-------------|
| `mp3_44100_128` | MP3 44.1kHz 128kbps (default) - compressed, good for web/apps |
| `mp3_44100_192` | MP3 44.1kHz 192kbps (Creator+) - higher quality compressed |
| `mp3_44100_64` | MP3 44.1kHz 64kbps - lower quality, smaller files |
| `mp3_22050_32` | MP3 22.05kHz 32kbps - smallest MP3 files |
| `pcm_16000` | Raw PCM 16kHz - use for real-time processing |
| `pcm_22050` | Raw PCM 22.05kHz |
| `pcm_24000` | Raw PCM 24kHz - good balance for streaming |
| `pcm_44100` | Raw PCM 44.1kHz (Pro+) - CD quality |
| `pcm_48000` | Raw PCM 48kHz (Pro+) - highest quality |
| `ulaw_8000` | μ-law 8kHz - standard for phone systems (Twilio, telephony) |
| `alaw_8000` | A-law 8kHz - telephony (alternative to μ-law) |
| `opus_48000_64` | Opus 48kHz 64kbps - efficient streaming codec |
| `wav_44100` | WAV 44.1kHz - uncompressed with headers |

## Streaming

Use the `stream` method to receive audio chunks as they're generated:

```python
audio_stream = client.text_to_speech.stream(
    text="This text will be streamed as audio.",
    voice_id="selected_voice_id",
    model_id="eleven_v4"
)

for chunk in audio_stream:
    play_audio(chunk)
```

For real-time apps where latency matters most, use `eleven_v4_turbo` (~100ms) over the Text to Dialogue WebSocket, or `eleven_flash_v2_5` (~75ms) over HTTP streaming or the `stream-input` WebSocket. See [references/streaming.md](references/streaming.md).

## Error Handling

```python
try:
    audio = client.text_to_speech.convert(
        text="Generate speech",
        voice_id="invalid-voice-id",
        model_id="eleven_v4"
    )
except Exception as e:
    print(f"API error: {e}")
```

Common errors:
- **401**: Invalid API key
- **422**: Invalid parameters (check voice_id, model_id)
- **429**: Rate limit exceeded

## Tracking Costs

Monitor character usage via response headers (`x-character-count`, `request-id`):

```python
response = client.text_to_speech.convert.with_raw_response(
    text="Hello!", voice_id="selected_voice_id", model_id="eleven_v4"
)
audio = response.parse()
print(f"Characters used: {response.headers.get('x-character-count')}")
```

## References

- [Installation Guide](references/installation.md)
- [Streaming Audio](references/streaming.md)
- [Voice Settings](references/voice-settings.md)
