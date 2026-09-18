async def main():
    audio = await text_to_speech_ws_streaming(
        voice_id="JBFqnCBsd6RMkjVDRZzb",
        model_id="eleven_flash_v2_5"
    )
    with open("output.mp3", "wb") as f:
        f.write(audio)
