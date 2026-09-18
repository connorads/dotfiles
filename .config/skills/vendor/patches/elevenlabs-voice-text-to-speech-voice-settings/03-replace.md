```bash
elevenlabs text-to-speech convert \
  --voice-id selected_voice_id \
  --text "Testing different voice settings." \
  --model-id eleven_v3 \
  --params '{"voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": true}}' \
  --output output.mp3
```
