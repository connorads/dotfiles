```python
import subprocess

def play_stream(audio_stream):
    process = subprocess.Popen(
        ["ffplay", "-nodisp", "-autoexit", "-"],
        stdin=subprocess.PIPE
    )
    for chunk in audio_stream:
        process.stdin.write(chunk)
    process.stdin.close()
    process.wait()

audio_stream = client.text_to_speech.stream(
    text="Playing this audio in real-time.",
    voice_id="selected_voice_id",
    model_id="eleven_v4"
)
play_stream(audio_stream)
```
