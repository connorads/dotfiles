To hand the active credential to a subprocess or raw-HTTP script:

```sh
# Bare access token - for curl's Authorization header
curl https://api.anthropic.com/v1/messages \
  -H "Authorization: Bearer $(ant auth print-credentials --access-token)" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: oauth-2025-04-20" \
  -H "content-type: application/json" \
  -d '{"model": "claude-opus-5-5", "max_tokens": 1024, "messages": [{"role": "user", "content": "Hello"}]}'

# .env format - sets ANTHROPIC_AUTH_TOKEN (and ANTHROPIC_BASE_URL if the profile has one).
# Output is bare KEY=value (no `export`), so use `set -a` to auto-export for child processes:
set -a; eval "$(ant auth print-credentials --env)"; set +a
python my_script.py   # SDK picks up ANTHROPIC_AUTH_TOKEN
```

OAuth tokens go on `Authorization: Bearer` (not `x-api-key:`) **plus the `anthropic-beta: oauth-2025-04-20` header** - converting a raw curl/httpx script from an API key is a header change, not a key swap. The beta header requirement is endpoint-dependent (some endpoints happen to work without it; `/v1/messages` does not) - always send it so requests don't break when you switch endpoints. The token is short-lived and not auto-refreshed when passed via env var, so re-run `print-credentials` before it expires for long-running scripts (`print-credentials` itself refreshes the token if needed). If both `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are set, the SDKs send both and the API rejects the request - unset `ANTHROPIC_API_KEY` before `eval`ing the `--env` output.

**Foot-gun:** `ant auth print-credentials` with **no flags** prints the entire credentials JSON, not the bare token - putting that in an `Authorization` header yields an empty response or HTTP/2 protocol error. Always use `--access-token` for headers (it always reads the named/active profile; a set `ANTHROPIC_API_KEY` doesn't override credential printing).
