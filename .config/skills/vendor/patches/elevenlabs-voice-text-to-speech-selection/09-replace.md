```python
# First request
audio1 = client.text_to_speech.convert(
    text="This is the first part.",
    voice_id="selected_voice_id",
    next_text="And this continues the story."
)
