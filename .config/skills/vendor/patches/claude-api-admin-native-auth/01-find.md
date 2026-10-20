**Interactive OAuth token** - log in with the `ant` CLI under a dedicated profile (keeps routine commands from running with elevated access), then export the token. Tokens are short-lived; on 401, re-run the export. Profile and scope mechanics (why `org:admin` needs an explicit `--scope`, switching profiles): `shared/anthropic-cli.md`.

```bash
ant auth login --profile admin --scope "org:admin"
export ANTHROPIC_AUTH_TOKEN=$(ant auth print-credentials --profile admin --access-token)
# When done: unset ANTHROPIC_AUTH_TOKEN && ant profile activate default
```
