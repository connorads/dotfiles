```javascript
const audio = await client.textToSpeech.convert("selected_voice_id", {
  text: "Testing different voice settings.",
  modelId: "eleven_v4",
  voiceSettings: {
    stability: 0.5,
    similarityBoost: 0.75,
  },
});
```
