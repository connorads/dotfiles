agent = client.conversational_ai.agents.create(
    name="My Assistant",
    conversation_config={
        "agent": {
            "first_message": "Hello! How can I help?",
            "language": "en",
            "prompt": {
                "prompt": "You are a helpful assistant. Be concise and friendly.",
                "llm": "gemini-2.0-flash",
                "temperature": 0.7
            }
        },
        "tts": {"voice_id": "JBFqnCBsd6RMkjVDRZzb"}
    }
)
```
