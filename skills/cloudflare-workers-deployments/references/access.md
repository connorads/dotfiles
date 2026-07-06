# Cloudflare Access Reference

Use this reference when a Worker hostname should be protected by Cloudflare
Access. Do read checks first and avoid creating duplicate applications or broad
bypass policies.

## Read Checks

```bash
cf zero-trust access applications list --domain <hostname> --exact
cf zero-trust access policies get <reusable-policy-id>
```

Confirm:

- No existing application already protects the exact hostname, unless the task is
  to update it.
- The reusable policy has the intended name, `decision: allow`, and the intended
  include rules.
- There is no accidental `Everyone`, `My IPs`, or bypass policy unless the user
  explicitly asked for it.

## Create A Self-Hosted Application

Use a self-hosted Access app for a public Worker hostname:

```bash
cf zero-trust access applications create --body '{
  "type": "self_hosted",
  "name": "<app-name>",
  "domain": "<hostname>",
  "self_hosted_domains": ["<hostname>"],
  "destinations": [
    { "type": "public", "uri": "<hostname>" }
  ],
  "session_duration": "24h",
  "app_launcher_visible": true,
  "allowed_idps": [],
  "auto_redirect_to_identity": false,
  "policies": [
    { "id": "<reusable-policy-id>", "precedence": 1 }
  ]
}'
```

If matching an existing app's defaults matters, read that app and set boolean
defaults explicitly on update, for example:

```json
{
  "enable_binding_cookie": false,
  "http_only_cookie_attribute": false,
  "options_preflight_bypass": false,
  "eager_redirect_cookie_setting": false
}
```

## Verify

```bash
cf zero-trust access applications list --domain <hostname> --exact
curl -sS -D - -o /tmp/access-body https://<hostname>/ | sed -n '1,80p'
```

Expected unauthenticated response:

- `302` redirect to a `cloudflareaccess.com` login URL, or another Access
  challenge response configured for the tenant.
- `www-authenticate: Cloudflare-Access ...` may be present.

Do not try to automate login with a human user's credentials. Ask the user to
confirm authenticated access in a browser if needed.
