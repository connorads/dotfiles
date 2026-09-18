const audio = await textToSpeechWsStreaming(
  "JBFqnCBsd6RMkjVDRZzb",
  "eleven_flash_v2_5"
);
fs.writeFileSync("output.mp3", audio);
```
