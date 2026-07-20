# Troubleshooting Workers Builds

Use this reference for common failures seen while setting up Workers Builds.

## Contents

- [`packages field missing or empty`](#packages-field-missing-or-empty)
- [`Invalid package manager specification`](#invalid-package-manager-specification)
- [`ERR_PNPM_IGNORED_BUILDS`](#err_pnpm_ignored_builds)
- [`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`](#err_pnpm_lockfile_config_mismatch)
- [`ERR_PNPM_NOTHING_TO_DEPLOY`](#err_pnpm_nothing_to_deploy)
- [workers.dev Shows Disabled](#workersdev-shows-disabled)
- [`Resource not found`](#resource-not-found)
- [Empty Worker Project](#empty-worker-project)
- [Build Cache Problems](#build-cache-problems)
- [CLI Shape Mismatch](#cli-shape-mismatch)
- [DNS Or Access Verification](#dns-or-access-verification)
- [Static Asset Routing Problems](#static-asset-routing-problems)

## `packages field missing or empty`

Root cause is a **pnpm-major mismatch**: pnpm 10 requires a `packages:` field in
any `pnpm-workspace.yaml`, while pnpm 11 treats that file as settings-only
(`packages:` optional). A repo whose workspace file holds only settings -
`allowBuilds`, `peerDependencyRules` (see
[`ERR_PNPM_IGNORED_BUILDS`](#err_pnpm_ignored_builds)) - builds locally on pnpm
11 but fails on Workers Builds when Cloudflare's default pnpm is v10.

Two fixes:

- **Pin the package manager** (preferred when the file is settings-only): set
  `"packageManager": "pnpm@<exact.version>"` in `package.json` so CF's corepack
  runs the same pnpm major the lockfile was built with. Also cures the corepack
  [`Invalid package manager specification`](#invalid-package-manager-specification)
  error, and avoids turning a single-package repo into a spurious workspace.
- **Declare a package** (only when you genuinely want a workspace): add a
  non-empty `packages` field.

  ```yaml
  packages:
    - .
  ```

Then run `pnpm install --frozen-lockfile`.

## `Invalid package manager specification`

Log line: `Invalid package manager specification in package.json (<pm>@^x.y.z);
expected a semver version`, followed by a failed install-tools step.

Meaning: Workers Builds provisions the package manager via corepack, and
corepack requires `packageManager` to be an exact semver version. Ranges fail;
pnpm itself sometimes writes a range or a `devEngines.packageManager` object.

Fix in `package.json`:

- Set `"packageManager": "<pm>@<exact.version>"` (for example `pnpm@11.11.0`).
- Remove `devEngines.packageManager` if it duplicates `packageManager` with a
  different or ranged version (pnpm warns and one of them is ignored).

## `ERR_PNPM_IGNORED_BUILDS`

Log line: `Ignored build scripts: <pkg>@<version>, ...` then
`Failed: error occurred while installing tools or dependencies`.

Meaning: pnpm >= 10 blocks dependency install scripts by default, and in
strict-dep-builds environments (Workers Builds included) undecided blocked
scripts fail the install instead of warning. Wrangler's own deps (`esbuild`,
`sharp`, `workerd`) trigger this.

Fix: record an explicit decision per package in `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: false
  sharp: false
  workerd: false
```

- `false` keeps the script blocked but marks it intentional — the error goes
  away. Prefer this: esbuild/sharp/workerd ship platform binaries as optional
  dependencies and work without their scripts.
- Only set `true` if the package genuinely needs its script, and treat that as
  a security decision for the user.
- pnpm 11 removed `ignoredBuiltDependencies`/`onlyBuiltDependencies` and the
  whole `package.json#pnpm` settings block; settings written there are silently
  ignored. Use `pnpm-workspace.yaml`.

Reproduce CI behaviour locally (global pnpm config often masks it):

```bash
HOME=/tmp/clean XDG_CONFIG_HOME=/tmp/clean pnpm install --frozen-lockfile
```

## `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`

Meaning: the pnpm config visible to Cloudflare does not match the lockfile's
recorded config, often due to overrides or different pnpm major versions.

Diagnose:

```bash
rg -n "overrides|settings|pnpm|packageManager" package.json pnpm-workspace.yaml pnpm-lock.yaml
corepack pnpm@<cloudflare-pnpm-version> install --frozen-lockfile
```

Options:

- Remove unnecessary overrides and regenerate the lockfile.
- Move required config to the place current pnpm reads it from, not a deprecated
  field.
- Set Workers Builds `PNPM_VERSION` to match the local lockfile producer.
- Purge build cache after changing package manager config.

Cloudflare's build image docs list the current default `pnpm` and the
`PNPM_VERSION` environment variable.

## `ERR_PNPM_NOTHING_TO_DEPLOY`

Cause: Workers Builds ran `pnpm deploy`, which invoked pnpm's built-in deploy
command instead of the package script.

Fix the Workers Builds deploy command:

```text
pnpm run deploy
```

Do the same in docs/README so future setup does not copy the bad command.

## `Resource not found`

For Workers Builds API calls, the common cause is using the Worker name where
Cloudflare expects the immutable Worker tag, documented as `external_script_id`.

Diagnose:

```bash
curl -sS \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/scripts" |
  jq -r '.result[] | {name: .id, tag: .tag}'
```

Then call Builds endpoints with `<worker-tag>`, not `<worker-name>`.

If the error appears during auth, confirm `CF_API_TOKEN` is user-scoped. The
Builds API rejects account-scoped tokens.

## Empty Worker Project

Dashboard message: "This Worker has no versions or deployments associated with
it."

Meaning: a Worker shell exists, but no build/deploy has produced a version yet.

Fix:

- Trigger a Workers Build from the production trigger, or push to the configured
  branch.
- Do not expect `wrangler versions upload` to create the first Worker. It fails
  if the Worker does not exist yet.

## Build Cache Problems

If package-manager changes do not seem to take effect:

```bash
cf workers-builds triggers purge-cache <trigger-uuid> --force
```

Temporarily set `build_caching_enabled` to `false` if debugging. Re-enable it
once a clean build succeeds.

Treat cache as disposable. Current Cloudflare docs cover package-manager caches
and selected framework output caches, but retention and limits are not a
correctness contract. Reproduce with a clean cache before blaming application
code.

## CLI Shape Mismatch

The `cf` CLI may expose an API command before its flags serialise the request
shape correctly. Symptoms include:

- `--body` being nested as a literal `"body"` field in dry-run output.
- Empty arrays becoming `[""]` or `["[]"]`.
- Manual build seed fields rejected as an invalid body.

Use `cf schema <command>` to confirm the endpoint and then call the official REST
endpoint directly with a small Node or curl script. Use `CF_API_TOKEN`; do not
read local Cloudflare CLI OAuth session JSON.

## DNS Or Access Verification

Cloudflare may create a proxied DNS record for a Worker custom domain. Local DNS
can briefly cache NXDOMAIN.

Verify authoritative/public DNS:

```bash
dig +short <hostname>
dig @1.1.1.1 +short <hostname> A
dig @1.1.1.1 +short <hostname> AAAA
```

Bypass local resolver cache:

```bash
curl --resolve <hostname>:443:<cloudflare-edge-ip> https://<hostname>/
```

If Access protects the hostname, success for unauthenticated verification is a
redirect/challenge, not the application HTML.

## workers.dev Shows Disabled

Dashboard shows `workers.dev: Disabled` next to the expected
`<worker>.<subdomain>.workers.dev` hostname.

Meaning: a Git-connected Worker created through the dashboard has no
workers.dev route until the first successful deploy flips it on. Often the
"problem" resolves itself once a build goes green — check the actual state
before mutating:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<worker>.<subdomain>.workers.dev/
# API: GET /accounts/<account-id>/workers/scripts/<worker>/subdomain
```

Pin the route in Wrangler config so later deploys cannot flip it back off:

```jsonc
{
  "workers_dev": true,
  "preview_urls": true
}
```

## Static Asset Routing Problems

Symptoms:

- SPA routes return 404 after deploy.
- Worker logic does not run for paths served by static assets.
- Files that should not be public are present in the assets upload.
- Assets resolve locally but not from a path-mounted Worker.

Check:

- `assets.directory` matches the actual build output.
- `.assetsignore` excludes private files and intermediate build output.
- `html_handling` and `not_found_handling` match SPA/SSG expectations.
- `run_worker_first` is set when Worker code must handle requests before assets.
- Custom domain versus route selection matches the origin model.
