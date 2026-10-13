```javascript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createWriteStream } from "fs";
import { Readable } from "stream";

const client = new ElevenLabsClient();

const audioStream = await client.textToSpeech.convert("JBFqnCBsd6RMkjVDRZzb", {
  text: "Streaming audio in JavaScript.",
  modelId: "eleven_v4",
});

// Write to file (convert() returns a web ReadableStream — bridge to a Node stream first)
Readable.fromWeb(audioStream).pipe(createWriteStream("output.mp3"));

// Or process chunks
for await (const chunk of audioStream) {
  console.log(`Received ${chunk.length} bytes`);
}
```
