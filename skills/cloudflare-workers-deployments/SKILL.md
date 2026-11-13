---
name: cloudflare-workers-deployments
description: >
  Set up, deploy, and troubleshoot Cloudflare Workers projects with the cf CLI
  (cloudflare.config.ts, cf deploy) or Wrangler, Workers Builds Git
  integrations, custom domains/routes, static assets, and Cloudflare Access.
  Use this skill whenever the user mentions Cloudflare Workers deployment, cf
  deploy, cf builds, cloudflare.config.ts, Workers Builds, GitHub-connected or
  GitLab-connected Workers, Wrangler deploys or static assets, Worker custom
  domains, build branches, preview builds, build watch paths, monorepo Workers
  Builds, build triggers, build logs, pnpm/npm/yarn/bun deploy commands in
  Workers Builds, creating a Worker project without deploying locally, or
  protecting a Worker hostname with Cloudflare Access.
---

# Cloudflare Workers Deployments

Use this skill for Cloudflare Workers deployment work, especially when the user
wants the Cloudflare-hosted Git build pipeline rather than a local deploy.

## Two Project Shapes

The project's config file decides the deploy tool. Check it before anything
else:

- `cloudflare.config.ts` -> a `cf` project. Deploy with `cf deploy` through
  the package script. Bindings, `domains`, `workersDev` and `previewUrls`
  live in that file.
- `wrangler.jsonc` / `wrangler.toml` / `wrangler.json` -> a Wrangler project.
  Deploy with `wrangler deploy`. Converting it is `cf migrate`, a separate
  change the user decides on.

Never run `cf dev`, `cf build` or `cf deploy` in a Wrangler project, and
never add a Wrangler config to a `cf` project. Wrangler stays the tool for
`wrangler tail` and for setting a single secret in either shape.

## Operating Rules

- Check current Cloudflare docs or API schema before control-plane changes.
  `cf` is in open beta and Workers Builds moves quickly.
- Discover the CLI surface live; command snapshots here go stale. Use
  `cf cli search "<task>"`, `cf <command> --help`, `cf schema <command>` and
  `cf schema --list` (method, API path and command for every endpoint). Keep
  search queries anonymous: no names, domains or IDs.
- Run every write command with `--dry-run` first. It prints the exact method,
  URL and JSON body without sending them, so it checks a `--body` payload.
  Exception: skip it for calls whose body carries a secret (for example
  `cf builds tokens create`); dry-run prints the body verbatim.
  `cf deploy --dry-run` is different: it builds and validates locally and
  needs no credentials.
- Read existing state first. Do not create duplicate Workers, repo connections,
  build triggers, custom domains, DNS records, or Access applications.
- Do not echo tokens, deploy hook URLs, raw build logs, or protected response
  bodies. Use redacted summaries unless the user explicitly asks for raw output.
- For Workers Builds REST calls, use an explicit user-scoped `CF_API_TOKEN` with
  the required Builds permissions. Do not read local Cloudflare CLI OAuth session
  JSON in reusable snippets. A version-specific fallback may use the CLI's
  authenticated API client without extracting credentials. See the Worker-create
  reference before using that fallback.
- Distinguish deployment paths:
  - `cf deploy` or `wrangler deploy` publishes from the current machine.
  - Workers Builds runs build/deploy commands inside Cloudflare from Git.
  - `wrangler versions upload` uploads a non-live version, but it does not create
    a brand-new Worker if the Worker does not exist yet.
- Distinguish Worker identifiers. The Builds API uses the immutable Worker tag,
  documented as `external_script_id`; the Worker name is not interchangeable.
- Before any POST/PATCH/PUT/DELETE or manual build trigger, show the account,
  Worker name/tag, repo, branch, root directory, commands, hostname, and policy
  summary, then get explicit user confirmation.
- Keep account IDs, Worker IDs, trigger UUIDs, policy IDs, emails, and hostnames
  out of reusable docs unless the user explicitly asks for a project-specific
  note.

## Reference Routing

Read only the reference needed for the task:

- `references/workers-builds.md` - create a Worker, connect GitHub, set up
  production and preview builds, trigger builds, inspect logs, verify
  deployments.
- `references/routing-and-assets.md` - static-assets config, custom domains
  versus routes, DNS prerequisites, and asset-routing gotchas.
- `references/access.md` - protect a hostname with Cloudflare Access and reusable
  policies.
- `references/troubleshooting.md` - known failures: pnpm workspace/lockfile
  mismatch, `pnpm deploy`, empty Worker projects, missing `previews` block,
  `cf` in CI, first-deploy 404s, DNS propagation, stale caches.

## Standard Workflow

1. Establish intent.
   - Honour the user's chosen CLI or dashboard path. An expired CLI login
     calls for reauthentication, not a switch to the dashboard.
   - Ask only if needed: local deploy vs Workers Builds, production branch,
     hostname, preview branches, and whether Access should protect the hostname.
   - If the user says not to deploy locally, run no local deploy.

2. Inspect local repo.
   - Read `package.json`, lockfile, the project config (`cloudflare.config.ts`
     or Wrangler config), build output, project root, production branch, and
     existing deploy docs.
   - Derive package manager from lockfiles and `packageManager`; do not assume
     pnpm or `main`.
   - Verify scripts invoke package scripts explicitly. With pnpm, prefer
     `pnpm run deploy` in Workers Builds; `pnpm deploy` can invoke pnpm's built-in
     deploy command instead of the project script.
   - Pin the deploy CLI (`cf` or `wrangler`) exactly as a dev dependency, so
     Cloudflare and local builds run the same version.

3. Inspect Cloudflare state.
   - `cf auth whoami` (also shows the account)
   - `cf workers get <worker-name>` - Worker id (the Builds script tag),
     workers.dev URL and preview URL suffix. A missing Worker returns API error 10007.
   - `cf workers versions list --worker-id <worker-name>`
   - `cf workers deployments list --script-name <worker-name>`
   - `cf builds workers get <worker-tag>` and
     `cf builds triggers list --external-script-id <worker-tag>`
   - Custom domains: `cf` has no domains command; see
     `references/routing-and-assets.md`.

4. Configure Workers Builds.
   - `cf` has no Worker-create command. For a missing Worker, use the REST API
     or one bootstrap deploy. See `references/workers-builds.md`.
   - When no path is specified, choose by context: interactive with a browser -> hand the user
     the dashboard deep link (it authorises GitHub and creates the build token);
     headless, scripted, or reproducible -> `cf builds workers create`. See
     `references/workers-builds.md` (Choose A Setup Path).
   - Use build/deploy commands that work in a non-interactive CI environment.

5. Verify in layers.
   - Local: frozen install, type/check, build, deploy dry-run.
   - Cloudflare: build status, build logs, Worker version, active deployment,
     custom domain, DNS, and HTTP response.
   - Access: unauthenticated request should redirect to Cloudflare Access; do not
     attempt to bypass or scrape protected content.

Reference files include Cloudflare docs entry points. Open the relevant current
docs before mutating Cloudflare state.
