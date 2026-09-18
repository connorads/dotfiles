**JavaScript:**
```javascript
await client.conversationalAi.agents.update("id", { name: "New Name" });
await client.conversationalAi.agents.update("id", {
  conversationConfig: { tts: { voiceId: "selected_voice_id" } }
});
await client.conversationalAi.agents.update("id", {
  conversationConfig: { agent: { prompt: { prompt: "New instructions.", llm: "claude-sonnet-4" } } }
});
```
