# Routing And Static Assets Reference

Use this reference when a Workers deployment involves static assets, custom
domains, routes, DNS, or asset-routing behaviour.

## Contents

- [Static Assets](#static-assets)
- [Custom Domains Versus Routes](#custom-domains-versus-routes)
- [Read Checks](#read-checks)
- [Verification](#verification)
- [Docs](#docs)

## Static Assets

Start from the existing Wrangler config and framework output. A common
assets-only Worker uses:

```jsonc
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

Keep `"previews": {}` when Workers Builds deploys branch previews with
`wrangler preview`; see `troubleshooting.md`.

Do not assume every Worker is assets-only:

- Module/API Workers usually have a `main` entry and may also serve assets.
- Assets-only Workers can omit `main` when the app is purely static.
- Only one asset collection can be configured per Worker.
- Use `.assetsignore` when build output contains files that should not deploy.
- Check `html_handling`, `not_found_handling`, and `run_worker_first` for SPA,
  SSG, path-mounted, or Worker-first routing.
- By default, asset routing can happen before Worker code. If application logic
  must run first, configure that explicitly rather than relying on intuition.
- Build-time variables in Workers Builds are not runtime Worker variables or
  secrets. Configure runtime values through Wrangler/Cloudflare Worker settings.

## Custom Domains Versus Routes

Choose the routing primitive deliberately:

- Custom domains make the Worker the origin for a hostname. They are the usual
  choice for a static site or API fully served by the Worker.
- Routes run a Worker on matching requests for an existing proxied hostname and
  are useful when fronting an external origin.

Wrangler custom-domain config:

```jsonc
{
  "routes": [
    { "pattern": "<hostname>", "custom_domain": true }
  ]
}
```

Wrangler route config:

```jsonc
{
  "routes": [
    { "pattern": "<hostname>/*", "zone_name": "<zone-name>" }
  ]
}
```

Before creating or updating routing:

- Confirm the hostname belongs to the intended Cloudflare zone/account.
- Check for an existing custom domain, Worker route, DNS record, Page Rule,
  redirect rule, load balancer, Pages project, or Access app on the same
  hostname.
- For routes, confirm a proxied DNS record exists for the hostname.
- For custom domains, do not overwrite an existing DNS record or CNAME without
  explicit user approval. Cloudflare may create or manage DNS/certificate state.
- Be careful with partial/CNAME setups and apex hostnames; check current
  Cloudflare docs before mutating DNS.

## Read Checks

```bash
cf dns records list --zone <zone-name-or-id> --name <hostname>
```

cf v0.15.0 (2026-10) has no command for Worker custom domains or zone Worker
routes. `cf workers domains list` and `cf workers routes list` are gone, and
no replacement appears in `cf schema --list`. Until one does, read them through
the REST API with `CF_API_TOKEN` (check paths in the current API docs):

```bash
curl -sS -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/domains?hostname=<hostname>"
curl -sS -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/<zone-id>/workers/routes"
```

Re-check with `cf schema --list | jq -r '.[].command' | grep -i domain` on a
newer cf. Use `cf <command> --help` and `cf schema <command>` before any write.

## Verification

Prefer headers and status over raw bodies:

```bash
dig @1.1.1.1 +short <hostname> A
dig @1.1.1.1 +short <hostname> AAAA
curl -sS -I https://<hostname>/
```

If local DNS has stale negative cache but authoritative DNS resolves, verify the
edge path with a known Cloudflare edge IP:

```bash
curl --resolve <hostname>:443:<cloudflare-edge-ip> -sS -I https://<hostname>/
```

If Access protects the hostname, unauthenticated success is an Access redirect or
challenge, not application HTML.

## Docs

- Custom domains:
  <https://developers.cloudflare.com/workers/configuration/routing/custom-domains/>
- Routes:
  <https://developers.cloudflare.com/workers/configuration/routing/routes/>
- Static Assets:
  <https://developers.cloudflare.com/workers/static-assets/>
- Static Assets configuration:
  <https://developers.cloudflare.com/workers/static-assets/configuration/>
