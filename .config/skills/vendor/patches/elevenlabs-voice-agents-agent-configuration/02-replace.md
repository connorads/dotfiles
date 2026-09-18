```python
agent = client.conversational_ai.agents.create(
    name="Support Agent",
    conversation_config={
        "agent": {
            "prompt": {
                "prompt": "You are a support agent. Use the knowledge base to answer questions.",
                "llm": "gemini-2.0-flash",
                "knowledge_base": [
                    {"type": "file", "id": "doc-id", "name": "Product Guide", "usage_mode": "auto"}
                ],
                "rag": {
                    "enabled": True,
                    "embedding_model": "qwen3_embedding_4b",
                    "max_documents_length": 50000,
                    "max_retrieved_rag_chunks_count": 20
                }
            }
        },
        "tts": {"voice_id": "selected_voice_id"}
    }
)
```
