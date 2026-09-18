```python
audio = client.text_to_speech.convert(
    text="Bonjour, comment allez-vous?",
    voice_id="selected_voice_id",
    model_id="eleven_v3",
    language_code="fr"  # ISO 639-1 code
)
```
