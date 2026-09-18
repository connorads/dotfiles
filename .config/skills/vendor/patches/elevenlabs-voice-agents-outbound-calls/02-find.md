```javascript
const response = await client.conversationalAi.twilio.outboundCall({
  agentId: "your-agent-id",
  agentPhoneNumberId: "your-phone-number-id",
  toNumber: "+1234567890",
  callRecordingEnabled: true,
  conversationInitiationClientData: {
    branchId: "branch_support_staging",
    environment: "staging",
    conversationConfigOverride: {
      agent: {
        firstMessage: "Hello! This is a reminder about your appointment tomorrow.",
        language: "en",
      },
      tts: {
        voiceId: "JBFqnCBsd6RMkjVDRZzb",
      },
    },
    dynamicVariables: {
      customer_name: "John",
      appointment_time: "2:00 PM",
    },
  },
});
```
