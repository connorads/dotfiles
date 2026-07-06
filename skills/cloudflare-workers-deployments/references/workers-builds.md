# Workers Builds Reference

Use this reference to create or repair a Cloudflare Workers Builds setup. Replace
all angle-bracket placeholders before running commands.

## Repo Preparation

Expected baseline for a static-assets Worker:

```jsonc
// wrangler.jsonc
{
  "name": "<worker-name>",
  "compatibility_date": "<yyyy-mm-dd>",
  "assets": {
    "directory": "./dist"
  },
  "routes": [
    { "pattern": "<hostname>", "custom_domain": true }
  ]
}
```

Package scripts should make the deploy command unambiguous:

```json
{
  "scripts": {
    "check": "<typecheck-command>",
    "build": "<build-command>",
    "deploy": "wrangler deploy",
    "deploy:dry-run": "wrangler deploy --dry-run"
  },
  "devDependencies": {
    "wrangler": "<pinned-version>"
  }
}
```

For pnpm, configure Workers Builds with `pnpm run deploy`, not `pnpm deploy`.
The latter can resolve to pnpm's built-in deploy command and fail with
`ERR_PNPM_NOTHING_TO_DEPLOY`.

If a `pnpm-workspace.yaml` exists, include a non-empty `packages` field:

```yaml
packages:
  - .
```

Avoid unnecessary pnpm overrides in CI deploy repos. If a dependency override is
needed, verify the exact Cloudflare build-image pnpm version can run
`install --frozen-lockfile`, or set `PNPM_VERSION` in Workers Builds to match the
lockfile producer.

## Read Checks

```bash
cf auth whoami
cf context show
cf workers scripts search --name <worker-name>
cf workers deployments list --script-name <worker-name>
cf workers domains list --hostname <hostname>
cf workers-builds tokens list
cf workers-builds triggers list --external-script-id <worker-id-or-tag>
```

Use `gh api` for GitHub numeric IDs:

```bash
gh api users/<owner> --jq '.id'          # user account
gh api orgs/<owner> --jq '.id'           # organisation account
gh api repos/<owner>/<repo> --jq '.id'
```

## Create A Worker Project Without Local Deployment

When the Worker does not exist and the user wants Workers Builds, create the
Worker shell first. This creates a project object but no deployed version.

```bash
cf workers beta workers create \
  --name <worker-name> \
  --tags workers-builds \
  --subdomain-enabled false \
  --observability-enabled true \
  --observability-head-sampling-rate 1 \
  --observability-logs-enabled true \
  --observability-logs-head-sampling-rate 1 \
  --observability-logs-invocation-logs true \
  --observability-logs-persist true
```

Verify:

```bash
cf workers scripts search --name <worker-name>
cf workers beta workers versions list --worker-id <worker-id>
cf workers deployments list --script-name <worker-name>
```

Expected for a new shell: scripts search returns the Worker, versions list is
empty, and deployments list is empty.

## Connect Git Repository

Cloudflare's GitHub App must already be authorised for the owner/repo. Then
upsert the repository connection:

```bash
cf workers-builds repos connections upsert \
  --provider-type github \
  --provider-account-id <github-owner-id> \
  --provider-account-name <owner> \
  --repo-id <github-repo-id> \
  --repo-name <repo>
```

Save `repo_connection_uuid`.

## Create Or Update A Trigger

The CLI may not serialise empty arrays cleanly for trigger creation. If the
normal CLI fails or nests a raw `--body`, call the REST endpoint directly while
reading the local OAuth token in-process.

Create a production trigger:

```js
// node script; do not print auth.oauth_token
const fs = require("fs");

const accountId = "<account-id>";
const auth = JSON.parse(fs.readFileSync("<cf-auth-json-path>", "utf8"));
const body = {
  external_script_id: "<worker-id-or-tag>",
  repo_connection_uuid: "<repo-connection-uuid>",
  build_token_uuid: "<build-token-uuid>",
  trigger_name: "Deploy production",
  build_command: "pnpm install --frozen-lockfile && pnpm build",
  deploy_command: "pnpm run deploy",
  root_directory: "/",
  branch_includes: ["main"],
  branch_excludes: [],
  path_includes: ["*"],
  path_excludes: [],
  build_caching_enabled: true
};

await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/triggers`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${auth.oauth_token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(body)
});
```

Update only the deploy command:

```js
await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/triggers/${triggerUuid}`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${auth.oauth_token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ deploy_command: "pnpm run deploy" })
});
```

Toggle build cache:

```js
body: JSON.stringify({ build_caching_enabled: true })
```

## Trigger And Monitor Builds

Manual build via documented REST shape:

```js
await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/triggers/${triggerUuid}/builds`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${auth.oauth_token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ branch: "main", commit_hash: "<optional-commit-sha>" })
});
```

Monitor:

```bash
cf workers-builds builds list --external-script-id <worker-id-or-tag>
cf workers-builds builds get <build-uuid>
cf workers-builds builds logs get <build-uuid>
```

Verify deployment:

```bash
cf workers deployments list --script-name <worker-name>
cf workers beta workers versions list --worker-id <worker-id>
cf workers domains list --hostname <hostname>
dig +short <hostname>
curl -sS -D - -o /tmp/worker-body https://<hostname>/ | sed -n '1,80p'
```

If local DNS has stale negative cache but authoritative DNS resolves, verify the
edge path with:

```bash
curl --resolve <hostname>:443:<cloudflare-edge-ip> https://<hostname>/
```
