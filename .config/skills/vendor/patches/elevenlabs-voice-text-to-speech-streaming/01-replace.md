```python
from elevenlabs import ElevenLabs

client = ElevenLabs()

audio_stream = client.text_to_speech.stream(
    text="This is a streaming example.",
    voice_id="selected_voice_id",
    model_id="eleven_v4"
)

with open("output.mp3", "wb") as f:
    for chunk in audio_stream:
        f.write(chunk)
```
