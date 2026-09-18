audio = client.text_to_speech.convert(
    text="Testing different voice settings.",
    voice_id="selected_voice_id",
    model_id="eleven_v3",
    voice_settings=VoiceSettings(
        stability=0.5,
        similarity_boost=0.75,
        style=0.0,
        use_speaker_boost=True
    )
)
```
