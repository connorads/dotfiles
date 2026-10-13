```python
response = client.text_to_speech.convert.with_raw_response(
    text="Hello!", voice_id="JBFqnCBsd6RMkjVDRZzb", model_id="eleven_v4"
)
audio = response.parse()
print(f"Characters used: {response.headers.get('x-character-count')}")
```
