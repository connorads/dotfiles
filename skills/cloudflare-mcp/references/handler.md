# Stateless handler in depth

`createMcpHandler` from `agents/mcp/server`: construction, options, Origin/Host policy, CORS, the legacy lane, tools, elicitation, notifications, framework integration and application state (Durable Objects, KV, D1).

Snapshot of 2026-09-28: agents 0.24.0, `@modelcontextprotocol/server` 2.0.0, `@modelcontextprotocol/client` 2.0.0, wrangler 4.137.0.
Claims marked (observed) ran under `wrangler dev` or Node with the v2 client. Unmarked claims come from the source and docs linked below. Snippets are fragments. Outside section 12, each typechecked against those versions inside a project that declares the names it leaves undeclared (`createServer`, `server`, `addNote`).

Upstream to re-verify:

- Handler API: <https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/index.md>
- Source: <https://github.com/cloudflare/agents/blob/main/packages/agents/src/mcp/server/handler-stateless.ts> (read at `a8673b7c27ce7593e31c1d993dc8940bfb236bbf`)
- Migration guide (dual-era routing): <https://developers.cloudflare.com/agents/model-context-protocol/guides/migrate-to-mcp-sdk-v2/index.md>

Install pins, the pin check, `wrangler.jsonc` and the minimal server live in `SKILL.md`. Auth lives in `references/auth.md`. Tests live in `references/testing-deploy.md`.

## Contents

1. Imports
2. Construction
3. Options
4. Origin and Host policy
5. CORS
6. Legacy lane and dual-lane routing
7. Tools
8. Notifications
9. Hono or an existing router
10. Elicitation (MRTR)
11. Durable Objects, KV or D1 for application state
12. Code Mode servers

## 1. Imports

| Import | From | Notes |
| --- | --- | --- |
| `createMcpHandler`, `getMcpAuthContext`, types `CreateMcpHandlerOptions`, `CreateStatelessMcpHandlerOptions`, `StatelessMcpHandler`, `StatelessMcpServerInput`, `McpAuthContext` | `agents/mcp/server` | Nothing else is exported here. |
| `McpServer`, `isLegacyRequest`, `inputRequired`, `acceptedContent`, `inputResponse`, `createRequestStateCodec`, types `McpServerFactory`, `CallToolResult`, `InputRequiredResult` | `@modelcontextprotocol/server` | SDK v2. |
| `createLegacyMcpHandler`, `McpAgent`, `WorkerTransport` | `agents/mcp` | Legacy barrel. Import it only for a legacy lane (section 6). |

The `agents/mcp` barrel also exports a `createMcpHandler`. It is an overload that sends SDK v1 instances to `createLegacyMcpHandler` with a deprecation warning.
The `agents/mcp/server` one accepts only a factory.

## 2. Construction

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";

function createServer() {
  const server = new McpServer({ name: "notes", version: "1.0.0" });
  // server.registerTool(...)
  return server;
}

const handler = createMcpHandler(createServer); // module scope, once

export default {
  fetch(request, env, ctx) {
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
```

- The handler calls the factory on every request and connects a fresh server. An `McpServer` instance in its place constructs fine, then `onerror` receives `factory is not a function` on every request (observed).
- **Never cache a server across requests** inside the factory. Concurrent requests must not share a connected server.
- **The factory does not receive `env`.** Its only argument is `{ era: "modern" | "legacy", authInfo?, requestInfo? }`, and a zero-argument factory is valid. The `cloudflare:workers` `env` rule is SKILL.md section 3 (verified in a tool that calls a Durable Object, section 11).
- `export default createMcpHandler(createServer)` crashes `wrangler dev` at startup with `Uncaught TypeError: Class extends value (request, _env, ctx) => serve(request, void 0, ctx) is not a constructor or null` (observed).
- **Per-request construction** (`createMcpHandler(createServer)(request, env, ctx)` inside `fetch`, as the Cloudflare docs show) works for tools, prompts, resources and elicitation. It cannot deliver `notify.*`.

The handler is callable as `(request, env, ctx)` and also exposes two properties:

- `handler.fetch(request, { authInfo?, parsedBody? })` is for middleware that has already verified a token or parsed the body. It never sees `ctx`, so `ctx.props` does not reach `getMcpAuthContext()` unless you set the `authContext` option (see `references/auth.md`).
- `handler.notify` is covered in section 8.

## 3. Options

| Option | Default | Behaviour |
| --- | --- | --- |
| `route` | `"/mcp"` | Exact pathname match. `/mcp/` and every other path return 404. Match the full URL path, including any router prefix. |
| `corsOptions` | wildcard CORS | `{ origin?, headers?, methods?, exposeHeaders?, maxAge? }` overrides fields one by one. `false` strips every `Access-Control-*` header from responses. Section 5. |
| `allowedHostnames` | localhost-class on a localhost URL, the request hostname on `*.workers.dev`, else no Host check | Setting it **replaces** the defaults, so include `localhost` and `127.0.0.1` if you still run `wrangler dev` with it. Bad Host returns 403 `Invalid Host: <host>`. |
| `allowedOriginHostnames` | localhost-class, the `workers.dev` hostname, and the hostname of a concrete `corsOptions.origin` | Setting a list **replaces** the defaults. `"*"` disables the Origin check, including malformed-Origin rejection. Use `"*"` only behind middleware that validates Origin. |
| `authContext` | `ctx.props` if non-empty | Fixed `{ props }` returned by `getMcpAuthContext()`. Overrides `ctx.props`. |
| `legacy` | `"stateless"` | `"reject"` answers a 2025-era `initialize` with 400 `-32022 Unsupported protocol version: <requested version>` plus the supported list (observed for `2025-11-25`). A request naming no version gets `Unsupported protocol version: the request did not name a protocol version`. 2025-era GET and DELETE get 405 `Method not allowed.`, batches and posted responses 400 `-32600`, and notifications 202 and are dropped. Section 6. |
| `responseMode` | `"auto"` | `"json"` never streams and drops notifications emitted before the final result. `"sse"` always streams. Replaces v1 `enableJsonResponse`. |
| `onerror` | none | `(error: Error) => void`, reporting only: it never changes the response. It receives the cause of every 500 (the client sees only `-32603 Internal server error`) and every request the SDK rejects with a 4xx: unsupported protocol version, `Mcp-Method`/`Mcp-Name`/`Mcp-Param-*` mismatches, missing client capabilities, legacy `Method not allowed.`. Host and Origin 403s do not reach it. Filter on error type or message before alerting on it. |
| `maxSubscriptions` | 1024 | Concurrent `subscriptions/listen` streams per handler instance. |
| `keepAliveMs` | 15000 | Keepalive comment interval on listen streams. `0` disables it. Also applies to legacy-lane SSE. |

Rejected at construction with `TypeError` (observed):

- `bus`: `createMcpHandler option "bus" is not exposed by the Agents SDK.`
- SDK v1 transport options `transport`, `storage`, `sessionIdGenerator`, `onsessioninitialized`, `onsessionclosed`, `enableJsonResponse`, `eventStore`, `allowedHosts`, `allowedOrigins`, `enableDnsRebindingProtection` and `retryInterval`. The message is `... is only supported with an MCP SDK v1 server. The managed SDK v2 handler is stateless`.

Use `allowedHostnames` and `allowedOriginHostnames` in place of v1 `allowedHosts` and `allowedOrigins`. Values are bare hostnames, without scheme or port.

## 4. Origin and Host policy

The checks run in this order, before CORS preflight handling and before the body is read:

1. Route match, else 404.
2. Host check, only when an allowlist applies (table above). A failure returns 403.
3. Origin check, only when an `Origin` header is present. An unlisted Origin returns 403 `Invalid Origin: <hostname>`. A malformed or opaque (`null`) Origin returns 403 `Invalid Origin header: <value>`. Non-browser clients send no Origin and pass.
4. `OPTIONS` returns the CORS preflight response.

So a preflight from an unlisted browser Origin gets 403, and the browser blocks the call.

On a custom domain, set both lists explicitly:

```ts
const handler = createMcpHandler(createServer, {
  allowedHostnames: ["mcp.example.com", "localhost", "127.0.0.1"],
  allowedOriginHostnames: ["app.example.com", "localhost"],
  corsOptions: { origin: "https://app.example.com" },
});
```

- Without `allowedHostnames`, a custom domain gets no Host check at all. The handler never infers one from `request.url`.
- A browser MCP client on localhost (for example Inspector's web UI) needs `localhost` in `allowedOriginHostnames` once you set that list.

## 5. CORS

The default response headers, from source:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Expose-Headers: mcp-session-id
Access-Control-Max-Age: 86400
```

- `Mcp-Param-*` headers are missing from the default list. A modern client mirrors every `x-mcp-header` tool argument into one (section 7). A browser client calling such a tool therefore fails its preflight unless you extend the list. An `OPTIONS` preflight asking for `mcp-param-region` got the default list back (observed); no real browser was run.
- `corsOptions.headers` **replaces** the whole list. Repeat the defaults you still need:

```ts
corsOptions: {
  origin: "https://app.example.com",
  headers: "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Param-Region",
},
```

This preflight returned exactly that `Access-Control-Allow-Headers` value (observed).

- When a framework's CORS middleware owns CORS, pass `corsOptions: false`. Keep the Origin allowlist on the handler. Observed with Hono `cors()` in front: the POST and the preflight both carried Hono's headers.
- Proxies and gateways in front of the Worker must forward `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` and every `Mcp-Param-*` header unchanged. The modern lane validates them against the body and rejects a mismatch with 400.

## 6. The legacy lane and dual-lane routing

With the default `legacy: "stateless"`, 2025-era requests go to a compatibility lane on the SDK v2 web-standard transport. Its limits:

- Each POST builds a new server and transport. No `mcp-session-id` is issued (observed).
- GET and DELETE return 405 `Method not allowed.` (observed). Standalone streams, `Last-Event-ID` replay and session deletion do not exist.
- Server-to-client requests (push elicitation, sampling, roots) fail at once. An `inputRequired(...)` tool returns an `isError` result to a 2025 client: `Cannot request input 'confirm' (elicitation/create): the client on this 2025-era connection did not declare the required capability ...` (observed).
- Experimental 2025 tasks are unsupported. Inbound `tasks/*` gets `-32601`.

When 2025 clients need sessionful features, route them to a sessionful legacy handler: `references/migrate.md` section 5 owns that router, draining and removal.
The routing rules it relies on:

- The stateless handler must use `legacy: "reject"`, or it serves legacy requests itself.
- `isLegacyRequest(request)` from `@modelcontextprotocol/server` does not consume the body. The same `request` goes on to the chosen handler (observed: the legacy client reached the v1 server and the pinned 2026-07-28 client reached the v2 server).
- A legacy lane without sessions (`createLegacyMcpHandler` alone) adds nothing over the default `legacy: "stateless"`.
- The v1 lane needs `@modelcontextprotocol/sdk` at the exact version agents pins (SKILL.md section 1).

## 7. Tools

```ts
import { z } from "zod";

server.registerTool(
  "add_note",
  {
    title: "Add note",
    description: "Append a note to the caller's notebook. Returns the new note count.",
    inputSchema: z.object({
      text: z.string().min(1).describe("Note body, plain text"),
      region: z.string().optional().meta({ "x-mcp-header": "Region" }),
    }),
    outputSchema: z.object({ count: z.number().int() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ text }) => {
    const output = { count: await addNote(text) };
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
  },
);
```

- **Schemas** are Standard Schema objects (`z.object`, Valibot or ArkType). A raw shape `{ text: z.string() }` hits a `@deprecated` overload. `.describe()` text needs the zod range in SKILL.md section 1.
- **No `inputSchema`** changes the callback signature: it receives only `(context)`. The template's `server_time` tool shows it.
- **Structured output**: with an `outputSchema`, return `structuredContent` that conforms to it. Also return the same JSON as a text block for clients that ignore `structuredContent`. Both eras received `structuredContent` (observed).
- **Annotations** are untrusted hints to the client. Set `destructiveHint: true` on tools that delete or overwrite, so clients can ask for confirmation.
- **Tool errors**: return `{ content: [...], isError: true }` with a message the model can act on. Both eras received `isError: true` (observed). A thrown error also becomes an `isError` result whose text is the raw error message (observed in the legacy lane), so never let an error that carries tokens or internal detail escape a callback.
- **`x-mcp-header`**: `.meta({ "x-mcp-header": "Region" })` lands in the advertised JSON Schema. A modern client then sends `Mcp-Param-Region: <value>` on `tools/call` (observed). Only primitive properties reachable through `properties` may carry it. An invalid declaration logs a `[mcp-sdk]` warning, and conforming clients drop the tool. Add each header to CORS (section 5).
- **Callback `context`** gives `context.mcpReq.signal` (aborts when the client closes the stream, which is how HTTP cancellation works), `context.mcpReq.id` and `context.http?.req`. For identity, use `getMcpAuthContext()`. `context.http?.authInfo` is `undefined` behind the Cloudflare OAuth provider (`references/auth.md` section 3).

### `resultType` on hand-built results

The 2026-07-28 wire requires `resultType` on every result, plus `ttlMs` and `cacheScope` on list and read results.
`McpServer` and the low-level `Server` add these fields for you, and the public TypeScript result types omit `resultType` on purpose. Do not add it to tool returns.
Only JSON-RPC you write by hand needs it, for example a custom proxy, a test double or a canned response: add `"resultType": "complete"`.
The v2 client rejects a modern-era result that lacks it (`Invalid result for <method>: missing required resultType`, from `@modelcontextprotocol/client` 2.0.0 source). The spec's absent-means-complete leniency covers only earlier-revision servers.

## 8. Notifications

- `handler.notify.toolsChanged()`, `.promptsChanged()`, `.resourcesChanged()` and `.resourceUpdated(uri)` publish to open `subscriptions/listen` streams. A notifier with no matching subscription does nothing.
- They reach only streams opened on **the same handler instance in the same isolate**. With a module-scope handler, a v2 client's `listen({ toolsListChanged: true })` received `notifications/tools/list_changed` triggered from another request (observed in `wrangler dev`, which runs one isolate).
- Production runs many isolates, and the agents wrapper rejects a custom `bus`, so the handler cannot fan a notification out across isolates. Design so clients do not depend on it: keep tool lists static per deployment, and let clients re-list after redeploys. Cross-isolate delivery was not tested.
- `responseMode: "json"` drops progress and log notifications sent before a tool's final result.

## 9. Hono or an existing router

Hand the raw `Request` to the handler. Keep `route` equal to the full path the router matched:

```ts
import { Hono } from "hono";
import { createMcpHandler } from "agents/mcp/server";

const mcp = createMcpHandler(createServer); // route "/mcp"
const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("ok"));
app.all("/mcp", (c) => mcp(c.req.raw, c.env, c.executionCtx as ExecutionContext));

export default app;
```

- Use `app.all`, not `app.post`, so that OPTIONS preflights and the GET/DELETE 405 answers still come from the handler.
- The `as ExecutionContext` cast is needed because Hono's `ExecutionContext` type lacks the newer `tracing` and `abort` members. Without it, typecheck fails with TS2739. Do not use `@ts-expect-error`.
- A Hono app is an object with `fetch`, so `export default app` is safe.
- Mounted under a prefix, the handler still sees the full URL. `app.all("/api/mcp", ...)` needs `createMcpHandler(createServer, { route: "/api/mcp" })`.
- A plain router works the same way: `if (pathname === "/api/mcp") return mcp(request, env, ctx);`.

Both eras called a tool through the Hono app (observed).

## 10. Elicitation (MRTR)

A modern-era tool asks the user for input by returning `inputRequired(...)`. The client retries the same `tools/call` with the answers and the echoed `requestState`. The Worker does not wait in between.

```ts
import {
  McpServer, acceptedContent, createRequestStateCodec, inputRequired,
  type CallToolResult, type InputRequiredResult,
} from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { z } from "zod";

type DeleteState = { path: string };

const codec = createRequestStateCodec<DeleteState>({
  key: env.MRTR_REQUEST_STATE_KEY, // secret, at least 32 bytes
  bind: ({ mcpReq }) => `${mcpReq.method}\0${String(getMcpAuthContext()?.props.userId ?? "")}`,
});

function createServer() {
  const server = new McpServer({ name: "files", version: "1.0.0" }, { requestState: { verify: codec.verify } });
  server.registerTool(
    "delete_file",
    { description: "Delete a file after the user confirms", inputSchema: z.object({ path: z.string() }), annotations: { destructiveHint: true } },
    async ({ path }, context): Promise<CallToolResult | InputRequiredResult> => {
      const state = context.mcpReq.requestState<DeleteState>();
      if (!state) {
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Delete ${path}?`,
              requestedSchema: { type: "object", properties: { ok: { type: "boolean", title: "Delete" } }, required: ["ok"] },
            }),
          },
          requestState: await codec.mint({ path }, context),
        });
      }
      const answer = acceptedContent(context.mcpReq.inputResponses, "confirm", z.object({ ok: z.boolean() }));
      if (!answer?.ok) return { content: [{ type: "text", text: "Cancelled." }] };
      return { content: [{ type: "text", text: `Deleted ${state.path}` }] };
    },
  );
  return server;
}

const handler = createMcpHandler(createServer);
```

- A pinned 2026-07-28 client with an `elicitation/create` handler completed this flow in one retry (observed). A 2025 client got the `isError` result quoted in section 6. Offer a non-interactive fallback, or route 2025 clients to a sessionful lane.
- Act on values from `requestState`, not from the retried arguments. The client can change arguments between rounds, but it cannot forge a sealed state.
- `requestState` is signed, not encrypted. Keep secrets out of it.
- The codec throws `RangeError` for a key shorter than 32 bytes. Store the key as a secret (`pnpm wrangler secret put MRTR_REQUEST_STATE_KEY`, and `.dev.vars` locally). Every isolate must share it.
- `bind` ties state to the method and the user. Use `getMcpAuthContext()` for the user. The SDK's own example binds `ctx.http?.authInfo?.clientId`, which is `undefined` behind the Cloudflare OAuth provider (`references/auth.md` section 3), so that binding silently protects nothing.
- `inputResponses` holds only the previous round's answers. Carry earlier answers forward in `requestState`. Use `inputResponse(context.mcpReq.inputResponses, key)` when you need to tell `decline` apart from `cancel`.
- `ttlSeconds` defaults to 600.
- `context.mcpReq.elicitInput` and `requestSampling` throw on modern requests. Never use them in a stateless server.
- Upstream multi-round example: <https://github.com/cloudflare/agents/tree/main/examples/mcp-elicitation-mrtr> (it builds the codec and handler per request and sets `legacy: "reject"`).

## 11. Durable Objects, KV or D1 for application state

The protocol needs no Durable Object. Add one only for **application** state that must be strongly consistent or coordinated, such as per-user notebooks, locks, counters, long jobs or WebSockets.

```ts
import { DurableObject, env } from "cloudflare:workers";
import { getMcpAuthContext } from "agents/mcp/server";

export class Notes extends DurableObject<Env> {
  async add(text: string): Promise<number> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS notes (text TEXT)");
    this.ctx.storage.sql.exec("INSERT INTO notes VALUES (?)", text);
    return this.ctx.storage.sql.exec("SELECT count(*) AS n FROM notes").one().n as number;
  }
}

async function addNote(text: string) {
  const user = String(getMcpAuthContext()?.props.userId ?? "anonymous");
  return env.NOTES.get(env.NOTES.idFromName(user)).add(text);
}
```

```jsonc
// wrangler.jsonc additions for a new Worker
"durable_objects": { "bindings": [{ "name": "NOTES", "class_name": "Notes" }] },
"exports": { "Notes": { "type": "durable-object", "storage": "sqlite" } }
```

- Export the class from the Worker's `main` module. `wrangler dev` refuses to start if a bound class is not exported.
- New Workers use declarative `exports`. It is mutually exclusive with `migrations`. Once a Worker deploys with `exports`, it cannot return to `migrations`. An existing Worker can keep `migrations` (`new_sqlite_classes`) or convert with no data migration. Source: <https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/index.md>. The config above ran under `wrangler dev` and passed `wrangler deploy --dry-run` (observed). A real deploy was not run.
- Key objects by the authenticated user, never by a client-supplied id alone. When a tool returns a handle for later calls, bind it to the user (`<userId>:<handle>`), make it random, and let it expire. Possessing a handle is not authorisation.
- Run `pnpm wrangler types` after adding the binding so `Env.NOTES` is typed.

### KV or D1 for app state

Use KV when a stale read for up to 60 s is acceptable, such as a shared notebook listed and searched but rarely edited.

```jsonc
// wrangler.jsonc: `id` is optional (config schema, wrangler 4.137.0). `wrangler dev` uses local storage, and deploy provisions a namespace when it is absent
"kv_namespaces": [{ "binding": "NOTES" }]
```

- Run `pnpm wrangler types`, then read `env.NOTES` through `import { env } from "cloudflare:workers"`.
- Put the fields a list tool returns into `put(key, value, { metadata })`. `list({ prefix, cursor })` returns each key's metadata, so listing costs one call per 1,000 keys instead of one `get` per key. Loop until `list_complete`.
- KV is eventually consistent: a write can take 60 s or more to show in other locations (Cloudflare KV docs). When a tool must read its own write, or two writers race, use a Durable Object (above) or D1 instead.

## 12. Code Mode servers

`codeMcpServer` and `openApiMcpServer` from `@cloudflare/codemode/mcp` return **SDK v1** servers. `codeMcpServer` takes a v1 `McpServer` as `server` and is async, so await it. `openApiMcpServer({ spec, executor, request })` returns synchronously.
Build both servers per request inside `fetch` and serve them with `createLegacyMcpHandler` from `agents/mcp`, not with the stateless handler, so they speak only the legacy era:

```ts
const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
const server = await codeMcpServer({ server: createUpstreamV1Server(), executor });
return createLegacyMcpHandler(server, { route: "/mcp" })(request, env, ctx);
```

They need a `worker_loaders` binding for `DynamicWorkerExecutor` and `nodejs_compat`.
Guide: <https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/index.md>.
This section comes from the docs and the upstream `examples/codemode-mcp` source (`a8673b7`) and was not run.
