# web-search

Web search tool for pi. Searches via [Exa](https://exa.ai/) or [Brave](https://brave.com/search/api/), returns source URLs with snippets.

## Configuration

API keys can be provided via environment variables or `~/.pi/web-search.json` (env vars take precedence).

### Environment variables

```sh
export EXA_API_KEY=...
export BRAVE_SEARCH_API_KEY=...  # or BRAVE_API_KEY
```

### Config file

Create `~/.pi/web-search.json` (recommended — works regardless of how pi is launched):

```json
{
  "exaApiKey": "...",
  "braveApiKey": "..."
}
```

This file is auto-gitignored by `/.pi/**`. Set permissions to `600`:

```sh
chmod 600 ~/.pi/web-search.json
```

### Provider selection

Defaults to Exa when `EXA_API_KEY` / `exaApiKey` is set, otherwise Brave. Override per-call with the `provider` parameter.

## Usage

The tool registers as `web_search`. Use it for URL discovery, then fetch pages separately with bash/curl.

```
web_search query="rust async runtimes" limit=5
web_search query="WCAG 2.2 changes" provider="brave"
```

## Tests

```sh
node --test core.test.mjs
```
