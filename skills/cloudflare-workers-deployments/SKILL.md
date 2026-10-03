---
name: cloudflare-workers-deployments
description: >
  Set up, deploy, and troubleshoot Cloudflare Workers projects using Wrangler,
  Workers Builds Git integrations, custom domains/routes, static assets, and
  Cloudflare Access. Use this skill whenever the user mentions Cloudflare
  Workers deployment, Workers Builds, GitHub-connected or GitLab-connected
  Workers, Wrangler static assets, Worker custom domains, build branches,
  preview builds, build watch paths, monorepo Workers Builds, build triggers,
  build logs, pnpm/npm/yarn/bun deploy commands in Workers Builds, creating a
  Worker project without deploying locally, or protecting a Worker hostname with
  Cloudflare Access.
---

# Cloudflare Workers Deployments

Use this skill for Cloudflare Workers deployment work, especially when the user
wants the Cloudflare-hosted Git build pipeline rather than a local `wrangler
deploy`.

## Operating Rules

- Check current Cloudflare docs or API schema before control-plane changes.
  Workers Builds and the `cf` CLI move quickly.
- Discover the CLI surface live; command snapshots here go stale. `cf agent-context`
  is gone (cf v0.15.0, 2026-10). Use `cf <command> --help`,
  `cf schema <command>` and `cf schema --list` (method, API path and command
  for every endpoint).
- Run every write command with `--dry-run` first. It prints the exact method,
  URL and JSON body without sending them, so it checks a `--body` payload.
  Exception: skip it for calls whose body carries a secret (for example
  `cf builds tokens create`); dry-run prints the body verbatim.
- Discover available tools before choosing a path: `cf`, `wrangler`, `jq`,
  package manager, and whether the Cloudflare dashboard is already configured.
- Read existing state first. Do not create duplicate Workers, repo connections,
  build triggers, custom domains, DNS records, or Access applications.
- Do not echo tokens, deploy hook URLs, raw build logs, or protected response
  bodies. Use redacted summaries unless the user explicitly asks for raw output.
- For Workers Builds REST calls, use an explicit user-scoped `CF_API_TOKEN` with
  the required Builds permissions. Do not read local Cloudflare CLI OAuth session
  JSON in reusable snippets.
- Distinguish deployment paths:
  - `wrangler deploy` publishes from the current machine.
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
- `references/routing-and-assets.md` - static-assets Worker config, custom
  domains versus routes, DNS prerequisites, and asset-routing gotchas.
- `references/access.md` - protect a hostname with Cloudflare Access and reusable
  policies.
- `references/troubleshooting.md` - known failures: pnpm workspace/lockfile
  mismatch, `pnpm deploy`, empty Worker projects, missing `previews` block,
  first-deploy 404s, DNS propagation, stale caches.

## Standard Workflow

1. Establish intent.
   - Ask only if needed: local deploy vs Workers Builds, production branch,
     hostname, preview branches, and whether Access should protect the hostname.
   - If the user says not to deploy locally, do not run `wrangler deploy`.

2. Inspect local repo.
   - Read `package.json`, lockfile, `wrangler.toml`/`wrangler.jsonc`, build
     output directory, project root, production branch, and existing deploy docs.
   - Derive package manager from lockfiles and `packageManager`; do not assume
     pnpm or `main`.
   - Verify scripts invoke package scripts explicitly. With pnpm, prefer
     `pnpm run deploy` in Workers Builds; `pnpm deploy` can invoke pnpm's built-in
     deploy command instead of the project script.
   - Prefer repo-pinned `wrangler` as a dev dependency so Cloudflare and local
     builds use the same Wrangler major/minor.

3. Inspect Cloudflare state.
   - `cf auth whoami` (also shows the account; `cf context show` is gone in
     cf v0.15.0)
   - `cf workers get <worker-name>` - Worker id (the Builds script tag),
     workers.dev URL and preview URL suffix. A missing Worker returns API error 10007.
   - `cf workers versions list --worker-id <worker-name>`
   - `cf workers deployments list --script-name <worker-name>`
   - `cf builds workers get <worker-tag>` and
     `cf builds triggers list --external-script-id <worker-tag>`
   - Custom domains: cf v0.15.0 has no domains command; see
     `references/routing-and-assets.md`.

4. Configure Workers Builds.
   - cf v0.15.0 cannot create a Worker. For a missing Worker, use the REST
     API or one bootstrap `wrangler deploy`. See `references/workers-builds.md`.
   - Pick the setup path by context: interactive with a browser -> hand the user
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
