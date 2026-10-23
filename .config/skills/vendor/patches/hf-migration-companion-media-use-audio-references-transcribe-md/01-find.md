
```bash
npx hyperframes transcribe audio.mp3  --model small.en             # known English
npx hyperframes transcribe video.mp4  --model small --language es  # known Spanish
npx hyperframes transcribe audio.mp3  --model small                # unknown language (auto-detect)
npx hyperframes transcribe subtitles.srt                           # import existing
npx hyperframes transcribe subtitles.vtt
npx hyperframes transcribe openai-response.json
```
