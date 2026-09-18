```python
agent = client.conversational_ai.agents.create(
    name="Shopping Assistant",
    conversation_config={
        "agent": {
            "prompt": {
                "prompt": """You are a shopping assistant.
When users want to see a product, use show_product.
When users want to go somewhere, use navigate_to.""",
                "llm": "gemini-2.0-flash",
                "tools": [
                    {
                        "type": "client",
                        "name": "show_product",
                        "description": "Display a product card to the user",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "productId": {
                                    "type": "string",
                                    "description": "Product ID to display"
                                }
                            },
                            "required": ["productId"]
                        }
                    },
                    {
                        "type": "client",
                        "name": "navigate_to",
                        "description": "Navigate user to a different page",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "page": {
                                    "type": "string",
                                    "enum": ["cart", "checkout", "account", "home"],
                                    "description": "Page to navigate to"
                                }
                            },
                            "required": ["page"]
                        }
                    }
                ]
            }
        },
        "tts": {"voice_id": "selected_voice_id"}
    }
)
```
