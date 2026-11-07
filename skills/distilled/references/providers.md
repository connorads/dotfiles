# Distilled providers

Snapshot of `alchemy-run/distilled` `packages/` at `v1.0.0-rc.18`
(2026-11-06), grouped as on distilled.cloud. Each entry is the npm package
`@distilled.cloud/<name>`. Confirm a package with
`pnpm view @distilled.cloud/<name> version` before you rely on it.

| Category | Packages |
| --- | --- |
| Clouds | aws, azure, gcp, cloudflare, digitalocean, hetzner, ovh, hostinger, stackit |
| Platforms | vercel, railway, render, fly-io, modal, daytona, e2b, boat-dev, coolify, expo-eas, kubernetes, docker, argocd, celld, remote |
| Data | neon, supabase, planetscale, prisma, s2, s3, iceberg, turso, xata, mongodb-atlas, redis-cloud, elasticsearch, meilisearch, typesense, turbopuffer, surrealdb, spacetimedb, archil |
| Identity | auth0, clerk, workos, okta |
| Secrets and certificates | onepassword, doppler, infisical, unkey, acme, zerossl |
| Payments | stripe, adyen, paypal, plaid, coinbase, mercury, polar, whop, gusto |
| Observability | datadog, sentry, axiom, grafana, chronosphere, posthog, launchdarkly, growthbook, vanta |
| Messaging and support | slack, discord, resend, intercom, zendesk, customerio |
| Developer tools | github, forgejo, temporal, inngest, trigger-dev, huggingface, opencode |
| Business and analytics | google-workspace, notion, squarespace, porkbun, metabase, apache-superset |
| More | modrinth |

Notes:

- `e2b` and `s3` were in the repo but not yet on npm at this snapshot.
- `aws4signer` is a SigV4 signing helper, not a provider SDK.
- `core` is the shared runtime. Do not install it directly.
- `gcp` covers Google Cloud APIs. `google-workspace` covers Gmail, Drive,
  Calendar and other Workspace APIs.

Refresh this file from a clone of the repo: list `packages/`, drop private
packages and `core`, and group them with `GROUPS` in
`website/build/packages.ts`.
