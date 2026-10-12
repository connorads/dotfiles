# Cache Hits for BB

Show each thread's prompt-cache state in the thread header.

## Use

The header chip counts down to cache expiry in whole minutes, with seconds in
the last two, then shows `cold`. Without a lifetime, as on Codex, it shows the
share of the last request read from cache. A miss count sits beside the dot once
the thread has one. The dot follows time left (green over 50%, yellow
over 20%, then red). Without a lifetime, as on Codex, it follows the hit rate
(green 80%+, yellow 50%+, then red).

Hover the chip for last read and write tokens, the thread-wide hit rate, and
the size and idle gap of the last miss.

## How it reads usage

```mermaid
flowchart LR
  E[experimental_thread.events / thread.idle] --> S[server: sync thread]
  S -->|Codex, Pi| B[BB usage events]
  S -->|Claude Code| H[host: read new transcript bytes]
  B --> F[fold per request]
  H --> F
  F --> K[plugin kv] --> C[header chip]
```

| Provider | Source | Prompt size | Lifetime |
| --- | --- | --- | --- |
| Codex | `thread/tokenUsage/updated` | `inputTokens` (includes cached tokens) | not reported |
| Pi | `thread/tokenUsage/updated`, last request of each turn | `inputTokens + cachedInputTokens` | not reported |
| Claude Code | `~/.claude/projects/*/<session>.jsonl` | `input + cache read + cache write` | `cache_creation.ephemeral_5m/1h` |

BB sums Claude Code usage per turn, so the plugin reads per-request usage from
Claude Code's own transcript instead. The host component reads only bytes added
since the last read. It finds the session from `thread/identity` and the
config directory from `CLAUDE_CONFIG_DIR` in `provider.env-resolved`. Claude
Code logs one line per content block, so each message id counts once. Subagent
entries and other entry types are skipped. The transcript format is internal
to Claude Code and can change in any release.

A request misses when `min(previous prompt, this prompt) - cache reads` is
over 1024 tokens. This is Pi's rule (`core/cache-stats.js`). Compaction and
context clears reset the baseline.

Anthropic keeps each account's prompt cache separate. After an account switch,
[Claude Profiles](../claude-profiles/README.md) calls this plugin's `invalidate`
RPC. The chip shows `cold` at once, and the next miss reads "after account
switch" instead of an idle time.

Expiry is the last request time plus its cache lifetime, because Anthropic
refreshes a cache entry each time a request reads it. The transcript stamps
the response, not the request start, so the countdown runs a few seconds long.

BB keeps only recent usage events, so Codex and Pi turns from before
installation are not counted.

BB emits Pi usage once per turn, at `agent_end`, from the turn's last
request only. Pi hit rates are exact for that request. Pi misses are
undercounted: a turn that starts cold rebuilds the cache on its first request,
so its last request reads cache again.

## Develop

```sh
pnpm test
pnpm typecheck
pnpm build && bb plugin reload cache-hits
```
