# Workers Builds Reference

Use this reference to create or repair a Cloudflare Workers Builds setup. Replace
all angle-bracket placeholders before running commands.

## Contents

- [Repo Preparation](#repo-preparation)
- [Tooling And Auth](#tooling-and-auth)
- [Read Checks](#read-checks)
- [Create A Worker Project Without Local Deployment](#create-a-worker-project-without-local-deployment)
- [Connect Git Repository](#connect-git-repository)
- [Create Or Update Triggers](#create-or-update-triggers)
- [Trigger And Monitor Builds](#trigger-and-monitor-builds)
- [Build Image, Installs, And Cache](#build-image-installs-and-cache)
- [Verify Deployment](#verify-deployment)
- [Docs](#docs)

## Repo Preparation

Derive configuration from the repo. Do not assume static assets, pnpm, repo root,
or `main`.

Inspect:

- `wrangler.toml`, `wrangler.jsonc`, or framework adapter config.
- `package.json` scripts, `packageManager`, lockfiles, and workspace files.
- Build output directory and whether the Worker is assets-only, module/API, or
  full-stack.
- Default/production branch, preview branch behaviour, root directory, and watch
  paths.

Common static-assets baseline:

```jsonc
// wrangler.jsonc
{
  "name": "<worker-name>",
  "compatibility_date": "<yyyy-mm-dd>",
  "assets": {
    "directory": "./dist"
  }
}
```

Common package-script baseline:

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

For other package managers, use the project-native command explicitly:

- npm: `npm run deploy`
- yarn: `yarn run deploy`
- bun: `bun run deploy`

If a `pnpm-workspace.yaml` exists, include a non-empty `packages` field:

```yaml
packages:
  - .
```

Workers Builds configuration is separate from Wrangler custom-build settings.
Check current docs before relying on Wrangler `custom_builds`.

## Tooling And Auth

Check tools before mutating Cloudflare:

```bash
cf --version
wrangler --version
jq --version
```

If a `cf` command is beta or its flags look wrong, inspect `cf schema <command>`
and compare with current Cloudflare docs before writing.

For Workers Builds REST calls:

- Use `CF_API_TOKEN`.
- The token must be user-scoped and include Workers Builds Configuration Edit.
- Add Workers Scripts Read if the script needs to fetch Worker tags.
- Do not use account-scoped API tokens for Builds API calls.
- Do not read or print the local Cloudflare CLI OAuth session token.
- Distinguish this API token from the build token UUID stored on a trigger.

Use a checked request helper for ad hoc Node snippets:

```js
const accountId = "<account-id>";
const apiToken = process.env.CF_API_TOKEN;
if (!apiToken) throw new Error("CF_API_TOKEN is required");

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const errors = (json.errors || []).map(({ code, message }) => ({ code, message }));
    throw new Error(`Cloudflare API failed ${res.status}: ${JSON.stringify(errors)}`);
  }
  return json;
}
```

## Read Checks

```bash
cf auth whoami
cf context show
cf workers scripts search --name <worker-name>
cf workers deployments list --script-name <worker-name>
cf workers domains list --hostname <hostname>
cf workers-builds tokens list
```

Get GitHub numeric IDs when needed:

```bash
gh api users/<owner> --jq '.id'          # user account
gh api orgs/<owner> --jq '.id'           # organisation account
gh api repos/<owner>/<repo> --jq '.id'
```

Get the Worker tag, documented as `external_script_id`, before Builds API calls:

```bash
curl -sS \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/scripts" |
  jq -r '.result[] | select(.id == "<worker-name>") | .tag'
```

Then use the tag, not the Worker name:

```bash
cf workers-builds triggers list --external-script-id <worker-tag>
cf workers-builds builds list --external-script-id <worker-tag>
```

## Create A Worker Project Without Local Deployment

When the Worker does not exist and the user wants Workers Builds, create the
Worker shell first. This creates a project object but no deployed version.

Use minimal logging by default:

```bash
cf workers beta workers create \
  --name <worker-name> \
  --subdomain-enabled false
```

Only enable observability, log persistence, or 100% sampling when the user has
confirmed the privacy/cost trade-off.

Verify:

```bash
cf workers scripts search --name <worker-name>
cf workers beta workers versions list --worker-id <worker-id>
cf workers deployments list --script-name <worker-name>
```

Expected for a new shell: scripts search returns the Worker, versions list is
empty, and deployments list is empty.

## Connect Git Repository

Cloudflare's GitHub or GitLab app must already be authorised for the owner/repo.
Then upsert the repository connection:

```bash
cf workers-builds repos connections upsert \
  --provider-type <github-or-gitlab> \
  --provider-account-id <provider-owner-id> \
  --provider-account-name <owner> \
  --repo-id <provider-repo-id> \
  --repo-name <repo>
```

Save `repo_connection_uuid`.

## Create Or Update Triggers

Before creating, patching, or manually firing a trigger, show the user:

- Cloudflare account and Worker name/tag.
- Git provider, owner, repository, and repo connection UUID.
- Production branch and any preview branch behaviour.
- Root directory and watch paths.
- Build command, deploy command, and non-production deploy command.
- Build token UUID source.
- Hostname/custom domain or route.

Ask for explicit confirmation before the write call. A successful production
build with a deploy command can publish live traffic.

Production trigger body:

```js
const body = {
  external_script_id: "<worker-tag>",
  repo_connection_uuid: "<repo-connection-uuid>",
  build_token_uuid: "<build-token-uuid>",
  trigger_name: "Deploy production",
  build_command: "<package-manager-install-and-build>",
  deploy_command: "<package-manager-run-deploy>",
  root_directory: "<root-directory>",
  branch_includes: ["<production-branch>"],
  branch_excludes: [],
  path_includes: ["<watch-path-glob>"],
  path_excludes: [],
  build_caching_enabled: true
};

const created = await cf("/builds/triggers", {
  method: "POST",
  body: JSON.stringify(body)
});
console.log(JSON.stringify({
  success: created.success,
  trigger_uuid: created.result?.id || created.result?.uuid
}));
```

Preview/non-production builds usually use `wrangler versions upload` or a
project-specific equivalent, producing preview URLs instead of live deployments.
Confirm the current Cloudflare trigger limit and preview field names in docs/API
schema before writing; current docs describe up to one production and one preview
trigger per Worker.

Patch only the changed field:

```js
await cf("/builds/triggers/<trigger-uuid>", {
  method: "PATCH",
  body: JSON.stringify({ deploy_command: "<package-manager-run-deploy>" })
});
```

Toggle build cache:

```js
await cf("/builds/triggers/<trigger-uuid>", {
  method: "PATCH",
  body: JSON.stringify({ build_caching_enabled: true })
});
```

Deploy hooks are another trigger mechanism. Treat the hook URL itself as a
secret credential: do not print it, commit it, or paste it into logs.

## Trigger And Monitor Builds

Manual production build via documented REST shape:

```js
const build = await cf("/builds/triggers/<trigger-uuid>/builds", {
  method: "POST",
  body: JSON.stringify({
    branch: "<production-branch>",
    commit_hash: "<optional-commit-sha>"
  })
});
console.log(JSON.stringify({
  success: build.success,
  build_uuid: build.result?.id || build.result?.uuid,
  status: build.result?.status
}));
```

Monitor status:

```bash
cf workers-builds builds list --external-script-id <worker-tag>
cf workers-builds builds get <build-uuid>
```

Fetch logs only when needed, redact tokens/URLs, and summarise the failing
commands. Do not paste raw logs into chat by default.

## Build Image, Installs, And Cache

Read the current build-image docs before relying on default runtime versions.
Prefer repo-pinned tools or Cloudflare-supported version variables/files.

Useful knobs:

- `NODE_VERSION`, `PNPM_VERSION`, `YARN_VERSION`, and `BUN_VERSION` when the
  docs support them for the current image.
- `SKIP_DEPENDENCY_INSTALL` when the build command must control installs itself.
- Package-manager caches and some framework output caches are restored between
  builds, but cache retention and limits are not a correctness guarantee.

After package-manager or lockfile changes:

```bash
cf workers-builds triggers purge-cache <trigger-uuid> --force
```

Temporarily disabling build cache is useful for diagnosis. Re-enable it after a
clean build unless the user wants cache disabled.

## Verify Deployment

Use layered checks and avoid dumping protected content:

```bash
cf workers deployments list --script-name <worker-name>
cf workers beta workers versions list --worker-id <worker-id>
cf workers domains list --hostname <hostname>
dig @1.1.1.1 +short <hostname> A
dig @1.1.1.1 +short <hostname> AAAA
curl -sS -I https://<hostname>/
```

If Access protects the hostname, unauthenticated verification should show an
Access redirect/challenge rather than application HTML.

## Docs

- Workers Builds overview:
  <https://developers.cloudflare.com/workers/ci-cd/builds/>
- Workers Builds configuration:
  <https://developers.cloudflare.com/workers/ci-cd/builds/configuration/>
- Workers Builds API:
  <https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/>
- Workers Builds build image:
  <https://developers.cloudflare.com/workers/ci-cd/builds/build-image/>
- Workers Builds caching:
  <https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/>
- Build branches:
  <https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/>
- Build watch paths:
  <https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/>
- Deploy hooks:
  <https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/>
