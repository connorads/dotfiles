# MCP spec for server implementers

What the protocol requires of a remote MCP server on Workers, and which client eras each Cloudflare handler serves.
Facts verified 2026-09-28 against spec tag `2026-07-28` (commit `5f5440bb`), `agents@0.24.0` and `@modelcontextprotocol/server@2.0.0` under `wrangler dev`.
Re-check the revision before relying on this file (section 1).

## Contents

1. Current revision
2. Eras
3. Modern wire contract
4. Compatibility matrix
5. Input from the user (MRTR)
6. Change notifications
7. Tool features
8. Tasks
9. Deprecations
10. Authorisation model
11. Sources

## 1. Current revision (live check)

```sh
curl -sI https://modelcontextprotocol.io/specification/latest | grep -i '^location'
# 2026-09-28: location: /specification/2026-07-28
gh api repos/modelcontextprotocol/modelcontextprotocol/git/refs/tags --jq '.[].ref|sub("refs/tags/";"")' | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort | tail -3
```

If the location is newer than `2026-07-28`, read its changelog before trusting sections 2-9: `https://modelcontextprotocol.io/specification/<rev>/changelog.md` (every spec page serves markdown with a `.md` suffix).

Traps when judging the revision from memory or code:

- `2026-07-28` is GA (released 2026-07-28). Cloudflare Agents docs and changelogs that call it "draft" or "release candidate" are stale on that point.
- SDK constant `LATEST_PROTOCOL_VERSION` is `"2025-11-25"` in `@modelcontextprotocol/server@2.0.0`. It is the newest *legacy* revision, not the newest revision. The SDK exports no constant for the modern revision (`MODERN_WIRE_REVISION` is internal), so use the literal `"2026-07-28"`.
- Code or blogs from the RC period (May-July 2026) use error codes `-32001`/`-32003`/`-32004`. GA renumbered them (section 3).

## 2. Eras

The spec's own terms (`basic/versioning`): **modern** = `2026-07-28` and later. **Legacy** = `2025-11-25` and earlier. **Dual-era** = serves both.

| Concern | 2026-07-28 (modern) | 2025-11-25 | 2025-06-18 |
| --- | --- | --- | --- |
| Startup | No handshake. Every request carries `_meta` (section 3). `server/discover` is MUST-implement for servers, optional for clients | `initialize` + `notifications/initialized` | same as 2025-11-25 |
| Sessions | None. `Mcp-Session-Id` removed; ignore it inbound, never mint it | Optional `Mcp-Session-Id` | same |
| Server asks client for input | Return `input_required` result; client retries (section 5). Server MUST NOT send JSON-RPC requests | Server pushes `elicitation/create`, `sampling/createMessage`, `roots/list` | same, minus URL-mode elicitation |
| Change notifications | `subscriptions/listen` POST whose SSE response carries opted-in notifications | GET SSE stream + `resources/subscribe` | same |
| Stream recovery | None. No event ids, no `Last-Event-ID`; a broken stream loses the request and the client re-issues it | `Last-Event-ID` resume | same |
| HTTP headers | `MCP-Protocol-Version`, `Mcp-Method` on every POST; `Mcp-Name` on `tools/call`, `resources/read`, `prompts/get`; `Mcp-Param-*` for `x-mcp-header` params | `MCP-Protocol-Version` after `initialize` | `MCP-Protocol-Version` introduced |
| Result envelope | Required `resultType` (`"complete"` or `"input_required"`); `ttlMs` + `cacheScope` on list results and `resources/read` | none | none |
| Removed methods | `ping`, `logging/setLevel`, `resources/subscribe`/`unsubscribe`, `notifications/roots/list_changed`, `notifications/elicitation/complete` | - | - |
| Cancellation (HTTP) | Client closes the response stream | `notifications/cancelled` | same |
| Tasks | Extension `io.modelcontextprotocol/tasks` (section 8) | Experimental core feature | absent |

What each legacy revision added, so you know which client features exist in which era:

- **2025-06-18**: structured tool output and `outputSchema`, resource links, form elicitation, `title` fields, `MCP-Protocol-Version` header, MCP server as OAuth resource server (RFC 9728), RFC 8707 resource indicators required of clients. JSON-RPC batching removed.
- **2025-11-25**: icons, Client ID Metadata Documents (CIMD), incremental scope consent via `WWW-Authenticate`, OIDC discovery for the AS, URL-mode elicitation, experimental tasks, JSON Schema 2020-12 default dialect, `403` for an invalid `Origin`.

## 3. Modern wire contract

A `2026-07-28` request, as `createMcpHandler` from `agents/mcp/server` accepts it:

```http
POST /mcp
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_note

{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{
  "name":"get_note","arguments":{"id":"a"},
  "_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
           "io.modelcontextprotocol/clientCapabilities":{}}}}
```

- `_meta` keys: `protocolVersion` and `clientCapabilities` required, `clientInfo` SHOULD, `logLevel` optional. All are prefixed `io.modelcontextprotocol/`. The header version MUST equal `_meta` `protocolVersion`.
- Results carry `_meta["io.modelcontextprotocol/serverInfo"]`. A modern server MUST include `resultType`. The spec lets clients read a missing one as `"complete"` only from earlier-revision servers, and the v2 client rejects a modern result without it. `McpServer` adds it; hand-written results must too (`references/handler.md` section 7).
- Capabilities are per request, not per connection. A tool that needs a client capability must check the capabilities on that request.
- List endpoints MUST NOT vary per connection. They MAY vary by the authorisation presented.
- Servers MUST NOT emit `notifications/message` for a request that lacks `io.modelcontextprotocol/logLevel`.

Errors observed from the handler (all verified with curl):

| Condition | HTTP | JSON-RPC code |
| --- | --- | --- |
| Header and body disagree, or `Mcp-Name` / declared `Mcp-Param-*` missing (`HeaderMismatch`) | 400 | `-32020` |
| Tool needs a capability the request did not declare, e.g. elicitation (`MissingRequiredClientCapability`) | 400 | `-32021`, `data.requiredCapabilities` |
| Unsupported version (`UnsupportedProtocolVersion`) | 400 | `-32022`, `data.supported` |
| `2026-07-28` header without `_meta` | 400 | error names the missing envelope keys |
| Unknown method, incl. `ping` and `tasks/*` | 404 | `-32601` |
| Unknown tool, malformed `tools/call` (e.g. no `params.name`), resource not found | 200 | `-32602` (resource not found was `-32002` in legacy revisions) |
| Arguments that fail the tool's `inputSchema` | 200 | none: a result with `isError: true` and text `Input validation error: ...` |
| `GET` or `DELETE` on the endpoint | 405 | - |

Codes `-32000..-32019` are legacy, grandfathered for existing SDK usage; new code SHOULD NOT use them. `-32020..-32099` are reserved for MCP. Application-defined codes go outside `-32768..-32000`. Prefer an `isError: true` result to a custom code.

Anything between client and Worker (proxy, WAF, a wrapper `fetch`) must pass `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*` through unchanged, or every modern request fails with `-32020`.

## 4. Compatibility matrix

Clients: **legacy** = sends `initialize` only. **Dual-era** = tries a modern request first and falls back to `initialize` when it gets a 4xx without a modern error body (v2 client `versionNegotiation: { mode: "auto" }`). **Modern-only** = pinned to `2026-07-28`.
All cells verified 2026-09-28 with `@modelcontextprotocol/client@2.0.0` against `wrangler dev`, unless marked.

| Handler | Legacy client | Dual-era client | Modern-only client |
| --- | --- | --- | --- |
| `createMcpHandler(factory)` from `agents/mcp/server` (default `legacy: "stateless"`) | Works, stateless: no session id minted, `GET`/`DELETE` 405. Tools work; Cloudflare docs say resources and prompts do too (not tested here). Pushed elicitation/sampling/roots cannot work: an `inputRequired` tool returns `isError: true` ("per-request legacy serving cannot receive server-to-client requests") | Works, speaks modern | Works |
| `createMcpHandler(factory, { legacy: "reject" })` | Fails: `initialize` gets 400 `-32022`, `supported: ["2026-07-28"]` | Works, speaks modern (the `-32022` body is a modern error, so it does not fall back) | Works |
| `createLegacyMcpHandler(v1Server)` from `agents/mcp` (SDK v1; also what the deprecated `createMcpHandler(v1Instance)` overload calls) | Works; sessionful only if configured with a session transport | Works, falls back and speaks legacy | Fails: modern request gets 400 `-32000` "Unsupported protocol version: 2026-07-28" and no `server/discover` |
| `isLegacyRequest` router: `legacy: "reject"` handler plus `McpAgent.serve()` or `createLegacyMcpHandler` | Works. Sessionful only behind `McpAgent.serve()` (session id observed) or a session `WorkerTransport`; bare `createLegacyMcpHandler` stays sessionless. Pushed elicitation not runtime-tested | Works, modern (not runtime-tested) | Works (observed) |

Decisions that follow:

- Public servers keep `legacy: "stateless"` (SKILL.md section 3).
- A tool that needs user input must degrade on the legacy lane: accept a non-interactive argument (for example `confirm: boolean`), because `inputRequired` returns `isError` there (`references/handler.md` section 6). Legacy clients only get interactive input through the router pattern. Migration steps: `references/migrate.md`.
- `createLegacyMcpHandler` cannot serve modern-only clients at all. Treat it as a bridge with a removal date.

## 5. Input from the user: multi round-trip requests (MRTR)

Modern servers never send requests to the client. A `tools/call`, `prompts/get` or `resources/read` handler returns `input_required` instead, and only those three methods may. Observed wire result:

```json
{"resultType":"input_required",
 "inputRequests":{"confirm":{"method":"elicitation/create","params":{"mode":"form","message":"Delete note a?","requestedSchema":{"type":"object","properties":{"confirm":{"type":"boolean"}},"required":["confirm"]}}}}}
```

The client retries the original request with a **new** JSON-RPC id, `params.inputResponses` keyed the same way, and `requestState` echoed byte for byte.

- `requestState` is attacker-controlled. If it affects authorisation or business logic it MUST be integrity-protected, and SHOULD be bound to the principal, the method and params, and a short expiry. Single use needs a server-side record.
- The Worker holds no open request between rounds. The `requestState` expiry is the only timeout.
- Form elicitation MUST NOT request secrets. Use URL mode for secrets, payments and third-party OAuth. URL mode is not for authorising the MCP client itself.

SDK code (`inputRequired`, `acceptedContent`, `createRequestStateCodec`, carrying earlier answers forward, `ttlSeconds`): `references/handler.md` section 10.

## 6. Change notifications

`subscriptions/listen` is a long-lived POST. The client opts in per kind (`toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions`). The server first sends `notifications/subscriptions/acknowledged`, then tags each notification with `_meta["io.modelcontextprotocol/subscriptionId"]` (verified). Progress and log notifications travel only on the originating request's stream.
Publishing from a Worker and the isolate-local limit: `references/handler.md`.

## 7. Tool features

Verified: typechecks with `tsc` 6.0.3, and `tools/list` / `tools/call` return these fields in both eras.

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const server = new McpServer({ name: "notes", version: "1.0.0" });
server.registerTool(
  "get_note",
  {
    title: "Get note",
    description: "Fetch one note by id",
    inputSchema: z.object({ id: z.string().describe("Note id from list_notes") }),
    outputSchema: z.object({ id: z.string(), text: z.string() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    icons: [{ src: "https://mcp.example.com/note.svg", mimeType: "image/svg+xml", sizes: ["any"] }],
  },
  async ({ id }) => {
    if (id === "missing") {
      return { content: [{ type: "text", text: `No note ${id}. Call list_notes for valid ids.` }], isError: true };
    }
    const note = { id, text: "hello" };
    return {
      structuredContent: note,
      content: [
        { type: "text", text: JSON.stringify(note) },
        { type: "resource_link", uri: `note://${id}`, name: `note-${id}`, mimeType: "text/plain" },
      ],
    };
  },
);
```

- With `outputSchema`, `structuredContent` MUST conform. Also return the same JSON as a text block, because older clients read only `content`. `structuredContent` may be any JSON value in `2026-07-28`; legacy revisions require an object, so keep it an object for dual-era servers.
- Business and validation failures return `isError: true` with text the model can act on. Reserve JSON-RPC errors for unknown tools and malformed requests (`-32602`).
- Spec annotation defaults are pessimistic (`readOnlyHint` false, `destructiveHint` true, `idempotentHint` false, `openWorldHint` true), so set all four on every tool. Annotations, the no-`inputSchema` callback signature and cross-call handles: `references/handler.md` sections 7 and 11.
- Tool names: 1-128 chars from `A-Z a-z 0-9 _ - .`, case-sensitive, unique per server. Keep `tools/list` order deterministic.
- A tool with no inputs: the spec recommends `{ "type": "object", "additionalProperties": false }`. Omitting `inputSchema` makes `McpServer` advertise `{"type":"object","properties":{}}`, which accepts any object. Pass `inputSchema: z.object({}).strict()` and check that `tools/list` shows `additionalProperties: false`.
- A `resource_link` need not appear in `resources/list`.
- `icons[].src` is an https URL or a `data:` URI. Clients are told to distrust other-domain icons and script in SVG, so serve icons from your own host.

`x-mcp-header` mirrors a primitive argument into an HTTP header so gateways can route without parsing the body. Verified with zod 4 `.meta()`:

```ts
server.registerTool(
  "run_query",
  {
    description: "Run a query in one region",
    inputSchema: z.object({ region: z.string().meta({ "x-mcp-header": "Region" }), query: z.string() }),
  },
  async ({ region }) => ({ content: [{ type: "text", text: `ran in ${region}` }] }),
);
```

A modern client must then send `Mcp-Param-Region: eu`; without it the handler answers 400 `-32020`. Only `string`, `integer` and `boolean` parameters qualify, never `number`. Never mark secrets or PII, because intermediaries see header values. Browser clients need `Mcp-Param-*` in the CORS allow list: `references/handler.md`.

## 8. Tasks

Tasks are an extension (`io.modelcontextprotocol/tasks`, spec in `github.com/modelcontextprotocol/ext-tasks`), not core. In the extension, `tasks/result` and `tasks/list` are gone, clients poll `tasks/get`, and `tasks/update` carries client input.
The agents handler does not implement the extension. `tasks/get` returns `-32601` in both eras (404 modern, 200 SSE legacy; verified). Do not advertise `tasks` capability or return `resultType: "task"`. For long work, return a job handle from one tool and expose a status tool.

## 9. Deprecations

Deprecated features still work until removed. No entry in the deprecation registry has been removed as of 2026-09-28. Registry: `https://modelcontextprotocol.io/specification/2026-07-28/deprecated`.

| Deprecated | Earliest removal | Build instead |
| --- | --- | --- |
| HTTP+SSE transport (2024-11-05, `/sse` + `serveSSE`) | Three months after SEP-2596 reaches Final | Streamable HTTP on one `/mcp` route |
| Roots | First revision on or after 2027-07-28 | Tool parameters or resource URIs |
| Sampling | same | Call the model provider's API from the Worker |
| Logging (`notifications/message` with per-request `io.modelcontextprotocol/logLevel`; `logging/setLevel` is already removed, section 2) | same | `console.log` to Workers Logs, or OpenTelemetry |
| Dynamic Client Registration (RFC 7591) | same | CIMD, keeping DCR only as a fallback for clients without CIMD |
| `includeContext: "thisServer" \| "allServers"` | Follows Sampling | Omit it or use `"none"` |

## 10. Authorisation model

Server-side obligations from `basic/authorization` (2026-07-28). Implementation with `@cloudflare/workers-oauth-provider` and the security checklist: `references/auth.md`.

- Applies to HTTP transports only. The MCP server is an OAuth 2.1 **resource server**. The authorization server (AS) may be the same Worker or a separate service.
- The server MUST publish RFC 9728 Protected Resource Metadata (PRM) with at least one `authorization_servers` entry. Clients find it from `WWW-Authenticate: Bearer resource_metadata="..."` on a 401 first, then the path-aware well-known URL (`/.well-known/oauth-protected-resource/mcp` for endpoint `/mcp`), then the root one.
- The AS MUST serve RFC 8414 or OIDC discovery metadata. It SHOULD return `iss` on authorization responses (RFC 9207), and clients MUST validate it.
- Client registration, in client preference order: pre-registered, then CIMD (the `client_id` is an https URL of a metadata document; the AS advertises `client_id_metadata_document_supported: true`), then DCR (deprecated), then asking the user.
- Clients MUST send `resource=<canonical server URL>` (RFC 8707) on both the authorization and token requests. Canonical means lowercase scheme and host, and no trailing slash unless significant. The server MUST reject tokens whose audience is not itself.
- **No token passthrough.** Never accept a token minted for another resource, and never forward the client's token upstream. Call upstream APIs with a separate token that the upstream AS issued to your server.
- Tokens arrive only in `Authorization: Bearer`, on every request, never in the query string.
- 401 for a missing, invalid or expired token. 403 for missing scope, with `WWW-Authenticate: Bearer error="insufficient_scope", scope="<all scopes needed>", resource_metadata="..."`. The client unions the challenged scopes with its current ones and re-authorises (step-up). Put every required scope in one challenge.
- `offline_access` goes in the AS's supported scopes, never in PRM `scopes_supported` or challenges (`references/auth.md` section 4).
- A server that proxies a third-party AS with one static client id is a **confused deputy** risk. It MUST get the user's consent per MCP client before redirecting upstream.

## 11. Sources

Re-verify against these. Spec pages also serve markdown with a `.md` suffix.

- Changelog: <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
- Versioning and the era matrix: <https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning>
- Streamable HTTP: <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>
- `server/discover`: <https://modelcontextprotocol.io/specification/2026-07-28/server/discover>
- MRTR: <https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr>
- Subscriptions: <https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions>
- Tools: <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
- Authorization: <https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization>
- Schema: <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/2026-07-28/schema/2026-07-28/schema.ts>
- Tasks extension: <https://github.com/modelcontextprotocol/ext-tasks>
- Security best practices: <https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices>
- Cloudflare handler API: <https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/index.md>
