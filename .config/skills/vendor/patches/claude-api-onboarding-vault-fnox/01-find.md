**2. Credentials - the user runs these, in a terminal of their own, not through you.** (None? Skip, and drop `vault_ids` and `--vault-id`.) Print one block per row of the confirmed table, each under a line saying where the secret goes, and tell the user to **run them one at a time**: paste one block, type the secret at the silent prompt, wait for the created credential to print, then the next. Pasted together, the first `read -rs` takes the next block's first line as the secret and that credential is never created.

```sh
VAULT_ID=$(jq -r '.resources["./agents/daily-brief/vault.yaml"].id' claude-lock.json)
read -rs CMA_LINEAR_TOKEN && export CMA_LINEAR_TOKEN     # paste at the silent prompt: nothing lands in shell history

# Sends your Linear token to mcp.linear.app (matched to the agent's MCP server by URL)
jq -n -f /dev/stdin <<'JQ' | ant beta:vaults:credentials create --vault-id "$VAULT_ID"
{
  display_name: "Linear",
  auth: {
    type: "static_bearer",
    mcp_server_url: "https://mcp.linear.app/mcp",
    token: (env.CMA_LINEAR_TOKEN // error("CMA_LINEAR_TOKEN is not set"))
  }
}
JQ
```

```sh
read -rs CMA_ACME_API_KEY && export CMA_ACME_API_KEY
# Sends your Acme key to api.acme.com only. The sandbox sees a placeholder; the real value is substituted at egress
jq -n -f /dev/stdin <<'JQ' | ant beta:vaults:credentials create --vault-id "$VAULT_ID"
{
  display_name: "Acme API",
  auth: {
    type: "environment_variable",
    secret_name: "ACME_API_KEY",
    secret_value: (env.CMA_ACME_API_KEY // error("CMA_ACME_API_KEY is not set")),
    networking: {type: "limited", allowed_hosts: ["api.acme.com"]},
    injection_location: {header: true}
  }
}
JQ
```

**Before clearing the variables, the user checks each token against its service**, in the same terminal, and tells you the result. Otherwise a wrong token, a missing scope or a missing invite shows up one failed run at a time. **Every check contacts only the host in that credential's confirmed table row (§3), byte for byte, named on the line above the command** - a check against any other host would send the secret there, so leave it out and say so:

- **It authenticates**: the vendor's cheapest "who am I" call, from the vendor's own docs, with the token read from its `CMA_*` variable - never pasted into the command. It should name the account, bot or workspace the user expects.
- **It reaches the specific things the job names**: one read of each source and, where the vendor has a way to check without writing, the destination. For a Slack bot that is `auth.test`, then `conversations.history` on each source channel and `conversations.info` on the destination to confirm the bot is a member. A check that fails right after a change the user just made (a bot just invited, a scope just added) can lag: have them re-run it after a minute before debugging further.

As soon as the checks are done, pass or fail, the user clears the variables in their terminal: `unset CMA_LINEAR_TOKEN CMA_ACME_API_KEY`. Then count the credentials yourself - the listing shows names and hosts, never secrets - and don't go on until every row of the table is there:

```sh
VAULT_ID=$(jq -r '.resources["./agents/daily-brief/vault.yaml"].id' claude-lock.json)
ant beta:vaults:credentials list --vault-id "$VAULT_ID"    # N rows in the table -> N credentials here
```

- **Never ask for a secret in the chat, and never write one to a file.** No `.env`, whatever the page does.
- **The local variable is a fresh `CMA_<SOMETHING>`,** so an already-exported `GITHUB_TOKEN` or `AWS_SECRET_ACCESS_KEY` can't be picked up silently. `secret_name`, which the sandbox sees, may be what the job's tooling expects.
- **Keep the heredoc delimiter quoted** so the shell expands nothing in the body, and keep `"`, `!`, `$`, backticks, backslashes and newlines out of the values in it: a `"` ends the jq string and what follows runs as jq, which can read every exported variable. A value that holds one is not a typo to clean up; leave it out and tell the user.
- **Browser-only OAuth?** Point at the server's own OAuth docs and print the `mcp_oauth` command with its variables to fill (`shared/managed-agents-tools.md` -> Vaults).
