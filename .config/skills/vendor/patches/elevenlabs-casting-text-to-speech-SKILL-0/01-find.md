```python
from elevenlabs import ElevenLabs

client = ElevenLabs()

audio = client.text_to_speech.convert(
    text="Hello, welcome to ElevenLabs!",
    voice_id="JBFqnCBsd6RMkjVDRZzb",  # George
    model_id="eleven_v4"
)

with open("output.mp3", "wb") as f:
    for chunk in audio:
        f.write(chunk)
```
