# /groksearch

Minimal Grok search skill: query X and the web using the xAI API, then return a concise summary with top sources.

This uses Grok's server-side `x_search` and `web_search` tools (not Claude WebSearch).

## Installation

```bash
# Clone or copy this directory into your Claude skills path
cp -R /path/to/groksearch-skill ~/.claude/skills/groksearch
```

## Configuration

Create a local config file for your API key:

```bash
mkdir -p ~/.config/groksearch
cat > ~/.config/groksearch/.env << 'EOF'
XAI_API_KEY=
EOF
chmod 600 ~/.config/groksearch/.env
```

Or set `XAI_API_KEY` in your environment.

## Usage

```bash
uv run ~/.claude/skills/groksearch/scripts/groksearch.py "your query"
```

### Options

```bash
--sources x|web|both
--days 30
--from-date YYYY-MM-DD
--to-date YYYY-MM-DD
--no-date
--model grok-4-1-fast
--max-sources 8
```

## Examples

```bash
# Find recent discussion on a topic (last 30 days by default)
uv run ~/.claude/skills/groksearch/scripts/groksearch.py "best AI image prompt formats"

# X only
uv run ~/.claude/skills/groksearch/scripts/groksearch.py "grok api updates" --sources x

# Web only, last 7 days
uv run ~/.claude/skills/groksearch/scripts/groksearch.py "xai search tools guide" --sources web --days 7
```
