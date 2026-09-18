```python
response = client.conversational_ai.twilio.outbound_call(
    agent_id="your-agent-id",
    agent_phone_number_id="your-phone-number-id",
    to_number="+1234567890",
    call_recording_enabled=True,
    conversation_initiation_client_data={
        "branch_id": "branch_support_staging",
        "environment": "staging",
        "conversation_config_override": {
            "agent": {
                "first_message": "Hello! This is a reminder about your appointment tomorrow.",
                "language": "en"
            },
            "tts": {
                "voice_id": "selected_voice_id"
            }
        },
        "dynamic_variables": {
            "customer_name": "John",
            "appointment_time": "2:00 PM"
        }
    }
)
```
