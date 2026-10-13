```javascript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createWriteStream } from "fs";
import { Readable } from "stream";

const client = new ElevenLabsClient();
const audio = await client.textToSpeech.convert("selected_voice_id", {
  text: "Hello, welcome to ElevenLabs!",
  modelId: "eleven_v4",
});
// convert() returns a web ReadableStream — bridge it to a Node stream to write to disk
Readable.fromWeb(audio).pipe(createWriteStream("output.mp3"));
```
