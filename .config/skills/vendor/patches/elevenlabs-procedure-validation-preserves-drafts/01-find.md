A failed publish writes nothing, so when you are ready to publish, the publish itself is the validation step. Use the flow below only when you need to check structured content and are not ready to publish, for example while other edits on the branch are still pending, or on a protected branch you cannot publish to.

Saving an agent draft runs the same validation as publish and returns the same `procedure_validation_failed` payload. This is how the dashboard surfaces errors while editing. The endpoint is `POST /v1/convai/agents/{agent_id}/drafts?branch_id=...` (`agents.drafts.create` in the SDKs). There is no CLI command for it.

The body is the full agent draft, not a flag: `name`, `conversation_config`, `platform_settings`, and `workflow` are all required. Read them from the agent and resend them unchanged. Do not edit anything else in that body; a validation check is not the place to change agent configuration.

```bash
AGENT=$(
  curl -sS "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID" \
    -H "xi-api-key: $ELEVENLABS_API_KEY"
)

curl -sS -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/drafts?branch_id=$BRANCH_ID" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(printf '%s' "$AGENT" | jq '{name, conversation_config, platform_settings, workflow}')"
```

A `400` with `procedure_validation_failed` carries the same `errors` map as a failed publish. Repair the procedure draft with `PATCH .../procedures/{procedure_id}/draft` and save the agent draft again.

A `200` means every structured procedure on the branch validated, and it also stored an agent draft for you on that branch. If you only wanted the check, discard it with `DELETE /v1/convai/agents/{agent_id}/drafts?branch_id=...` (`agents.drafts.delete`) so it does not linger as an unsaved change in the dashboard. Discarding the agent draft does not touch your procedure drafts.

