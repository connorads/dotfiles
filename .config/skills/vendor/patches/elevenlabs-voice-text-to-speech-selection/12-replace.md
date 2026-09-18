```python
response = client.text_to_speech.convert.with_raw_response(
    text="Hello!", voice_id="selected_voice_id", model_id="eleven_multilingual_v2"
)
audio = response.parse()
print(f"Characters used: {response.headers.get('x-character-count')}")
```
