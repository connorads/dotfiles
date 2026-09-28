# Migrating an existing MCP server on Cloudflare

Read this before touching code that uses `McpAgent`, `serveSSE`, `@modelcontextprotocol/sdk`, `server.tool(`, `experimental_createMcpHandler`, `createLegacyMcpHandler` or `@cloudflare/workers-oauth-provider` 0.x.
Snapshot verified 2026-09-28 against `agents` 0.24.0, `@modelcontextprotocol/server` 2.0.0, `@modelcontextprotocol/sdk` 1.30.0, provider 1.1.0 (d.ts and dist) and wrangler 4.137.0.
Snippets here were typechecked against those versions. The dual-lane router, the `/sse` alias and the v1-instance failure were also run under `wrangler dev`.

## Contents

1. Classify the server
2. Pin dependencies
3. Move registrations to an SDK v2 factory
4. Replace the entry point
5. Keep a legacy lane only when needed
6. Retire the `McpAgent` Durable Object
7. `workers-oauth-provider` 0.x to 1.x
8. Stale pattern to current replacement
9. Not verified at runtime
10. Sources

## 1. Classify the server

Find what the server uses:

```sh
grep -rnE 'McpAgent|serveSSE|\.mount\(|\.tool\(|\.resource\(|\.prompt\(|elicitInput|createMessage|listRoots|sessionId|getEventStore|addMcpServer|experimental_createMcpHandler|createLegacyMcpHandler|createMcpHandler\(|codeMcpServer|openApiMcpServer|withX402|paidTool' src
grep -nE '"(agents|@modelcontextprotocol/[a-z]+|@cloudflare/workers-oauth-provider|zod)"' package.json
```

These sessionful features force a temporary legacy lane (section 5):

- pushed elicitation, sampling or roots (`elicitInput`, `createMessage`, `listRoots`) that 2025-era clients must still receive;
- data keyed by the MCP session id, `this.state`/`setState` read across calls in one session;
- `Last-Event-ID` replay, standalone GET streams, `DELETE` session teardown;
- Agent-to-`McpAgent` RPC (`addMcpServer(name, env.Binding)`);
- helpers that still return SDK v1 servers: `codeMcpServer`, `openApiMcpServer`, server-side `withX402`/`paidTool` (as of agents 0.24.0).

| Current server | Path |
| --- | --- |
| `McpAgent` or SDK v1, none of the features above | Sections 2, 3, 4 (keep `MyMCP` exported and bound), then section 6 steps 3-5 in a later deploy. The first deploy switches every client |
| `McpAgent` with sessionful features | Sections 2, 3, 4, 5 (dual lane), then 6 |
| SDK v1 via `createMcpHandler(v1Server)`, `experimental_createMcpHandler` or `createLegacyMcpHandler` | Sections 2, 3, 4. Add section 5 only if it uses sessionful features |
| Provider `^0.x` in `package.json` | Section 7, as a separate deploy |

Do not keep SDK v1 only because the code imports it today.

## 2. Pin dependencies

Pin `agents`, `@modelcontextprotocol/server` and `zod` as `SKILL.md` section 1 says. Then apply the migration-specific steps:

1. Keep `@modelcontextprotocol/sdk` at the agents pin only while a legacy lane exists. Otherwise remove it.
2. Replace `@cloudflare/agents` with `agents`.
3. Drop `@cloudflare/workers-types` 4 and any hand-written `env.d.ts`; run `pnpm wrangler types`.
4. Install and run the peer check as SKILL.md section 1 steps 3-4 say.

## 3. Move registrations to an SDK v2 factory

The SDK codemod does the mechanical rewrite: `pnpm dlx @modelcontextprotocol/codemod@latest v1-to-v2 .` at the package root, then `grep -rn '@mcp-codemod-error' .`.
Run on a sample (codemod 2.1.0, 2026-09-28), it also did three harmful things:

- rewrote the `McpServer` import inside an `McpAgent` class to `@modelcontextprotocol/server`. `McpAgent` rejects a v2 server (type error; `TypeError` at `onStart` per agents source). Move legacy-lane classes to their own file and keep them out of the codemod's reach, or restore their import by hand;
- removed `@modelcontextprotocol/sdk` from `package.json`, which breaks any legacy lane;
- added `"@modelcontextprotocol/server": "^2.1.0"`, which violates the agents exact peer. Re-apply section 2.

It also maps `extra.authInfo` to `ctx.http?.authInfo`, which is `undefined` on Cloudflare (next table).

By hand, or to check the codemod:

Before (SDK v1, inside `McpAgent.init`):

```ts
this.server.tool("add", "Add two numbers", { a: z.number(), b: z.number() }, async ({ a, b }, extra) => {
  extra.signal.throwIfAborted();
  return { content: [{ type: "text", text: String(a + b) }] };
});
```

After (SDK v2, module-level factory in `src/server.ts`):

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

export function createServer() {
  const server = new McpServer({ name: "notes", version: "2.0.0" });
  server.registerTool(
    "add",
    { description: "Add two numbers", inputSchema: z.object({ a: z.number(), b: z.number() }) },
    async ({ a, b }, ctx) => {
      ctx.mcpReq.signal.throwIfAborted();
      return { content: [{ type: "text", text: String(a + b) }] };
    },
  );
  server.registerTool("whoami", { description: "Current user" }, async () => {
    const props = getMcpAuthContext()?.props as { login?: string } | undefined;
    return { content: [{ type: "text", text: props?.login ?? "anonymous" }] };
  });
  server.registerResource("readme", "notes://readme", {}, async (uri) => ({ contents: [{ uri: uri.href, text: "hello" }] }));
  server.registerPrompt("summarise", { argsSchema: z.object({ topic: z.string() }) }, ({ topic }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Summarise ${topic}` } }],
  }));
  return server;
}
```

| v1 / `McpAgent` | v2 factory |
| --- | --- |
| `extra.signal` | `ctx.mcpReq.signal` |
| `extra.requestId` | `ctx.mcpReq.id` |
| `extra.sendNotification` | `ctx.mcpReq.notify` |
| `extra.requestInfo` | `ctx.http?.req` (a Web `Request`; read headers with `.get()`) |
| `extra.sessionId`, `this.getSessionId()` | none. `ctx.sessionId` exists but a stateless request has no session |
| `extra.authInfo`, `this.props` | `getMcpAuthContext()?.props`. Scopes and client id only in the `apiHandler` wrapper (`references/auth.md` sections 3-4) |
| `this.state`, `setState`, `this.sql` | a Durable Object, D1 or KV addressed by user id or a server-issued handle (section 6) |
| `this.env` | `import { env } from "cloudflare:workers"` |
| `this.server.server.elicitInput(...)`, `this.elicitInput(...)` | `return inputRequired(...)` (`references/handler.md`) |
| `ctx.mcpReq.elicitInput`, `ctx.mcpReq.requestSampling` (codemod output) | `return inputRequired(...)`. Both throw on a 2026-07-28 request |
| Tools registered conditionally on `this.props.permissions` in `init()` | branch in the factory on `getMcpAuthContext()`, or deny in the tool |

Verify: `pnpm tsc --noEmit` passes. On a v2 `McpServer`, `.tool(` and `extra.signal` are type errors, so a clean typecheck proves none survive.

## 4. Replace the entry point

Serve the factory from module scope and keep an object default export. `SKILL.md` section 2 holds the minimal entry and `wrangler.jsonc`.

- Pass the factory, not an instance. `createMcpHandler(v1Server)` from `agents/mcp` is the deprecated overload. It logs a warning and answers every 2026-07-28 request with `400 Unsupported protocol version: 2026-07-28` (re-run 2026-09-28). A v2 instance, such as `createMcpHandler(createServer())` with the section 3 factory, throws `TypeError: createMcpHandler received an unsupported server` at startup.
- `experimental_createMcpHandler(v1Server)` has the same fate: deprecated in agents 0.24.0, with removal announced for the next major.
- If the server has an `McpAgent` class, keep its export, binding and migrations in this deploy. Delete them per section 6 step 5.
- Remove v1 transport options (`sessionIdGenerator`, `enableJsonResponse`, `storage`, `eventStore`, `transport`, `allowedHosts`, `allowedOrigins`, `enableDnsRebindingProtection`, `retryInterval`). The stateless handler throws `TypeError` on them. `enableJsonResponse: true` becomes `responseMode: "json"`.
- Drop `serveSSE`/`mount` routes. The handler serves only its exact `route`, so `/sse` returns 404. HTTP+SSE clients (a `GET` event stream plus `POST /messages`) cannot be served statelessly at all.
- To keep a published `/sse` URL working for Streamable-HTTP clients on an authless server, add a second handler (verified: `POST /sse` serves `initialize`, `GET /sse` returns 405):

  ```ts
  const mcp = createMcpHandler(createServer);
  const sseAlias = createMcpHandler(createServer, { route: "/sse" });
  export default {
    fetch(request, env, ctx) {
      if (new URL(request.url).pathname === "/sse") return sseAlias(request, env, ctx);
      return mcp(request, env, ctx);
    },
  } satisfies ExportedHandler<Env>;
  ```

  Behind OAuth, move clients to `/mcp` instead. The token audience is one exact URL (section 7).
- Clients holding an old `Mcp-Session-Id` keep working: the stateless lane ignores the header and serves the call (verified with a 2025-11-25 `tools/call`).

Verify: run the both-eras probe from `references/testing-deploy.md` against `wrangler dev`. Legacy, `auto` and pinned `2026-07-28` modes must each call a tool.

## 5. Keep a legacy lane only when needed

Route on `isLegacyRequest(request)`. Set `legacy: "reject"` on the stateless handler (upstream's pattern), so a legacy request that reaches it by mistake gets an error instead of stateless service. The generic routing rules live in `references/handler.md` section 6.

`McpAgent` stays SDK v1 on this lane. Leave its class, binding and migrations unchanged.

```ts
import { McpServer as McpServerV1 } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isLegacyRequest } from "@modelcontextprotocol/server";
import { McpAgent } from "agents/mcp";
import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server";

export class MyMCP extends McpAgent<Env, unknown, { login: string }> {
  server = new McpServerV1({ name: "notes", version: "1.0.0" });
  async init() { /* existing v1 registrations, unchanged */ }
}

const stateless = createMcpHandler(createServer, { route: "/mcp", legacy: "reject" });
const legacy = MyMCP.serve("/mcp", { binding: "MCP_OBJECT" });

export default {
  async fetch(request, env, ctx) {
    if (await isLegacyRequest(request)) return legacy.fetch(request, env, ctx);
    return stateless(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
```

For SDK v1 without `McpAgent`, `createLegacyMcpHandler` from `agents/mcp` keeps sessions only when the endpoint's existing `sessionIdGenerator`, Durable Object-backed `storage` or persistent `transport` options are carried over. A fresh v1 server per request with no options is stateless and adds nothing over the default legacy lane (`references/handler.md` section 6). Otherwise route sessionful v1 traffic to an `McpAgent` lane as above.
As of agents 0.24.0, Code Mode and x402 server helpers return v1 servers, so they stay on the legacy lane.
The legacy lane costs bundle size: `wrangler deploy --dry-run` gave 3334 KiB for this router against 1211 KiB for the stateless handler alone (2026-09-28).

Verify under `wrangler dev` (observed 2026-09-28 with the snippet above):

- a legacy `initialize` returns 200 with an `mcp-session-id` header and the v1 `serverInfo`;
- a `server/discover` with the 2026-07-28 `_meta` returns `supportedVersions: ["2026-07-28"]`, the v2 `serverInfo` and no session header;
- a modern `tools/call` returns `resultType: "complete"`.

With OAuth, put this router inside the `apiHandler` object's `fetch` (`references/auth.md` section 5). The provider sets `ctx.props`, so `this.props` keeps working on the legacy lane.

Design the stateless replacement for each sessionful feature while both lanes run. The mapping table is in the Cloudflare migrate guide ("Plan stateless equivalents"). Elicitation and notifications are in `references/handler.md`.

## 6. Retire the `McpAgent` Durable Object

Treat the Worker as deployed, with live DO data, unless the user confirms it never was. A `migrations` block in the repo means some deploy may have applied it. "It probably was never deployed" is not a reason to delete or edit a migration entry. Ask, or take the append-only path below.

Each `McpAgent` instance is one MCP session, named `streamable-http:<sessionId>`, `sse:<sessionId>` or `rpc:<sessionId>`. Its `state` and SQL are therefore per session, not per user.

1. **Drain.** Log each request the router sends to the legacy lane. Watch that count in Workers Logs (`references/testing-deploy.md`, observability). Keep the lane until it reaches zero or you accept cutting off the rest.
2. **Remove the legacy branch and switch the stateless handler back to the default.** Drop `legacy: "reject"` in the same deploy. Otherwise every 2025-era client breaks, not just sessionful ones. Keep `MyMCP` exported and bound in this deploy, so a rollback still finds its data.
3. **Move data you need.** Copy anything durable out of the session objects to a user-keyed store before deleting. Deleting the class deletes its data permanently.
4. **Keep app state in a Durable Object if you need one.** Address it by user id or a server-issued handle, not by session:

   ```ts
   import { DurableObject } from "cloudflare:workers";
   export class Notes extends DurableObject<Env> {
     add(text: string) {
       this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS notes (text TEXT)");
       this.ctx.storage.sql.exec("INSERT INTO notes (text) VALUES (?)", text);
     }
   }
   // in a tool: await env.NOTES.getByName(login).add(text);
   ```

   DO design belongs to the `durable-objects` skill.
5. **Delete the protocol DO in a later deploy.** Remove the class from code, remove its `durable_objects.bindings` entry, and append a delete step. Never edit or remove an applied migration entry; append a new tag. Cloudflare records applied tags and runs only new ones:

   ```jsonc
   "migrations": [
     { "tag": "v1", "new_sqlite_classes": ["MyMCP"] },
     { "tag": "v2", "deleted_classes": ["MyMCP"] }
   ]
   ```

   A Worker already on declarative `exports` uses a tombstone instead: `"exports": { "MyMCP": { "type": "durable-object", "state": "deleted" } }`. `exports` and `migrations` are mutually exclusive, and moving to `exports` is one-way. Do not switch flows in the same deploy as a delete.

Verify: `pnpm wrangler deploy --dry-run` passes for both shapes above (checked 2026-09-28). If the binding is still there after the class is gone, the build fails with `Your Worker depends on the following Durable Objects, which are not exported in your entrypoint file: MyMCP`. `wrangler deploy` prints the applied migration.

## 7. `workers-oauth-provider` 0.x to 1.x

Do this as its own deploy after the MCP handler works. Read the package's own `node_modules/@cloudflare/workers-oauth-provider/docs/migration-1.0.md` after install. Standing 1.x rules, identity and scopes live in `references/auth.md`. The scope-checking `apiHandler` wrapper, its `ctx` cast and the `requiredScopes` status are in `references/auth.md` sections 4-5.

Breaking changes that bite 0.x MCP servers:

| 0.x code | 1.x |
| --- | --- |
| no `resourceMetadata` | `resourceMetadata: { resource: "https://mcp.example.com/mcp" }` is required. Missing it throws `TypeError: resourceMetadata.resource is required...` at construction, so the Worker fails at startup (`wrangler dev`, deploy) |
| `resourceMatchOriginOnly` | removed; construction throws |
| `apiHandlers: { "/sse": X.serveSSE("/sse"), "/mcp": X.serve("/mcp") }` | `apiRoute: "/mcp"` + one `apiHandler`. Every route must sit under the resource path, so a `/sse` key throws |
| `apiHandler: MyMCP.serve("/mcp")` | an object whose `fetch` calls the stateless handler or the section 5 router |
| `apiHandler: createMcpHandler(createServer)` (agents example on `^0.8.1`) | a type error on 1.1.0, and the dist rejects a function handler. Wrap it in an object `fetch` (`references/auth.md` section 5) |
| `resolveExternalToken` returns `{ props }` | must also return `audience`, equal to the resource |
| DCR clients registered with narrow `grant_types` | enforced in 1.x: `unauthorized_client` |
| `redirect_uri` at code exchange differs from `/authorize` | rejected in 1.x |
| hand-rolled `workers-oauth-utils.ts` consent, CSRF and `state` cookies | 1.1.0 `beginConsent`/`approveConsent`/`beginUpstream`/`finishUpstream` (`references/auth.md` section 5) |

Existing grants and tokens keep working with no KV migration: 0.x tokens bind to the sole configured resource.
The removal of `allowImplicitFlow`/`allowPlainPKCE` in the provider README on GitHub `main` belongs to the unreleased 1.2.0.

Verify:

1. `pnpm tsc --noEmit` passes.
2. Under `wrangler dev`, `curl -i http://localhost:8787/mcp` returns 401 with `WWW-Authenticate: Bearer ... resource_metadata=".../.well-known/oauth-protected-resource/mcp"`. A construction error appears here instead, naming the broken rule.
3. After a clean login, a tool that reads `getMcpAuthContext()?.props` returns the user.

## 8. Stale pattern to current replacement

Rows were checked against upstream sources on 2026-09-28.

| Stale pattern (old docs, skills, training data) | Current replacement |
| --- | --- |
| `import ... from "@cloudflare/agents"` | package `agents` |
| `agents ^0.0.x` to `^0.17` | latest `agents`, MCP peers pinned exactly (section 2) |
| `@modelcontextprotocol/sdk` as the server SDK | `@modelcontextprotocol/server` at the agents pin; v1 only on a legacy lane |
| `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"` | `import { McpServer } from "@modelcontextprotocol/server"` |
| `class MyMCP extends McpAgent` + `init()` | `function createServer()` returning `McpServer`, served by `createMcpHandler` |
| `export default MyMCP.serve("/mcp")` | module-scope `const mcp = createMcpHandler(createServer)` + `{ fetch }` object export |
| `MyMCP.serveSSE("/sse")`, `MyMCP.mount("/sse")`, `transport: "sse"` | none. Streamable HTTP at `/mcp` |
| `import { createMcpHandler } from "agents/mcp"` | `from "agents/mcp/server"` |
| `createMcpHandler(server)` or `createMcpHandler(createServer())` | `createMcpHandler(createServer)`: the factory |
| `experimental_createMcpHandler(server)` | `createMcpHandler(createServer)` |
| `export default createMcpHandler(createServer)` (agents) | `export default { fetch: (r, e, c) => mcp(r, e, c) }` |
| `createMcpHandler(...)` built inside `fetch` per request | build once at module scope, so `mcp.notify.*` reaches listeners |
| `server.tool(name, desc, shape, cb)` | `server.registerTool(name, { description, inputSchema: z.object(shape) }, cb)` |
| `server.resource(name, uri, cb)` | `server.registerResource(name, uri, {}, cb)` |
| `server.prompt(name, shape, cb)` | `server.registerPrompt(name, { argsSchema: z.object(shape) }, cb)` |
| raw shape `inputSchema: { a: z.number() }` (still in Cloudflare docs) | `inputSchema: z.object({ a: z.number() })`; raw shape is `@deprecated` |
| `setRequestHandler(CallToolRequestSchema, ...)` | `setRequestHandler("tools/call", ...)` |
| `McpError`, `ErrorCode` | `ProtocolError`, `ProtocolErrorCode` (codemod renames them) |
| `extra.signal`, `extra.requestId`, `extra.authInfo` | section 3 table |
| `this.props` | `getMcpAuthContext()?.props` |
| `context.http?.authInfo?.clientId` in a tool (Cloudflare handler docs, `mcp-worker-authenticated`) | `undefined` under every released provider; see `references/auth.md` section 3 |
| `this.elicitInput(...)`, `this.server.server.elicitInput(...)` | `return inputRequired(...)` (`references/handler.md`) |
| `server.sendLoggingMessage`, `logging/setLevel`, sampling, roots | deprecated in 2026-07-28; `references/spec.md` |
| `enableJsonResponse: true` | `responseMode: "json"` |
| `sessionIdGenerator`, `eventStore`, `storage` handler options | removed; `TypeError` on the stateless handler |
| `Mcp-Session-Id` handling, GET SSE stream, `Last-Event-ID` resume | none in 2026-07-28; the stateless lane ignores a stale session header |
| `durable_objects` binding + `migrations` required for MCP | none for a stateless server |
| `new_classes` for a new DO | `new_sqlite_classes`, or declarative `exports` with `"storage": "sqlite"` |
| editing an applied migration to drop a class | append `{ "tag": "vN", "deleted_classes": [...] }` |
| `wrangler.toml` | `wrangler.jsonc` with `$schema` |
| `@cloudflare/workers-types` 4 + hand-written `env.d.ts` | `pnpm wrangler types` |
| `compatibility_date` copied from a template (`2025-...`) | the creation date |
| `zod ^3` | `zod ^4.2.0` |
| `@cloudflare/workers-oauth-provider ^0.x` | `^1.1.0` with `resourceMetadata` (section 7) |
| `OAuthProvider({ apiHandlers: { "/sse": ..., "/mcp": ... } })` | `apiRoute: "/mcp"` + one wrapped `apiHandler` |
| `apiHandler: createMcpHandler(createServer)` | `apiHandler: { fetch: (r, e, c) => mcp(r, e, c) }` |
| `requiredScopes` (provider README on `main`) | unreleased 1.2.0; `resourceMetadata.scopes_supported` on 1.1.0 |
| `clientRegistrationEndpoint` (DCR) as the only registration | CIMD first, DCR as fallback (`references/auth.md`) |
| template `cloudflare/ai/demos/remote-mcp-github-oauth` | still `McpAgent` + provider 0.x; start from `assets/stateless-server/` |
| `agents init`, `agents dev`, `agents deploy` | removed in agents 0.22.0; use Wrangler |
| `npx @modelcontextprotocol/inspector` | `references/testing-deploy.md` (pnpm trust policy blocks it) |
| `@cloudflare/vitest-pool-workers`, `defineWorkersConfig` | `@cloudflare/vitest-plugin`, `cloudflareTest` (`references/testing-deploy.md`) |
| spec `2025-06-18` or `2025-03-26` as latest | `2026-07-28` (`references/spec.md`) |
| error codes `-32001`, `-32003`, `-32004` from the 2026-07-28 RC | `-32020`, `-32021`, `-32022` (`references/spec.md`) |
| `developers.cloudflare.com/agents/mcp/` | 404; use `/agents/model-context-protocol/` |

## 9. Not verified at runtime

- A full OAuth login on provider 1.1.0 (`references/auth.md` section 10). The function-handler rejection and the construction errors come from reading the dist, not from running it, because the quarantine blocked the install.
- A real `wrangler deploy` applying `deleted_classes` or an `exports` tombstone. Only `--dry-run` ran.
- The `TypeError` from `McpAgent.onStart` with a v2 server. It comes from agents source, and the type error was observed.

## 10. Sources

- Cloudflare migrate guide: <https://developers.cloudflare.com/agents/model-context-protocol/guides/migrate-to-mcp-sdk-v2/index.md>
- Handler API (`createMcpHandler`, `createLegacyMcpHandler`): <https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/index.md>
- `McpAgent` API (deprecated): <https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/index.md>
- agents changelog (0.20.0 deprecations, 0.22.0 CLI removal): <https://github.com/cloudflare/agents/blob/main/packages/agents/CHANGELOG.md>
- SDK v1 to v2 guide and codemod: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md>
- Provider 1.0 migration: <https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/migration-1.0.md>
- DO migrations: <https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/index.md> and `exports`: <https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/index.md>
