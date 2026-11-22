audio_stream = client.speech_to_speech.convert(
    voice_id="selected_voice_id",
    audio=audio_file,
    model_id="eleven_multilingual_sts_v2",
    remove_background_noise=True,