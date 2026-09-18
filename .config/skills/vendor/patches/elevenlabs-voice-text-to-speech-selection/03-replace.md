const client = new ElevenLabsClient();
const audio = await client.textToSpeech.convert("selected_voice_id", {
  text: "Hello, welcome to ElevenLabs!",
  modelId: "eleven_multilingual_v2",
});
// convert() returns a web ReadableStream — bridge it to a Node stream to write to disk
Readable.fromWeb(audio).pipe(createWriteStream("output.mp3"));
```
