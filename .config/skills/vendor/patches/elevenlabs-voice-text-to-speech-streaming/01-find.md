audio_stream = client.text_to_speech.stream(
    text="This is a streaming example with ultra-low latency.",
    voice_id="JBFqnCBsd6RMkjVDRZzb",
    model_id="eleven_flash_v2_5"
)
