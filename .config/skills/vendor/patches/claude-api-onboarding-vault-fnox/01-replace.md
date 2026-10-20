{{marker}}
**2. Credentials.** None? Skip, and drop `vault_ids` and `--vault-id`. Follow the local command-credential guide before changing credential storage or delivery. Keep API credentials in configured fnox workloads and application-managed OAuth in its native store. Never request secrets in chat, print them, paste them into commands, or write plaintext exports or credential files.

For each confirmed credential-table row, prepare a reviewable provisioning script containing no secret values. It reads the required value only from its injected environment and passes it to the vault API through stdin with a JSON encoder. Run it as `fnox exec -- sh path/to/provision-vault.sh` after the user has approved that table row and remote storage. If the fnox workload is missing, report the prerequisite and follow the credential guide's secure enrolment procedure.

Keep these controls in each script:

- Resolve the vault ID from `claude-lock.json`. Send the secret only to the exact host in its confirmed table row. Use the narrowest scope for the step that needs it.
- For MCP bearer credentials, match `mcp_server_url` to the agent's confirmed MCP server URL. For an environment-variable credential, set its confirmed `secret_name`, limited `allowed_hosts`, and required injection location.
- Before a live agent run, check authentication and read access to each source or destination through the vendor's documented endpoints. Those checks use only the confirmed host and injected variables. Never enable shell tracing or print request bodies containing credentials.
- Count the vault's credentials with `ant beta:vaults:credentials list --vault-id "$VAULT_ID"`. The listing shows names and hosts. Do not continue until every approved table row is present and its checks pass.

A vault container is managed by `ant apply`; credentials are provisioned separately and stay outside version control. Browser-only OAuth uses the server's own documented flow. Report any missing scope, uncertain host, or unavailable secure delivery as a concrete prerequisite.
