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
