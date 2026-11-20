audio_stream = client.speech_to_speech.convert(
    voice_id="JBFqnCBsd6RMkjVDRZzb",
    audio=audio_file,
    model_id="eleven_multilingual_sts_v2",
    voice_settings=VoiceSettings(