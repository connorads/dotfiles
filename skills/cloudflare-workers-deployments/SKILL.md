---
name: cloudflare-workers-deployments
description: >
  Set up, deploy, and troubleshoot Cloudflare Workers projects using Wrangler,
  Workers Builds Git integrations, custom domains, and Cloudflare Access. Use
  this skill whenever the user mentions Cloudflare Workers deployment, Workers
  Builds, GitHub-connected Workers, Wrangler static assets, Worker custom
  domains, build triggers, build logs, pnpm/npm/yarn deploy commands in Workers
  Builds, creating a Worker project without deploying locally, or protecting a
  Worker hostname with Cloudflare Access.
---

# Cloudflare Workers Deployments

Use this skill for Cloudflare Workers deployment work, especially when the user
wants the Cloudflare-hosted Git build pipeline rather than a local `wrangler
deploy`.

## Operating Rules

- Check current Cloudflare docs or API schema before control-plane changes.
  Workers Builds and the `cf` CLI move quickly.
- Read existing state first. Do not create duplicate Workers, repo connections,
  build triggers, custom domains, DNS records, or Access applications.
- Do not echo tokens. If direct API calls are needed, read local CLI auth
  in-process and print only redacted request/response summaries.
- Distinguish deployment paths:
  - `wrangler deploy` publishes from the current machine.
  - Workers Builds runs build/deploy commands inside Cloudflare from Git.
  - `wrangler versions upload` uploads a non-live version, but it does not create
    a brand-new Worker if the Worker does not exist yet.
- Keep account IDs, Worker IDs, trigger UUIDs, policy IDs, emails, and hostnames
  out of reusable docs unless the user explicitly asks for a project-specific
  note.

## Reference Routing

Read only the reference needed for the task:

- `references/workers-builds.md` - create a Worker project, connect GitHub,
  create/update triggers, trigger builds, inspect logs, verify deployments.
- `references/access.md` - protect a hostname with Cloudflare Access and reusable
  policies.
- `references/troubleshooting.md` - known failures: pnpm workspace/lockfile
  mismatch, `pnpm deploy`, empty Worker projects, DNS propagation, stale caches.

## Standard Workflow

1. Establish intent.
   - Ask only if needed: local deploy vs Workers Builds, production branch,
     hostname, preview branches, and whether Access should protect the hostname.
   - If the user says not to deploy locally, do not run `wrangler deploy`.

2. Inspect local repo.
   - Read `package.json`, lockfile, `wrangler.toml`/`wrangler.jsonc`, build
     output directory, and existing deploy docs.
   - Verify scripts invoke package scripts explicitly. With pnpm, prefer
     `pnpm run deploy` in Workers Builds; `pnpm deploy` can invoke pnpm's built-in
     deploy command instead of the project script.
   - Prefer repo-pinned `wrangler` as a dev dependency so Cloudflare and local
     builds use the same Wrangler major/minor.

3. Inspect Cloudflare state.
   - `cf auth whoami`
   - `cf context show`
   - `cf workers scripts search --name <worker-name>`
   - `cf workers beta workers versions list --worker-id <worker-id>` when the
     Worker is a beta Worker shell.
   - `cf workers-builds triggers list --external-script-id <worker-id-or-tag>`
   - `cf workers deployments list --script-name <worker-name>`
   - `cf workers domains list --hostname <hostname>`

4. Configure Workers Builds.
   - For a missing Worker project, prefer creating a Worker shell without a live
     version, then attaching a Git build trigger. See `references/workers-builds.md`.
   - Connect the Git repository, select/create a build token, and create a
     production trigger.
   - Use build/deploy commands that work in a non-interactive CI environment.

5. Verify in layers.
   - Local: frozen install, type/check, build, deploy dry-run.
   - Cloudflare: build status, build logs, Worker version, active deployment,
     custom domain, DNS, and HTTP response.
   - Access: unauthenticated request should redirect to Cloudflare Access; do not
     attempt to bypass or scrape protected content.

## Useful Docs

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
- Access self-hosted applications:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/>
- Access policies:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/policies/>
