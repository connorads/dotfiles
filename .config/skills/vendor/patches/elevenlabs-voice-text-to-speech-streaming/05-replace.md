const audio = await textToSpeechWsStreaming(
  "selected_voice_id",
  "eleven_flash_v2_5"
);
fs.writeFileSync("output.mp3", audio);
```
