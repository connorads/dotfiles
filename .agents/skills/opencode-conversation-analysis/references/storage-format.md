# OpenCode Storage Format

OpenCode currently stores session history in SQLite.
Older installs may still have legacy JSON files.

## Current Format (SQLite)

### Location

```text
~/.local/share/opencode/
├── opencode.db
├── opencode.db-shm
└── opencode.db-wal
```

### Core Tables

- `session`
  - `id` (session id, e.g. `ses_xxx`)
  - `parent_id` (`NULL` for main sessions, set for subagent sessions)
  - `title`
  - `time_created`, `time_updated`
- `message`
  - `id` (message id, e.g. `msg_xxx`)
  - `session_id`
  - `data` (JSON blob; includes `role`, agent/model metadata)
- `part`
  - `id` (part id, e.g. `prt_xxx`)
  - `message_id`
  - `session_id`
  - `data` (JSON blob; includes `type`, `text`, tool payloads)

### JSON Fields Used by This Skill

- User message role: `json_extract(message.data, '$.role') = 'user'`
- Text parts: `json_extract(part.data, '$.type') = 'text'`
- Text content: `json_extract(part.data, '$.text')`

### Useful Queries

Count main sessions:

```sql
SELECT COUNT(*)
FROM session
WHERE parent_id IS NULL;
```

Count user messages (main sessions only):

```sql
SELECT COUNT(*)
FROM message m
JOIN session s ON s.id = m.session_id
WHERE s.parent_id IS NULL
  AND json_extract(m.data, '$.role') = 'user';
```

Extract user text payloads:

```sql
SELECT
  s.id AS session_id,
  COALESCE(s.title, 'untitled') AS session_title,
  m.id AS message_id,
  m.time_created AS timestamp,
  json_extract(p.data, '$.text') AS text
FROM session s
JOIN message m ON m.session_id = s.id
JOIN part p ON p.message_id = m.id
WHERE s.parent_id IS NULL
  AND json_extract(m.data, '$.role') = 'user'
  AND json_extract(p.data, '$.type') = 'text'
ORDER BY m.time_created, p.time_created;
```

## Legacy Format (JSON Files)

Some older OpenCode versions wrote files under:

```text
~/.local/share/opencode/storage/
├── session/{project_id}/{session_id}.json
├── message/{session_id}/{message_id}.json
└── part/{message_id}/{part_id}.json
```

Legacy key fields:

- `session.parentID`: `null` means main session
- `message.role`: `user` or `assistant`
- `part.type`: `text`, `tool`, etc.
- `part.text`: text payload for `type = text`

## Notes

- The extraction script in this skill prefers SQLite and only falls back to legacy JSON storage if needed.
- For large analyses, always chunk output and pass chunk paths to subagents (do not inline full transcripts).
