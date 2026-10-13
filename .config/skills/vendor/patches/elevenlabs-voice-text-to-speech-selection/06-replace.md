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
