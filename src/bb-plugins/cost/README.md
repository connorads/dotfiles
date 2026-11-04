# Cost

Cost estimates what Claude Code, Codex and Pi requests would cost at API list prices.
Subscription plans do not bill these amounts. The figures show usage in API terms.

## Use

- The thread header chip shows the thread's estimate. Hover over it for the split by token type and model.
  Click it to open the Usage page at that thread.
- The **Usage** page in the navigation rail shows the last 7, 30 or 90 days.
  It has daily totals and tables by thread, model and day. Usage outside BB threads appears as **Outside BB**.
- `bb cost backfill` reads all history. `bb cost status` shows progress. The [skill](skills/cost/SKILL.md) lists every command.

## How it reads usage

```mermaid
flowchart LR
  L[Provider session logs on each host] -->|host: list, read chunk| S[server: parse cursor per file]
  S --> D[(plugin SQLite: requests, cursors, sessions)]
  P[LiteLLM price file, refreshed every 6 h] --> D
  D -->|price at query time| C[thread chip]
  D --> U[Usage page]
```

Provider logs are the source, not BB events: each log line names its model, and the logs outlive BB's event retention.

| Provider | Files | One request | Key |
| --- | --- | --- | --- |
| Claude Code | `<config dir>/projects/**/*.jsonl` | `assistant` line with `message.usage` | `message.id` + `requestId` |
| Codex | `$CODEX_HOME/sessions/**`, `archived_sessions/` | `token_usage_record` line; model from the last `turn_context` | `response_id` |
| Pi | `~/.pi/agent/sessions/**` | assistant `message` with `usage` | `responseId` |

- A request seen twice counts once, and its larger copy wins. Claude Code rewrites lines as output streams in.
  Forks and resumes repeat requests under the same keys.
- Codex counts cached and written tokens inside `input_tokens`. The plugin subtracts them.
- Each file keeps a byte cursor. The requests of a chunk and its cursor commit in one transaction, so a scan resumes where it stopped.
- Sessions map to threads through each thread's `thread/identity` events. Claude Code config directories come from threads' resolved environments and the `claudeConfigDirs` setting.

## Pricing

The plugin stores token counts and prices them when read, so a new price file re-prices history.

- Cache writes split by lifetime. A 1-hour write uses LiteLLM's `_above_1hr` rate, or twice input where that rate is missing.
- A request past a model's long-context threshold uses the long-context rates for all its tokens. The threshold is 200k or 272k tokens.
- Fast mode uses OpenAI's `_priority` rates or Anthropic's `fast` multiplier.
- Models missing from the price file count as unpriced tokens rather than $0.

The price file is downloaded from LiteLLM's GitHub. A file with fewer than 50 usable chat models is rejected, and the last good copy stays in use.
A tampered file can only change the estimates.

## Settings

| Setting | Use |
| --- | --- |
| `claudeConfigDirs` | Extra Claude Code config directories, one per line. `~` and whole-segment `*` work. |
| `plans` | Subscription prices as `Name = monthly dollars`, one per line, for the plan-value multiple. |

## Limits

- Live updates follow a thread going idle, and a scan runs every 15 minutes. A new host starts from the past day until a backfill.
- Codex `.jsonl.zst` archives are not read.
- Day boundaries follow the BB server's local time zone.
