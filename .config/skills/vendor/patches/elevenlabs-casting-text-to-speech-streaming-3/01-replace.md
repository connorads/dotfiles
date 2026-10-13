```python
import asyncio
import base64
import json
import os
import websockets
from dotenv import load_dotenv

load_dotenv()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
VOICE_ID = "selected_voice_id"
URI = (
    "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input"
    "?model_id=eleven_v4_turbo&output_format=mp3_44100_128"
)

async def stream_v4_turbo(text: str):
    async with websockets.connect(URI) as websocket:
        # First message registers voices and authenticates
        await websocket.send(json.dumps({
            "voices": [VOICE_ID],
            "xi_api_key": ELEVENLABS_API_KEY,
        }))
        await websocket.send(json.dumps({
            "inputs": [{"text": text, "voice_id": VOICE_ID, "new_turn": False}],
        }))
        # Flush remaining text and close after the final audio frame
        await websocket.send(json.dumps({"close_socket": True}))

        with open("output.mp3", "wb") as f:
            while True:
                msg = json.loads(await websocket.recv())
                if msg.get("error"):
                    raise RuntimeError(msg)
                if msg.get("audio"):
                    f.write(base64.b64decode(msg["audio"]))
                if msg.get("is_final"):
                    break

asyncio.run(stream_v4_turbo(
    "This is a longer line of dialogue so the server has enough text to start streaming audio. "
))
```
