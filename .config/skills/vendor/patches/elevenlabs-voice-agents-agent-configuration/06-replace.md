```python
agent = client.conversational_ai.agents.create(
    name="Quick Assistant",
    conversation_config={
        "agent": {
            "first_message": "Hey! What do you need?",
            "prompt": {
                "prompt": "Fast, efficient assistant. Brief answers.",
                "llm": "gemini-2.0-flash",
                "temperature": 0.3,
                "max_tokens": 100
            }
        },
        "tts": {"voice_id": "selected_voice_id", "model_id": "eleven_flash_v2_5"},
        "turn": {"turn_eagerness": "eager", "turn_timeout": 3}
    }
)
```
