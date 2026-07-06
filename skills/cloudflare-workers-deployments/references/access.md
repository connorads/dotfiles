# Cloudflare Access Reference

Use this reference when a Worker hostname should be protected by Cloudflare
Access. Do read checks first and avoid creating duplicate applications or broad
bypass policies.

## Contents

- [Read Checks](#read-checks)
- [Policy Review](#policy-review)
- [Create A Self-Hosted Application](#create-a-self-hosted-application)
- [Verify](#verify)
- [Docs](#docs)

## Read Checks

```bash
cf zero-trust access applications list --domain <hostname> --exact
cf zero-trust access policies get <reusable-policy-id>
```

Confirm:

- No existing application already protects the exact hostname, unless the task is
  to update it.
- The reusable policy has the intended name, `decision: allow`, and the intended
  include/exclude/require rules.
- There is no accidental `Everyone`, broad login-method allow, `My IPs`, Service
  Auth, or Bypass policy unless the user explicitly asked for it.
- Editing a reusable policy is acceptable. Reusable policies can be attached to
  multiple apps, so policy edits affect every attached app.

Summarise policy rules with emails and groups redacted unless the user asks to
see exact identities.

## Policy Review

Access is deny-by-default only when no allow/bypass/service-auth policy matches.
Review precedence and policy decisions carefully:

- Bypass and Service Auth policies can permit access before normal Allow/Block
  policy expectations.
- Bypass skips normal Access logging and enforcement for matching traffic.
- `Everyone` or broad IdP/login-method rules can expose the app to more users
  than intended.
- Legacy app-scoped policies may not behave like reusable policies for new apps.

Before attaching a reusable policy, show the user the application hostname,
policy name, decision, precedence, and redacted include/exclude/require summary.
Get explicit confirmation for new app creation or policy attachment.

## Create A Self-Hosted Application

Use a self-hosted Access app for a public Worker hostname. Prefer `destinations`;
`self_hosted_domains` is deprecated.

Default to keeping the app out of the launcher and not forcing a specific IdP
unless the user asks or an existing app's defaults are being mirrored.

```bash
cf zero-trust access applications create --body '{
  "type": "self_hosted",
  "name": "<app-name>",
  "domain": "<hostname>",
  "destinations": [
    { "type": "public", "uri": "<hostname>" }
  ],
  "session_duration": "24h",
  "app_launcher_visible": false,
  "allowed_idps": [],
  "auto_redirect_to_identity": false,
  "policies": [
    { "id": "<reusable-policy-id>", "precedence": 1 }
  ]
}'
```

If matching an existing app's defaults matters, read that app and set boolean
defaults explicitly on create/update, for example:

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
curl -sS -I https://<hostname>/
```

Expected unauthenticated response:

- `302` redirect to a `cloudflareaccess.com` login URL, or another Access
  challenge response configured for the tenant.
- `www-authenticate: Cloudflare-Access ...` may be present.

Do not try to automate login with a human user's credentials. Ask the user to
confirm authenticated access in a browser if needed.

## Docs

- Access self-hosted applications:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/>
- Access policies:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/policies/>
- Access policy management:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/policies/policy-management/>
- API deprecations:
  <https://developers.cloudflare.com/fundamentals/api/reference/deprecations/>
