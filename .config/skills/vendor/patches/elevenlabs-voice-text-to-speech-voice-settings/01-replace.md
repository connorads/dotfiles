```python
from elevenlabs import ElevenLabs
from elevenlabs import VoiceSettings

client = ElevenLabs()

audio = client.text_to_speech.convert(
    text="Testing different voice settings.",
    voice_id="selected_voice_id",
    model_id="eleven_v4",
    voice_settings=VoiceSettings(
        stability=0.5,
        similarity_boost=0.75,
    )
)
```
