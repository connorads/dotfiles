```python
agent = client.conversational_ai.agents.create(
    name="Support Agent",
    conversation_config={
        "agent": {
            "first_message": "Hi! Thanks for calling TechCorp support.",
            "language": "en",
            "prompt": {
                "prompt": "You are a customer support agent. Be helpful, professional, concise.",
                "llm": "gemini-2.0-flash",
                "temperature": 0.5,
                "built_in_tools": {
                    "end_call": {},
                    "transfer_to_number": {
                        "transfers": [{"transfer_destination": {"type": "phone", "phone_number": "+1234567890"}, "condition": "User asks for human support"}]
                    }
                }
            }
        },
        "tts": {"voice_id": "selected_voice_id", "model_id": "eleven_flash_v2_5"},
        "turn": {"turn_eagerness": "normal", "turn_timeout": 7},
        "conversation": {"max_duration_seconds": 900}
    }
)
```
