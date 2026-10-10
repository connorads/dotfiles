# Cache Hits for BB

Show each thread's prompt-cache hit rate and misses in the thread header.

## Use

The header chip shows the share of the last prompt read from cache, coloured
green (80%+), yellow (50%+) or red. A miss count appears once the thread has
one. Hover the chip for last read and write tokens, the thread-wide hit rate,
and the size and idle gap of the last miss.

The chip appears after the plugin sees the thread's first usage event. BB keeps
only recent usage events, so turns from before installation are not counted.

## How it reads usage

The plugin folds every `thread/tokenUsage/updated` and
`thread/contextWindowUsage/updated` event into per-thread state in plugin
storage. `thread/compacted` and `thread/context/cleared` reset the baseline.

Providers report the same fields with different meanings:

| Provider | Prompt size | Usage event |
| --- | --- | --- |
| Codex | `inputTokens` (includes cached tokens) | per request |
| Claude Code | `inputTokens + cachedInputTokens` | per turn, summed over its requests |
| Pi | `inputTokens + cachedInputTokens` | treated as per request; unverified |

Two miss rules follow from that granularity:

- Per request: `min(previous prompt, this prompt) - cache reads`. This is
  Pi's own rule (`core/cache-stats.js`).
- Per turn: `cache writes - context growth since the end of the last turn`.
  A warm turn writes about what it added; a cold turn also rewrites the old
  prefix. Claude Code streams context readings mid-turn, so only the reading
  after a turn's usage event counts.

Misses of 1024 tokens or fewer are cache breakpoint noise and are ignored.
BB does not expose cache lifetimes, so there is no expiry countdown.

## Develop

```sh
pnpm test
pnpm typecheck
pnpm build && bb plugin reload cache-hits
```
