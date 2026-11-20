audio_stream = client.speech_to_speech.convert(
    voice_id="selected_voice_id",
    audio=pcm_bytes,