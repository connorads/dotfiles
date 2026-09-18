```python
# First request
audio1 = client.text_to_speech.convert(
    text="This is the first part.",
    voice_id="JBFqnCBsd6RMkjVDRZzb",
    next_text="And this continues the story."
)
