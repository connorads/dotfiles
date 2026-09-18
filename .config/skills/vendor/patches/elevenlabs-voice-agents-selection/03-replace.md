const agent = await client.conversationalAi.agents.create({
  name: "My Assistant",
  conversationConfig: {
    agent: {
      firstMessage: "Hello! How can I help?",
      language: "en",
      prompt: {
        prompt: "You are a helpful assistant.",
        llm: "gemini-2.0-flash",
        temperature: 0.7
      }
    },
    tts: { voiceId: "selected_voice_id" }
  }
});
```
