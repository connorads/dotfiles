```python
audio_stream = client.text_to_speech.stream(
    text="This text will be streamed as audio.",
    voice_id="selected_voice_id",
    model_id="eleven_flash_v2_5"  # Ultra-low latency
)
