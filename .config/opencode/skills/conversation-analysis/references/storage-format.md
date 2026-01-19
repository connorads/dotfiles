# OpenCode Storage Format

OpenCode stores conversations as JSON files in a hierarchical structure.

## Location

```
~/.local/share/opencode/storage/
├── session/{project_id}/{session_id}.json
├── message/{session_id}/{message_id}.json
└── part/{message_id}/{part_id}.json
```

## Session Files

**Path**: `session/{project_id}/{session_id}.json`

```json
{
  "id": "ses_xxx",
  "projectID": "abc123" | "global",
  "directory": "/path/to/project",
  "parentID": "ses_yyy" | null,  // null = main session, set = subagent
  "title": "Session title",
  "time": {
    "created": 1700000000000,
    "updated": 1700000001000
  }
}
```

**Key fields:**
- `parentID`: If null, this is a main session. If set, it's a subagent child session.
- `projectID`: "global" for sessions not tied to a specific project.

## Message Files

**Path**: `message/{session_id}/{message_id}.json`

```json
{
  "id": "msg_xxx",
  "sessionID": "ses_xxx",
  "role": "user" | "assistant",
  "time": { "created": 1700000000000 },
  "parentID": "msg_yyy"  // assistant messages link to their user message
}
```

**Key fields:**
- `role`: "user" for human messages, "assistant" for AI responses.
- Messages are metadata only - actual content is in parts.

## Part Files

**Path**: `part/{message_id}/{part_id}.json`

```json
{
  "id": "prt_xxx",
  "sessionID": "ses_xxx",
  "messageID": "msg_xxx",
  "type": "text" | "tool" | "file" | ...,
  "text": "The actual message content"  // for type="text"
}
```

**Key fields:**
- `type`: "text" parts contain the actual message content.
- `text`: The message text (only present for text parts).

## Useful Queries

### Count main sessions
```bash
find ~/.local/share/opencode/storage/session -name '*.json' -exec cat {} + | \
  jq -r 'select(.parentID == null) | .id' | wc -l
```

### Count user messages
```bash
find ~/.local/share/opencode/storage/message -name '*.json' -exec cat {} + | \
  jq -r 'select(.role == "user") | .id' | wc -l
```

### Get date range
```bash
# Earliest
find ~/.local/share/opencode/storage/session -name '*.json' -exec cat {} + | \
  jq -r 'select(.parentID == null) | .time.created' | sort -n | head -1 | \
  xargs -I{} date -r $(({} / 1000)) '+%Y-%m-%d'

# Latest  
find ~/.local/share/opencode/storage/session -name '*.json' -exec cat {} + | \
  jq -r 'select(.parentID == null) | .time.created' | sort -n | tail -1 | \
  xargs -I{} date -r $(({} / 1000)) '+%Y-%m-%d'
```
