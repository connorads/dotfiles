```javascript
import "dotenv/config";
import * as fs from "node:fs";
import WebSocket from "ws";

const voiceId = "JBFqnCBsd6RMkjVDRZzb";
const uri =
  "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=mp3_44100_128";

const websocket = new WebSocket(uri);
const out = fs.createWriteStream("output.mp3");

websocket.on("open", () => {
  websocket.send(JSON.stringify({ voices: [voiceId], xi_api_key: process.env.ELEVENLABS_API_KEY }));
  websocket.send(JSON.stringify({
    inputs: [{
      text: "This is a longer line of dialogue so the server has enough text to start streaming audio. ",
      voice_id: voiceId,
      new_turn: false,
    }],
  }));
  websocket.send(JSON.stringify({ close_socket: true }));
});

websocket.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.error) return console.error(msg);
  if (msg.audio) out.write(Buffer.from(msg.audio, "base64"));
});

websocket.on("close", () => out.end());
```
