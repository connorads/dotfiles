
```bash
hyperframes transcribe audio.mp3  --model small.en             # known English
hyperframes transcribe video.mp4  --model small --language es  # known Spanish
hyperframes transcribe audio.mp3  --model small                # unknown language (auto-detect)
hyperframes transcribe subtitles.srt                           # import existing
hyperframes transcribe subtitles.vtt
hyperframes transcribe openai-response.json
```
