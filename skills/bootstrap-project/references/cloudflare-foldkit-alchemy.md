# Cloudflare Foldkit and Alchemy platform shell

Recipe ID: `cloudflare-foldkit-alchemy`

Last verified: 2026-09-04 against create-foldkit-app 0.32.0, Foldkit 0.155,
Effect 4.0.0-rc.112 and Alchemy 0.72.0-beta.76.

This recipe proves the platform seam only: a Foldkit frontend, minimal Effect
Worker, shared health protocol and one health round trip. Do not seed product
RPC, Durable Objects, WebSockets, storage or authentication.

## Scaffold and normalise

Scaffold the frontend in an isolated temporary directory because the current
CLI installs dependencies and initialises a nested workspace:

```sh
cd <temporary-parent>
pnpm dlx create-foldkit-app --name <name> --rendering spa \
  --example counter --package-manager pnpm
```

Copy the generated frontend into `frontend/`, then remove its nested Git data,
lockfile and workspace file before creating the root workspace. Inspect rather
than execute the generated `.mcp.json`: the observed template uses `npx -y`,
which violates the house package runner policy. Replace it with a supported
pnpm form or omit it.

The observed Foldkit instructions track the upstream main branch. Do not pin a
tag based on older recipe text. Select and record the exact dependency versions
resolved under the repository quarantine.

## Minimal repository contract

```text
frontend/       Foldkit application
protocol/       shared health request and response schema
backend/        Effect Worker implementing health only
alchemy.run.ts  one stack graph for frontend and backend
```

Use one root `package.json`, `pnpm-workspace.yaml` and lockfile. Alchemy logical
resource IDs are unique across the entire stack. The two-Worker layout belongs
to this Effect backend composition and is not a generic Foldkit requirement.
Do not add `wrangler.jsonc`; Alchemy owns the platform graph.

## External-resource boundary

Alchemy local development uses local implementations where a resource provides
one. Other resources may deploy real cloud infrastructure automatically.
Cloudflare state can also create account-wide state Worker and Secrets Store
resources on the first development, plan or deployment operation.

Therefore `alchemy dev` is not a local-only command. Obtain explicit authority
for development cloud resources separately from production deployment. Under a
local-only request, limit proof to install, typecheck, lint, tests, build and
static inspection of the Alchemy graph.

## House delta and proof

- Add exact `packageManager`, numeric tool selectors, lockfile, reviewed
  lifecycle decisions and hk wiring at the root.
- Test the protocol parser, Worker health response and frontend health client
  without adding application behaviour.
- Prove all workspace typechecks, tests and builds.
- After an authorised deployment, request the public health route. Resource
  creation output does not prove the Worker serves it.

Sources: [Foldkit](https://github.com/foldkit/foldkit),
[Alchemy Foldkit resource](https://alchemy.run/providers/cloudflare/website/foldkit/),
[Alchemy local development](https://alchemy.run/environments/local-development/),
[Alchemy state store](https://alchemy.run/state-store/),
[Alchemy resource model](https://alchemy.run/infrastructure-as-code/resource/).
