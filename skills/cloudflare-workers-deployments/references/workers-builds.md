# Workers Builds Reference

Use this reference to create or repair a Cloudflare Workers Builds setup. Replace
all angle-bracket placeholders before running commands.

## Contents

- [Repo Preparation](#repo-preparation)
- [Tooling And Auth](#tooling-and-auth)
- [Read Checks](#read-checks)
- [Choose A Setup Path](#choose-a-setup-path)
- [Create A Worker Project Without Local Deployment](#create-a-worker-project-without-local-deployment)
- [Create A Build Token](#create-a-build-token)
- [Set Up Builds With Previews](#set-up-builds-with-previews)
- [Fallback: Repo Connection And Triggers](#fallback-repo-connection-and-triggers)
- [Update Triggers And Build Variables](#update-triggers-and-build-variables)
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
  },
  "workers_dev": true,
  "preview_urls": true,
  "previews": {}
}
```

`workers_dev` and `preview_urls` pin the workers.dev and preview URLs on, so a
later deploy cannot turn them off. `previews` can be empty, but it must exist
for `wrangler preview` (the preview deploy command, open beta, needs wrangler
>= ~4.135). Without it, branch builds fail; see `troubleshooting.md`.

Common package-script baseline:

```json
{
  "scripts": {
    "check": "<typecheck-command>",
    "build": "<build-command>",
    "deploy": "wrangler deploy",
    "deploy:preview": "wrangler preview",
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

Discover the `cf` surface live; it changes between minor versions. On cf
v0.15.0 (2026-10):

- `cf builds --help` lists the Workers Builds commands (tokens, repos,
  triggers, workers, list, create, get, logs, versions, deploy-hooks, limits).
  The older `cf workers-builds` group keeps only Previews subcommands.
- `cf schema <command>` shows one command's endpoint and body schema.
  `cf schema --list` maps every API path to its command.
- Every write command takes `--dry-run`. It prints the method, URL and JSON
  body and sends nothing. Use it to check each `--body` payload.

For the remaining REST calls (Worker create, domain and route reads, and a
direct Builds API call when `cf` fails; see `troubleshooting.md`):

- Use `CF_API_TOKEN`.
- The token must be user-scoped. Worker create needs Workers Scripts Write.
  A direct Builds API call needs Workers Builds Configuration Edit.
- Do not read or print the local Cloudflare CLI OAuth session token.
- Distinguish this API token from the build token UUID stored on a trigger.

## Read Checks

```bash
cf auth whoami                          # user and account(s)
cf workers list
cf workers get <worker-name>            # id, subdomain.url, subdomain.preview_url_suffix
cf workers versions list --worker-id <worker-name>
cf workers deployments list --script-name <worker-name>
cf builds tokens list
```

`cf workers get` and `cf workers versions list` accept the Worker id or name.
A missing Worker returns API error 10007. `cf context show`,
`cf workers subdomains get` and `cf workers domains list` do not exist in cf
v0.15.0. For custom domains see `routing-and-assets.md`.

Get GitHub numeric IDs when needed:

```bash
gh api users/<owner> --jq '.id'          # user account
gh api orgs/<owner> --jq '.id'           # organisation account
gh api repos/<owner>/<repo> --jq '.id'
```

The Worker tag, documented as `external_script_id` or `script_tag`, is the `id`
from `cf workers get`:

```bash
cf workers get <worker-name> | jq -r '.id'
```

Then use the tag, not the Worker name:

```bash
cf builds workers get <worker-tag>
cf builds triggers list --external-script-id <worker-tag>
cf builds list --external-script-id <worker-tag>
```

## Choose A Setup Path

The Worker must already exist for either path. The dashboard deep link 404s
until it does. See
[Create A Worker Project](#create-a-worker-project-without-local-deployment).
Pick by context; do not offer both as an equal menu.

Before picking, probe whether the browser step is needed at all: if the account
has ever used Workers Builds (`cf builds tokens list` is non-empty), the Git
app is likely already authorised. Confirm with a read-only call:

```bash
cf builds repos config-autofill get <provider-repo-id> \
  --provider-type github --provider-account-id <provider-owner-id> --branch <branch>
```

Success (it returns the repo's detected config) proves the app is installed
with access to that repo - take the CLI path with no browser step. Do not
probe via `gh api user/installations`: it 403s, because that endpoint needs a
GitHub-App-authorised token, which gh's OAuth token is not.

- Interactive, browser available -> dashboard. Least setup: the "Connect to
  Git" flow authorises the GitHub app and creates the build token in one
  click-through. Build the deep link and hand it to the user:

  ```text
  https://dash.cloudflare.com/<account-id>/workers/services/view/<worker-name>/production/settings
  ```

  `<account-id>` comes from `cf auth whoami`; `<worker-name>` from the repo's
  wrangler config `name`. Then: Build -> Connect. Offer to open it with the
  platform opener (`open` on macOS, `xdg-open` on Linux), falling back to
  printing the link; do not launch it unprompted. No display is itself the
  signal to take the CLI path instead.

- Headless, scripted, or reproducible -> cf CLI. No browser (SSH/CI), or the
  setup must be repeatable. Get a build token, then use
  [Set Up Builds With Previews](#set-up-builds-with-previews). Use the
  [fallback](#fallback-repo-connection-and-triggers) only if that call fails.

The dashboard reuses an existing user build token if one exists. It creates a
production trigger and a non-production trigger, and sets the preview deploy
command to `wrangler preview` (not `wrangler versions upload`). The CLI
Previews call creates the same pair.

### cf CLI write calls: use `--body`

For Builds write calls (`builds workers create`, `repos connections upsert`,
`triggers create`, `builds create`), pass a JSON body via `--body '<json>'`
rather than the individual `--flag` options. On cf v0.2.0 (2026-07) the flags
serialised to flat hyphenated keys the API rejected: a manual build via
`--seed-repo-*` flags returned HTTP 500, while `--body '{"branch":"main"}'`
succeeded. On cf v0.15.0 (2026-10) `builds workers create` flags still omit
`root_directory` and `environment_variables`, which `--body` accepts. The body
fields match the REST API, so the JSON bodies in this file work verbatim as
`--body` payloads. Check each one with `--dry-run` first.

## Create A Worker Project Without Local Deployment

cf v0.15.0 (2026-10) has no Worker-create command. `cf workers beta workers
create` is gone, and `cf schema --list` shows only GET on
`/accounts/{account_id}/workers/workers`. Two options:

- REST: `POST /accounts/<account-id>/workers/workers` with an API token that
  has Workers Scripts Write. Check the body fields in the current API docs.
  Enable observability, log persistence or 100% sampling only after the user
  confirms the privacy and cost trade-off.

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/workers" \
    --data '{"name":"<worker-name>"}' | jq '{success, id: .result.id}'
  ```

- Bootstrap: run `wrangler deploy` once from a logged-in wrangler. It creates
  the Worker and a first live version. Workers Builds owns every deploy after
  that. If the repo forbids local deploys, ask first and record this one
  exception in the repo docs.

Verify:

```bash
cf workers get <worker-name>
cf workers versions list --worker-id <worker-name>
cf workers deployments list --script-name <worker-name>
```

A REST-created Worker has no versions and no deployments. A bootstrapped Worker
has one of each.

## Create A Build Token

CLI path only. A build token is the credential CI uses to deploy on your behalf.
The dashboard creates one silently; the CLI path requires you to supply one.

cf's OAuth login cannot mint API tokens (cf v0.15.0, 2026-10).
`cf user tokens create|list` and `cf accounts tokens ...` return 403 [9109].
The OAuth scope catalogue has no token scope, so `cf auth login --scopes`
cannot fix it. `cf user tokens permission-groups list` still works. Pick one:

- Reuse: take a `build_token_uuid` from `cf builds tokens list`. The token is
  shared, so revoking it breaks every Worker that uses it.
- Dedicated, least privilege: the user mints a custom API token in the
  dashboard (My Profile > API Tokens > Create Token > Custom token). For a
  Worker with no bindings and no routes, `Workers Scripts Write` +
  `Account Settings Read` on the account is enough (verified deploying an
  assets-only Worker). Add one permission group per binding (KV, R2, D1,
  Queues) or `Workers Routes Write` (zone-scoped) for custom routes.

Register a dedicated token as a build token. Read the secret without echo
(`read -rs TOKEN_VALUE`), then:

```bash
cf builds tokens create --body "$(jq -n \
  --arg name "<worker-name> build token" \
  --arg id "<cloudflare-token-id>" \
  --arg secret "$TOKEN_VALUE" \
  '{build_token_name: $name, cloudflare_token_id: $id, build_token_secret: $secret}')"
```

Save `build_token_uuid` from the response. `--dry-run` on this call prints the
body, secret included, so skip it here.

## Set Up Builds With Previews

Primary CLI path (cf v0.15.0, 2026-10). One `cf builds workers create` call
creates the repo connection and two triggers: production on `<branch>`, and
"Deploy non-production branches" on `*`.

Before the write, show the user and get explicit confirmation:

- Cloudflare account and Worker name/tag.
- Git provider, owner, repository and production branch.
- Root directory and watch paths.
- Production and preview build and deploy commands.
- Build token UUID source.
- Build environment variables.

A successful production build with a deploy command publishes live traffic.

```bash
cf builds workers create --dry-run --body '{
  "script_tag": "<worker-tag>",
  "git_repository": {
    "provider_type": "github",
    "provider_account_id": "<provider-owner-id>",
    "provider_account_name": "<owner>",
    "repo_id": "<provider-repo-id>",
    "repo_name": "<repo>",
    "branch": "<production-branch>"
  },
  "production_settings": {
    "build_command": "<package-manager-install-and-build>",
    "deploy_command": "<package-manager-run-deploy>",
    "build_token_uuid": "<build-token-uuid>",
    "root_directory": "<root-directory>",
    "path_includes": ["*"],
    "path_excludes": [],
    "environment_variables": {
      "NODE_VERSION": { "value": "<node-version>", "is_secret": false }
    }
  },
  "previews_enabled": true,
  "previews_base_config": {
    "build_command": "<package-manager-install-and-build>",
    "deploy_command": "<package-manager-run-deploy-preview>",
    "build_token_uuid": "<build-token-uuid>",
    "root_directory": "<root-directory>",
    "path_includes": ["*"],
    "path_excludes": [],
    "environment_variables": {
      "NODE_VERSION": { "value": "<node-version>", "is_secret": false }
    }
  }
}'
```

Drop `--dry-run` to send it after confirmation. The preview deploy command
runs `wrangler preview` through the `deploy:preview` package script:
`<pm> run deploy:preview` (with pnpm, `pnpm run deploy:preview`). The wrangler
config needs a `previews` block. `deploy_command` must run in
non-interactive CI. With pnpm use `pnpm run deploy`, never `pnpm deploy`.

Then read back:

```bash
cf builds workers get <worker-tag>
cf builds triggers list --external-script-id <worker-tag>
```

`previews_enabled` is unreliable (2026-10). It read back `false` after create,
and again after `cf builds workers update <worker-tag> --body
'{"previews_enabled":true}'`. Non-production branch builds still ran and
produced preview URLs. Do not trust the flag; push a test branch and check
that a build runs.

`cf builds workers update <worker-tag>` patches the repo branch, production
settings or `previews_base_config`. `--patch-existing-previews true` applies a
`previews_base_config` patch to existing Previews as well. The flag takes a
`true`/`false` value; bare, it fails with `Invalid values`:

```bash
cf builds workers update <worker-tag> --patch-existing-previews true \
  --body '{"previews_base_config":{...}}'
```

`cf builds workers delete <worker-tag>` removes the build configuration.

## Fallback: Repo Connection And Triggers

Use this path when `cf builds workers create` fails, or to add a single
trigger to an existing setup.

Upsert the repository connection. Cloudflare's GitHub or GitLab app must
already be authorised for the owner/repo:

```bash
cf builds repos connections upsert --body '{
  "provider_type": "github",
  "provider_account_id": "<provider-owner-id>",
  "provider_account_name": "<owner>",
  "repo_id": "<provider-repo-id>",
  "repo_name": "<repo>"
}'
```

Save `repo_connection_uuid` from the response. `upsert` is idempotent -
re-running returns the existing connection.

Create a production trigger (show the same confirmation summary first):

```bash
cf builds triggers create --body '{
  "external_script_id": "<worker-tag>",
  "repo_connection_uuid": "<repo-connection-uuid>",
  "build_token_uuid": "<build-token-uuid>",
  "trigger_name": "Deploy production",
  "build_command": "<package-manager-install-and-build>",
  "deploy_command": "<package-manager-run-deploy>",
  "root_directory": "<root-directory>",
  "branch_includes": ["<production-branch>"],
  "branch_excludes": [],
  "path_includes": ["*"],
  "path_excludes": [],
  "build_caching_enabled": true
}'
```

For previews, create a second trigger with `"branch_includes": ["*"]`,
`"branch_excludes": ["<production-branch>"]` and a deploy command that runs
`wrangler preview`. On wrangler older than ~4.135, use
`wrangler versions upload` instead. Confirm the current trigger limit in the
docs before writing.

## Update Triggers And Build Variables

Patch only the changed field:

```bash
cf builds triggers update <trigger-uuid> --body '{"deploy_command":"<package-manager-run-deploy>"}'
cf builds triggers update <trigger-uuid> --body '{"build_caching_enabled":true}'
```

Build variables are per trigger. `list` takes the trigger as a flag; `upsert`
takes it as a positional:

```bash
cf builds triggers environment-variables list --trigger-uuid <trigger-uuid>
cf builds triggers environment-variables upsert <trigger-uuid> \
  --body '{"NODE_VERSION":{"value":"<node-version>","is_secret":false}}'
```

`upsert` leaves unspecified keys alone. `list` does not return secret values.

Deploy hooks (`cf builds deploy-hooks`) are another trigger mechanism. Treat
the hook URL itself as a secret credential: do not print it, commit it, or
paste it into logs.

## Trigger And Monitor Builds

Manual build:

```bash
cf builds create <trigger-uuid> --body '{"branch":"<production-branch>"}'
```

The body also accepts `commit_hash`. Do not use the `--seed-repo-*` flags; see
the `--body` note.

Monitor status:

```bash
cf builds list --external-script-id <worker-tag>
cf builds get <build-uuid>
```

Read the verdict from `build_outcome` (`success` / `failed`), not `status`:
a finished successful build reports `status: "stopped"`, which reads as a
failure if you poll on status alone.

Fetch logs only when needed. The output is JSON; each entry in `.lines` is a
pair whose second item is the text:

```bash
cf builds logs get <build-uuid> | jq -r '.lines[][1]'
```

Long logs paginate with `--cursor`. Redact tokens and URLs, and summarise the
failing commands. Do not paste raw logs into chat by default.

A branch build log prints its preview URLs:
`https://<branch>-<worker-name>.<subdomain>.workers.dev` and
`https://<version-prefix>-<worker-name>.<subdomain>.workers.dev`.

## Build Image, Installs, And Cache

Read the current build-image docs before relying on default runtime versions.
Prefer repo-pinned tools or Cloudflare-supported version variables/files.
Builds detect tool versions from the repo: Node.js and pnpm from `mise.toml`
and `packageManager` were picked up (2026-10). Setting `NODE_VERSION` as well
is harmless.

Useful knobs:

- `NODE_VERSION`, `PNPM_VERSION`, `YARN_VERSION`, and `BUN_VERSION` when the
  docs support them for the current image.
- `SKIP_DEPENDENCY_INSTALL` when the build command must control installs itself.
- Package-manager caches and some framework output caches are restored between
  builds, but cache retention and limits are not a correctness guarantee.

After package-manager or lockfile changes:

```bash
cf builds triggers cache purge <trigger-uuid> --force
```

Temporarily disabling build cache is useful for diagnosis. Re-enable it after a
clean build unless the user wants cache disabled.

## Verify Deployment

Use layered checks and avoid dumping protected content. `cf workers get
<worker-name>` returns `subdomain.url`, the workers.dev URL.

```bash
cf workers deployments list --script-name <worker-name>
cf workers versions list --worker-id <worker-name>
dig @1.1.1.1 +short <hostname> A
dig @1.1.1.1 +short <hostname> AAAA
curl -sS -o /dev/null -w '%{http_code}\n' https://<hostname>/
```

A first workers.dev deploy can return 404 for 30-60 s before 200 while it
propagates. Retry the smoke check for a minute before calling it failed.

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
