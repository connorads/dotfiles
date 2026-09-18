audio_stream = client.text_to_speech.stream(
    text="Playing this audio in real-time.",
    voice_id="selected_voice_id",
    model_id="eleven_flash_v2_5"
)
play_stream(audio_stream)
```
