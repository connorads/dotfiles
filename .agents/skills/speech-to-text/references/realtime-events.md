# Real-Time Event Reference

Complete reference for events in real-time speech-to-text streaming.

## Sent Events

### input_audio_chunk

Send audio data for transcription.

```json
{
  "message_type": "input_audio_chunk",
  "audio_base_64": "<base64-encoded-pcm-audio>",
  "sample_rate": 16000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message_type` | string | Always `"input_audio_chunk"` |
| `audio_base_64` | string | Base64-encoded PCM audio data |
| `sample_rate` | number | Sample rate in Hz (8000-48000) |
| `previous_text` | string | Optional context (first chunk only, max 50 chars) |

### commit

Finalize the current transcript segment.

```json
{
  "message_type": "commit"
}
```

## Received Events

### session_started

Connection established successfully.

```json
{
  "type": "session_started",
  "session_id": "abc123",
  "model_id": "scribe_v2_realtime"
}
```

### partial_transcript

Interim transcription results, updates frequently as audio is processed.

```json
{
  "type": "partial_transcript",
  "text": "Hello, how are"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"partial_transcript"` |
| `text` | string | Current partial transcription |

### committed_transcript

Final transcription after commit.

```json
{
  "type": "committed_transcript",
  "text": "Hello, how are you today?"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"committed_transcript"` |
| `text` | string | Finalized transcription |

### committed_transcript_with_timestamps

Final transcription with word-level timing. Sent after `committed_transcript` when `include_timestamps=true`.

```json
{
  "type": "committed_transcript_with_timestamps",
  "words": [
    {"text": "Hello", "start": 0.0, "end": 0.32, "type": "word"},
    {"text": ",", "start": 0.32, "end": 0.35, "type": "punctuation"},
    {"text": " ", "start": 0.35, "end": 0.40, "type": "spacing"},
    {"text": "how", "start": 0.40, "end": 0.55, "type": "word"}
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"committed_transcript_with_timestamps"` |
| `words` | array | Word-level timing data |
| `words[].text` | string | The word or token |
| `words[].start` | number | Start time in seconds |
| `words[].end` | number | End time in seconds |
| `words[].type` | string | `"word"`, `"spacing"`, `"punctuation"`, `"audio_event"` |

## Error Events

### error

Sent when an error occurs.

```json
{
  "type": "error",
  "code": "invalid_audio",
  "message": "Audio format not supported"
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `authentication_failed` | Invalid API key or token |
| `quota_exceeded` | Usage limit reached |
| `invalid_audio` | Unsupported audio format |
| `rate_limited` | Too many requests |
| `session_time_limit_exceeded` | Session exceeded max duration |
| `unaccepted_terms` | Terms not accepted in dashboard |
| `resource_exhausted` | Server capacity reached |
| `transcription_error` | Internal processing error |

## Connection Events

### open

WebSocket connection established.

### close

WebSocket connection closed.

```json
{
  "type": "close",
  "code": 1000,
  "reason": "Normal closure"
}
```

## Event Handling Examples

### Python

```python
async for event in connection:
    if event.type == "session_started":
        print(f"Session: {event.session_id}")
    elif event.type == "partial_transcript":
        print(f"Partial: {event.text}")
    elif event.type == "committed_transcript":
        print(f"Final: {event.text}")
    elif event.type == "committed_transcript_with_timestamps":
        for word in event.words:
            print(f"  {word.text}: {word.start}s - {word.end}s")
    elif event.type == "error":
        print(f"Error: {event.code} - {event.message}")
```

### JavaScript

```javascript
connection.on("session_started", (data) => {
  console.log("Session:", data.sessionId);
});

connection.on("partial_transcript", (data) => {
  console.log("Partial:", data.text);
});

connection.on("committed_transcript", (data) => {
  console.log("Final:", data.text);
});

connection.on("committed_transcript_with_timestamps", (data) => {
  for (const word of data.words) {
    console.log(`  ${word.text}: ${word.start}s - ${word.end}s`);
  }
});

connection.on("error", (error) => {
  console.error("Error:", error.code, error.message);
});
```
