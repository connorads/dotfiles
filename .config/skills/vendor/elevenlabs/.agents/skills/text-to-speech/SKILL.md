---
name: text-to-speech
description: Convert text to speech using ElevenLabs voice AI. Use when generating audio from text, creating voiceovers, building voice apps, or synthesizing speech in 70+ languages.
license: MIT
compatibility: Requires internet access and an ElevenLabs API key (ELEVENLABS_API_KEY).
metadata: {"openclaw": {"requires": {"env": ["ELEVENLABS_API_KEY"]}, "primaryEnv": "ELEVENLABS_API_KEY"}}
---

# ElevenLabs Text-to-Speech

Generate natural speech from text - supports 70+ languages, multiple models for quality vs latency tradeoffs.

> **Setup:** See [Installation Guide](references/installation.md). For JavaScript, use `@elevenlabs/*` packages only.

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
    model_id="eleven_multilingual_v2"
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
  modelId: "eleven_multilingual_v2",
});
// convert() returns a web ReadableStream — bridge it to a Node stream to write to disk
Readable.fromWeb(audio).pipe(createWriteStream("output.mp3"));
```

### CLI

Use `say` to play text immediately with the default voice and `eleven_v3` model:

```bash
elevenlabs say "Hello!"
```

Pipe text into `say` when another command produces the input:

```bash
echo "The build finished successfully." | elevenlabs say
```

Use the API command when you need to set request parameters directly:

```bash
elevenlabs text-to-speech convert --voice-id selected_voice_id \
  --text "Hello!" --model-id eleven_multilingual_v2 --output output.mp3
```

The CLI reads `ELEVENLABS_API_KEY` from the environment automatically.

## Models

| Model ID | Languages | Latency | Best For |
|----------|-----------|---------|----------|
| `eleven_v3` | 70+ | Standard | Highest quality, emotional range |
| `eleven_multilingual_v2` | 29 | Standard | High quality, long-form content |
| `eleven_flash_v2_5` | 32 | ~75ms | Ultra-low latency, real-time |
| `eleven_flash_v2` | English | ~75ms | English-only, fastest |
| `eleven_turbo_v2_5` | 32 | ~250-300ms | Balanced quality/speed |
| `eleven_turbo_v2` | English | ~250-300ms | English-only, balanced |

## Voice IDs

Use pre-made voices or create custom voices in the dashboard.

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
- **Style**: Exaggerates the voice's unique style characteristics (only works with v2+ models).
- **Speaker boost**: Post-processing that enhances clarity and voice similarity.

```python
from elevenlabs import VoiceSettings

audio = client.text_to_speech.convert(
    text="Customize my voice settings.",
    voice_id="selected_voice_id",
    voice_settings=VoiceSettings(
        stability=0.5,
        similarity_boost=0.75,
        style=0.5,
        speed=1.0,             # 0.25 to 4.0 (default 1.0)
        use_speaker_boost=True
    )
)
```

## Language Selection

Use `language_code` with models that support language enforcement to guide pronunciation and text normalization. Unsupported language codes are ignored, and `language_code` is not supported on `eleven_multilingual_v2`.

```python
audio = client.text_to_speech.convert(
    text="Bonjour, comment allez-vous?",
    voice_id="selected_voice_id",
    model_id="eleven_v3",
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
    apply_text_normalization="on"
)
```

## Request Stitching

When generating long audio in multiple requests, the audio can have pops, unnatural pauses, or tone shifts at the boundaries. Request stitching solves this by letting each request know what comes before/after it:

```python
# First request
audio1 = client.text_to_speech.convert(
    text="This is the first part.",
    voice_id="selected_voice_id",
    next_text="And this continues the story."
)

# Second request using previous context
audio2 = client.text_to_speech.convert(
    text="And this continues the story.",
    voice_id="selected_voice_id",
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

For real-time applications, use the `stream` method (returns audio chunks as they're generated):

```python
audio_stream = client.text_to_speech.stream(
    text="This text will be streamed as audio.",
    voice_id="selected_voice_id",
    model_id="eleven_flash_v2_5"  # Ultra-low latency
)

for chunk in audio_stream:
    play_audio(chunk)
```

See [references/streaming.md](references/streaming.md) for WebSocket streaming.

## Error Handling

```python
try:
    audio = client.text_to_speech.convert(
        text="Generate speech",
        voice_id="invalid-voice-id"
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
    text="Hello!", voice_id="selected_voice_id", model_id="eleven_multilingual_v2"
)
audio = response.parse()
print(f"Characters used: {response.headers.get('x-character-count')}")
```

## References

- [Installation Guide](references/installation.md)
- [Streaming Audio](references/streaming.md)
- [Voice Settings](references/voice-settings.md)
