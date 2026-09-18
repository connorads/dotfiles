```python
agent = client.conversational_ai.agents.create(
    name="Weather Assistant",
    conversation_config={
        "agent": {
            "prompt": {
                "prompt": "You are a helpful assistant that can check the weather.",
                "llm": "gemini-2.0-flash",
                "tools": [{
                    "type": "webhook",
                    "name": "get_weather",
                    "description": "Get current weather for a city. Use when user asks about weather.",
                    "api_schema": {
                        "url": "https://api.example.com/weather",
                        "method": "POST",
                        "request_headers": {
                            "Authorization": "Bearer {{API_KEY}}"
                        },
                        "request_body_schema": {
                            "type": "object",
                            "properties": {
                                "city": {
                                    "type": "string",
                                    "description": "City name, e.g., 'San Francisco'"
                                },
                                "units": {
                                    "type": "string",
                                    "enum": ["celsius", "fahrenheit"],
                                    "description": "Temperature units"
                                }
                            },
                            "required": ["city"]
                        }
                    }
                }]
            }
        },
        "tts": {"voice_id": "selected_voice_id"}
    }
)
```
