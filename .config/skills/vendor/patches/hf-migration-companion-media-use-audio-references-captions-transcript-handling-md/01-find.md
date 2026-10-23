1. **Retry with `medium.en`** if the original used `small.en` or smaller:
   ```bash
   npx hyperframes transcribe audio.mp3 --model medium.en
   ```
2. **If `medium.en` also fails** (still >20% music tokens or garbled), tell the user the audio is too noisy for local transcription and suggest:
