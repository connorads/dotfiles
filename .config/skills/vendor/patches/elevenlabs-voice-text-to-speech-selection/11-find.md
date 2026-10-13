```python
audio_stream = client.text_to_speech.stream(
    text="This text will be streamed as audio.",
    voice_id="JBFqnCBsd6RMkjVDRZzb",
    model_id="eleven_v4"
)

for chunk in audio_stream:
    play_audio(chunk)
```
