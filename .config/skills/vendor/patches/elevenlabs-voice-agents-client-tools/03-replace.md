Always verify order ID before lookup. Offer transfer for complex issues.""",
                "llm": "gemini-2.0-flash",
                "tools": [
                    # Webhook: Server-side order lookup
                    {
                        "type": "webhook",
                        "name": "lookup_order",
                        "description": "Look up order status by order ID or email",
                        "api_schema": {
                            "url": "https://api.mystore.com/orders/lookup",
                            "method": "POST",
                            "request_headers": {"Authorization": "Bearer {{API_KEY}}"},
                            "request_body_schema": {
                                "type": "object",
                                "properties": {
                                    "order_id": {"type": "string"},
                                    "email": {"type": "string"}
                                }
                            }
                        }
                    },
                    # Client: Browser-side product display
                    {
                        "type": "client",
                        "name": "show_product",
                        "description": "Display product details to the customer",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "product_id": {"type": "string"}
                            },
                            "required": ["product_id"]
                        }
                    }
                ],
                "built_in_tools": {
                    "end_call": {},
                    "transfer_to_number": {
                        "transfers": [{
                            "transfer_destination": {"type": "phone", "phone_number": "+1234567890"},
                            "condition": "User asks for human support"
                        }]
                    }
                }
            }
        },
        "tts": {"voice_id": "selected_voice_id", "model_id": "eleven_flash_v2_5"}
    }
)
```
