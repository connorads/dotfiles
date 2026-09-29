---
name: cloudflare-mcp
description: >-
  Builds, migrates, secures and tests remote MCP servers hosted on Cloudflare
  Workers, using the Agents SDK stateless handler (createMcpHandler from
  agents/mcp/server) with MCP TypeScript SDK v2 so one /mcp endpoint serves
  both 2025-era and 2026-07-28 clients. Use when the user wants to create,
  deploy, debug or harden an MCP server on Cloudflare Workers, a remote MCP
  server, a /mcp endpoint on a Worker, or a connector for Claude or ChatGPT
  hosted on Cloudflare; or mentions McpAgent, serveSSE, createMcpHandler,
  createLegacyMcpHandler, workers-oauth-provider or OAuthProvider for MCP; or
  wants to migrate an old McpAgent, SSE or SDK v1 server. Not for consuming or
  configuring Cloudflare's own MCP servers, not for Agents SDK features
  unrelated to MCP (Agent class, state, scheduling, MCP clients), and not for
  MCP servers hosted outside Cloudflare.
---

# Cloudflare MCP servers

Your memory of this stack comes from the `McpAgent` + SSE + `@modelcontextprotocol/sdk` v1 era.
Cloudflare deprecated that path in agents 0.20.0 (`McpAgent` is feature-frozen).
The MCP 2026-07-28 revision removed the `initialize` handshake and protocol sessions.
As of 2026-09-28, tutorials, older skills and Cloudflare's own OAuth template show the old shapes.

Anchor every decision on one question:

> **Which protocol era does each client speak, and which handler serves it?**

- **Legacy era**: `2025-11-25` and earlier, starts with `initialize`.
- **Modern era**: `2026-07-28`, no handshake, per-request `_meta`.
- The stateless `createMcpHandler(factory)` serves both on one route by default (verified live; matrix in `references/spec.md` section 4).
- An SDK v1 server serves only the legacy era. A modern client gets `400 Unsupported protocol version: 2026-07-28`.
- Only reach for a sessionful legacy handler when a 2025-era client needs server-to-client requests (push elicitation, sampling, roots).

## 1. Check versions first

`agents` exact-pins its MCP SDK peers, and npm `latest` of the SDK runs ahead of the pin.
Read the pins before installing anything:

```sh
pnpm view agents@latest version
pnpm view agents@latest peerDependencies --json
```

Verified 2026-09-28: agents 0.24.0 pins `@modelcontextprotocol/server` `2.0.0`, `@modelcontextprotocol/client` `2.0.0`, `@modelcontextprotocol/sdk` `1.30.0`, `zod` `^4.0.0`.
npm `latest` of `@modelcontextprotocol/server` was 2.1.0 on that date.

If `agents@latest` is inside the install quarantine, use the newest `agents` outside it and that version's peers. Do not bypass the quarantine.

When scaffolding from `assets/stateless-server/`, only confirm its `package.json` pins match the live peer pins. Edit them only if they differ.

Otherwise install exactly the pinned versions:

1. Write the exact pin (no `^`) for `agents` and each `@modelcontextprotocol/*` package into `package.json`, for example `"@modelcontextprotocol/server": "2.0.0"`.
2. Write `zod` as a range: `"zod": "^4.2.0"`. It satisfies the agents peer, and 4.0-4.1 drop `.describe()` text from tool schemas (only a one-time `[mcp-sdk]` console warning shows it). Zod 3 is unsupported.
3. Run `pnpm install`.
4. Run `pnpm peers check` (pnpm 11+). It must report no unmet `@modelcontextprotocol/*` peer.

`pnpm add` resolves the SDK past the pin, and `--save-exact` does not rewrite an existing `^` range. Edit `package.json`.

## 2. The default: stateless handler

```ts
// src/index.ts
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer() {
  const server = new McpServer({ name: "my-mcp", version: "1.0.0" });
  server.registerTool(
    "hello",
    {
      description: "Returns a greeting",
      inputSchema: z.object({ name: z.string().optional().describe("Who to greet") }),
    },
    async ({ name }) => ({ content: [{ type: "text", text: `Hello, ${name ?? "World"}!` }] }),
  );
  return server;
}

const handler = createMcpHandler(createServer);

export default {
  fetch: (request, env, ctx) => handler(request, env, ctx),
} satisfies ExportedHandler<Env>;
```

```jsonc
// wrangler.jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-mcp",
  "main": "src/index.ts",
  "compatibility_date": "YYYY-MM-DD", // the day you create the project, never a template's date
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true }
}
```

- `nodejs_compat` is required: `agents/mcp/server` imports `node:async_hooks`.
- No Durable Object binding and no `migrations` block. The stateless handler needs neither.
- Generate `Env` with `pnpm exec wrangler types`. Do not hand-write `env.d.ts` or add `@cloudflare/workers-types` 4.
- Canonical upstream: [examples/mcp-worker](https://github.com/cloudflare/agents/tree/main/examples/mcp-worker) and the [handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/index.md).
  As of 2026-09-28 both pass a raw shape to `inputSchema`. The SDK v2 d.ts marks that overload `@deprecated Wrap with z.object({...})`.

## 3. Standing rules

- **Import `createMcpHandler` from `agents/mcp/server`, not `agents/mcp`.** `agents/mcp` is the legacy barrel with an overloaded `createMcpHandler`, and it pulls `McpAgent` and SDK v1 into the bundle (per the 0.20.0 changelog).
- **Import `McpServer` from `@modelcontextprotocol/server`.** `@modelcontextprotocol/sdk/server/mcp.js` is SDK v1, which serves only the legacy era.
- **Pass the factory, never a server instance.** `createMcpHandler(createServer)` builds a fresh server per request. From `agents/mcp`, a v1 instance logs a deprecation warning and returns 400 to modern clients. From `agents/mcp/server`, any instance fails typecheck and every request returns 500 (observed).
- **Export an object with `fetch`, never the handler itself.** The agents handler is a callable function, and Wrangler treats a function default export as a `WorkerEntrypoint` class. Use the agents `createMcpHandler`, not the one from `@modelcontextprotocol/server`. The SDK one does no Origin/Host validation.
- **Create the handler once at module scope.** `handler.notify.*` reaches `subscriptions/listen` streams only from the module-scope handler. Notifications are isolate-local, and the agents wrapper throws `TypeError` on a custom `bus` (observed).
- **Read bindings with `import { env } from "cloudflare:workers"`.** The factory gets no `env`, and a handler built inside `fetch` to capture it breaks notifications (rule above).
- **Use `registerTool(name, { description, inputSchema: z.object({...}) }, cb)`.** SDK v2 has no `server.tool()`, `server.resource()` or `server.prompt()`.
- **Read the SDK v2 callback `context`, not v1 `extra`.** `extra.authInfo` and `extra.requestId` do not exist in v2.
- **Keep the default `legacy: "stateless"` on a public server.** `legacy: "reject"` locks out every 2025-era client. Which era Claude and ChatGPT speak is unverified.
- **Set `allowedHostnames: ["mcp.example.com"]` on a custom domain.** Host checks run by default only on localhost and `*.workers.dev`.
- **Elicit with `inputRequired(...)`, not `elicitInput`.** `context.mcpReq.elicitInput` throws on a modern request. `inputRequired` reaches only modern clients. A 2025-era client gets an `isError` result, so give the tool a non-elicitation fallback or serve a sessionful legacy lane (`references/handler.md` section 6).
- **Scaffold from `assets/stateless-server/`, not a template.** `cloudflare/ai` `demos/remote-mcp-github-oauth` is `McpAgent` + provider 0.x (as of 2026-09-28). There is no `agents` CLI (gone since 0.22.0), so do not run `npm create` or `agents create`.
- **Never suppress a type error with `@ts-expect-error` to make a handler fit.** Wrap it in `{ fetch: (r, e, c) => app.fetch(r, e, c) }` instead. Hono's `c.executionCtx` needs an `as ExecutionContext` cast (`references/handler.md` section 9).

## 4. Stale patterns

Distrust `McpAgent`, `serveSSE`, `server.tool(` and `developers.cloudflare.com/agents/mcp/` URLs (that path returns 404) in older skills, blog posts and your own training data.

| Stale | Current |
| --- | --- |
| `class MyMCP extends McpAgent` + DO binding + `migrations` | `createMcpHandler(createServer)` from `agents/mcp/server`, no DO. When migrating, keep applied `migrations` entries and append `deleted_classes` (`references/migrate.md`) |
| `MyMCP.serveSSE("/sse")` | one `/mcp` route serving both eras, no `/sse` route (HTTP+SSE is deprecated in 2026-07-28) |
| `@modelcontextprotocol/sdk` + `server.tool(name, desc, shape, cb)` | `@modelcontextprotocol/server` + `registerTool(name, { inputSchema: z.object(...) }, cb)` |
| `OAuthProvider({ apiHandlers: { "/mcp": MyMCP.serve("/mcp") } })`, no `resourceMetadata` | provider 1.x with `resourceMetadata: { resource }`, `apiRoute: "/mcp"` and `apiHandler: { fetch: (r, e, c) => mcp(r, e, c) }` (1.1.0 throws without `apiRoute`) |

Full table and step-by-step migrations: `references/migrate.md`.

## 5. Auth in brief

- Use `@cloudflare/workers-oauth-provider` 1.x. Its constructor throws unless `resourceMetadata.resource` is an absolute https URL (`http` only on loopback) that covers `apiRoute`. It cannot tell whether the value is your real public URL, so set it to the exact public MCP URL yourself. Claude requires PRM `resource` to match the URL the user enters.
- Read identity in tools from `getMcpAuthContext()?.props` (from `agents/mcp/server`). `context.http?.authInfo` is `undefined` behind every released provider, whatever Cloudflare's docs and `mcp-worker-authenticated` show (runtime probe with a simulated provider `ctx`).
- Enforce scopes in an `apiHandler` wrapper that returns `insufficientScope(ctx.auth, [...])` before calling the MCP handler.
- Prefer CIMD (`clientIdMetadataDocumentEnabled: true` + compat flag `global_fetch_strictly_public`) over DCR. Use the provider's consent and upstream helpers, not hand-rolled `state` or cookies.

Everything else, including the security checklist and Claude/ChatGPT connector requirements: `references/auth.md`.

## 6. Verify

1. Run `pnpm test`.
2. Before calling any server done, run the both-eras client probe against `wrangler dev` and again against the deployed URL. In a template project run `pnpm probe <url-ending-in-/mcp>`. Elsewhere, copy `assets/stateless-server/scripts/probe.mjs` and add `@modelcontextprotocol/client` at the exact `agents` peer pin.
   It must call a tool successfully in legacy mode, `auto` mode and pinned `2026-07-28` mode. Adapt its tool call to your server; details in `references/testing-deploy.md`.
3. Report which of those checks ran and which were skipped.

A `curl` of `tools/list` proves only the legacy lane.
Inspector: see `references/testing-deploy.md`. Do not disable pnpm's trust policy.

## 7. Routing

| When the task involves | Read |
| --- | --- |
| Handler options, CORS, Origin/Host policy, `responseMode`, notifications, elicitation (MRTR), serving a sessionful legacy lane, app state in a Durable Object, KV or D1, Code Mode (`search` + `execute`) | `references/handler.md` |
| OAuth provider config, identity, scopes, consent/CSRF, CIMD vs DCR, Claude or ChatGPT connector requirements | `references/auth.md` |
| Existing `McpAgent`, SSE, SDK v1, `createLegacyMcpHandler` or provider 0.x code; any stale pattern not in section 4 | `references/migrate.md` |
| Probes, vitest plugin, test harness, Inspector, deploy, custom domains, observability, rate limits | `references/testing-deploy.md` |
| Protocol revisions, which era a client speaks, the compatibility matrix, the MCP auth model | `references/spec.md` |
| Starting a new project | `assets/stateless-server/`: `src/index.ts`, `src/server.ts`, `wrangler.jsonc`, `tsconfig.json`, `test/mcp.test.mjs` and the probe (section 6); `README.md` has the steps |
| Re-verifying this skill against upstream | `references/refresh.md` (drives `scripts/delta.py`, `sources.json` and `tests/`) |

Re-verify any Cloudflare page by appending `index.md` to its URL for markdown. The MCP page index is `https://developers.cloudflare.com/agents/llms.txt`.

## Keeping this skill current

Version literals and upstream claims here are snapshots from 2026-09-28.
To refresh, follow `references/refresh.md`: run `scripts/delta.py` to list upstream changes since the watermarks in `sources.json`, review them, then bump the watermarks from the reviewed report.
`evals/` (`evals.json` plus `fixtures/`) holds the cases for writing-skills' `run_evals.py`.
