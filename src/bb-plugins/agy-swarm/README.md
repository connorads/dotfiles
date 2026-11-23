# Antigravity Swarm for BB

Live Swarm Board, Overview, and worker transcript inspector for Antigravity (`agy`) threads in BB.

## What it adds

- **Swarm board side panel** (`Cmd+Shift+S` / `Ctrl+Shift+S`, or from the thread panel actions):
  - **Overview:** coordinator goal, progress bar, workstreams from `plan.json`, and live worker status (`working`, `waiting`, `done`, `error`, `killed`), model, workspace mode, and activity.
  - **Board:** live append-only message feed from `board.jsonl` with `#seq`, `@mention` highlights, `[done]`/`[stall]` tags, and channel filtering.
  - **Workers:** live step-by-step inspection of any member's `transcript.jsonl` (tool calls, replies, tokens, and errors).
- **Composer stack card:** collapsible card above the composer whenever the current Antigravity thread has a swarm, showing live worker states and the latest board post with a button to open the full board.
- **Composer `+` menu:** **Start Antigravity swarm** inserts `/swarm` on `acp-antigravity*` threads and drafts.

## How it works

The plugin is strictly read-only. It resolves each thread's `providerId` and latest `thread/identity` (`providerThreadId`) on the server, then reads the swarm state on the thread's owning host:

- Default (`acp-antigravity`): `~/.gemini/antigravity-cli/brain/<sessionId>/.system_generated/swarm/`
- Isolated profiles (`acp-antigravity-profile-<name>`): `~/.local/share/agy-profiles/<name>/home/.gemini/antigravity-cli/brain/<sessionId>/.system_generated/swarm/`

Requires `agy >= 1.5.15` for `agy acp` to keep `session/prompt` open across swarm wakeups and preserve `/swarm` parsing on turn 1.
