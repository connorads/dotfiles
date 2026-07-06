# Troubleshooting Workers Builds

Use this reference for common failures seen while setting up Workers Builds.

## `packages field missing or empty`

Cloudflare's pnpm install can fail when `pnpm-workspace.yaml` exists without a
non-empty `packages` field.

Fix:

```yaml
packages:
  - .
```

Then run:

```bash
pnpm install --frozen-lockfile
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

## CLI Shape Mismatch

The `cf` CLI may expose an API command before its flags serialise the request
shape correctly. Symptoms include:

- `--body` being nested as a literal `"body"` field in dry-run output.
- Empty arrays becoming `[""]` or `["[]"]`.
- Manual build seed fields rejected as an invalid body.

Use `cf schema <command>` to confirm the endpoint and then call the official REST
endpoint directly with a small Node or curl script. Read the local OAuth token
without printing it.

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
