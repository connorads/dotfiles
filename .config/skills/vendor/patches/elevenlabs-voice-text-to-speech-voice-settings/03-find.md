```bash
elevenlabs text-to-speech convert \
  --voice-id JBFqnCBsd6RMkjVDRZzb \
  --text "Testing different voice settings." \
  --model-id eleven_v4 \
  --params '{"voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}' \
  --output output.mp3
```
