```python
# Update name
client.conversational_ai.agents.update(agent_id="id", name="New Name")

# Update TTS voice
client.conversational_ai.agents.update(agent_id="id", conversation_config={
    "tts": {"voice_id": "selected_voice_id", "model_id": "eleven_v4_turbo"}
})

# Update prompt/LLM (nested in agent)
client.conversational_ai.agents.update(agent_id="id", conversation_config={
    "agent": {"prompt": {"prompt": "New instructions.", "llm": "claude-sonnet-4", "temperature": 0.8}}
})

# Update first message
client.conversational_ai.agents.update(agent_id="id", conversation_config={
    "agent": {"first_message": "Welcome back!"}
})

# Update platform settings
client.conversational_ai.agents.update(agent_id="id", platform_settings={
    "auth": {"enable_auth": True, "allowlist": [{"hostname": "myapp.com"}]}
})
```
