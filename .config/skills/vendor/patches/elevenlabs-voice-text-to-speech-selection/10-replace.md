# Second request using previous context
audio2 = client.text_to_speech.convert(
    text="And this continues the story.",
    voice_id="selected_voice_id",
    previous_text="This is the first part."
)
```
