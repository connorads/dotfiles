const agent = await client.conversationalAi.agents.create({
  name: "My Assistant",
  conversationConfig: {
    agent: {
      firstMessage: "Hello! How can I help?",
      language: "en",
      prompt: {
        prompt: "You are a helpful assistant.",
        llm: "gemini-3.5-flash",
        temperature: 0.7
      }
    },
    tts: { voiceId: "JBFqnCBsd6RMkjVDRZzb" }
  }
});
```
