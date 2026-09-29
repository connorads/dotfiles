# Testing and deploying a Cloudflare MCP server

Scope: prove a stateless `createMcpHandler` server works, then ship it.
Handler options live in `references/handler.md`, OAuth in `references/auth.md`.

Versions below were verified 2026-09-28 with `agents` 0.24.0, `@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.0.0, `wrangler` 4.137.0, `vitest` 4.1.11 and `@cloudflare/vitest-plugin` 1.2.4.
Pin the MCP packages per SKILL.md section 1. Re-check the Vitest peer with `pnpm view @cloudflare/vitest-plugin@latest peerDependencies`.

## Pick the check

| Layer | Tool | Proves |
| --- | --- | --- |
| Protocol, both eras (default) | `@modelcontextprotocol/client` 2.x against `wrangler dev` or the test harness | Real clients of each era can list and call tools |
| Integration in CI | `createTestHarness` from `wrangler` + the same client | Same, against the production build, no manual server |
| Unit | `@cloudflare/vitest-plugin` | Worker code in workerd: routing, Origin/Host policy, bindings |
| Manual, interactive | Claude Code, MCP Inspector | Tool UX and OAuth in a real host |
| Hosted clients | Claude.ai, ChatGPT | Connector requirements; needs a public HTTPS URL |

A browser GET on `/mcp` is not a test. The stateless handler answers GET with `405`.
A bare `curl` `tools/list` POST only exercises the legacy path.

## Default check: client probe in both eras

`assets/stateless-server/` ships two pieces. Copy them rather than writing a curl script:

- `scripts/probe.mjs` connects once per negotiation mode, lists tools and calls `add` with `{ a: 2, b: 3 }`. Run it with `pnpm probe <url-ending-in-/mcp>` against `wrangler dev` or a deployed URL. For a server without `add`, edit the `callTool` line in `probe()`.
- `test/mcp.test.mjs` is the template's integration test. It boots the Worker with `createTestHarness` and runs `probe()` in each mode under `node --test` (`pnpm test`).

Run all three modes. Each hits a different server path:

| Client option | Era the server sees |
| --- | --- |
| `new Client(info)` or `versionNegotiation: { mode: "legacy" }` | legacy (`initialize` handshake). The 2.x client defaults to this |
| `versionNegotiation: { mode: "auto" }` | modern if the server offers 2026-07-28 |
| `versionNegotiation: { mode: { pin: "2026-07-28" } }` | modern, exact revision |

Assert `client.getProtocolEra()` as well as the tool result. A server that only answers legacy still passes a legacy-only probe.
The three-mode probe is the automated proxy for Claude Code compatibility. Run it before any manual client check.

Against `wrangler dev`:

1. Start it with an explicit port: `pnpm dev --port 8787`.
2. Wait for the `Ready on http://127.0.0.1:<port>` line and probe that exact URL plus `/mcp`.
3. If that port is busy, Wrangler silently picks another (observed: 8788). A probe of the old port then reaches a different process. A `401` from an authless server means you hit another server.

When the probed tool writes, do not spray test data into production:

- Against a deployed URL, call a read-only tool, or tag probe data (for example a `probe-<timestamp>` title) and tell the user what was written.
- A write followed by a read in a separate request proves real storage, because each request builds a fresh server.

## Integration tests: `createTestHarness`

`createTestHarness` runs the Worker's production build in any Node test runner. `listen()` returns a real URL, so the MCP client connects over HTTP.
In a template project, `test/mcp.test.mjs` is this test. Use the Vitest form below only in a project that already runs Vitest, in place of the template test rather than beside it. It calls the SKILL.md section 2 `hello` tool. Verified with wrangler 4.137.0:

```ts
// test/integration/mcp.test.ts - runs under plain Vitest (Node), not the Workers plugin
import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from "@modelcontextprotocol/client";
import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, expect, test } from "vitest";

const server = createTestHarness({ workers: [{ configPath: "./wrangler.jsonc" }] });
let mcpUrl: URL;

beforeAll(async () => {
  const { url } = await server.listen();
  mcpUrl = new URL("/mcp", url);
});
afterAll(() => server.close());

const modes: [VersionNegotiationMode, "legacy" | "modern"][] = [
  ["legacy", "legacy"],
  ["auto", "modern"],
  [{ pin: "2026-07-28" }, "modern"],
];

test.each(modes)("hello in mode %j", async (mode, era) => {
  const client = new Client({ name: "test", version: "0.0.0" }, { versionNegotiation: { mode } });
  await client.connect(new StreamableHTTPClientTransport(mcpUrl));
  try {
    expect(client.getProtocolEra()).toBe(era);
    const result = await client.callTool({ name: "hello", arguments: { name: "Ada" } });
    expect(result.content).toEqual([{ type: "text", text: "Hello, Ada!" }]);
  } finally {
    await client.close();
  }
});
```

- Keep harness tests in their own Vitest config or project, without `cloudflareTest()`. They run in Node and start workerd themselves.
- Raise `hookTimeout` (60 s is enough). The first `listen()` builds the Worker.
- Bindings start empty on every `listen()` and never touch `.wrangler/state` (observed with KV: a second harness saw neither the first one's writes nor `wrangler dev` data). Seed data inside the test.
- Per-worker `vars` and `secrets` override config for tests. `server.getLogs()` returns captured runtime logs.
- With the Cloudflare Vite plugin, run `vite build` first and point `configPath` at the generated `./dist/<worker>/wrangler.json`, not the source `wrangler.jsonc`. The harness reads build output.
- Docs: <https://developers.cloudflare.com/workers/testing/test-harness/get-started/index.md>

## Unit tests: `@cloudflare/vitest-plugin`

Use `@cloudflare/vitest-plugin` with `cloudflareTest()`. `@cloudflare/vitest-pool-workers`, `defineWorkersConfig` and `poolOptions.workers` are the superseded API.
Migrate existing projects with `pnpm dlx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`.

Install with an explicit Vitest range. On 2026-09-28 Vitest `latest` was 5.x while the plugin peered on `^4.1.0`. Check with `pnpm view @cloudflare/vitest-plugin@latest peerDependencies`:

```sh
pnpm add -D vitest@^4.1.0 @cloudflare/vitest-plugin
```

```ts
// vitest.config.ts
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/unit/**/*.test.ts"] },
});
```

Add `"types": ["@cloudflare/vitest-plugin/types"]` to the test tsconfig and include the `wrangler types` output.

```ts
// test/unit/worker.test.ts
import { exports } from "cloudflare:workers";
import { expect, test } from "vitest";

const listTools = (headers: Record<string, string> = {}) =>
  exports.default.fetch("http://localhost/mcp", {
    method: "POST",
    headers: { Host: "localhost", "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

test("tools/list is served on /mcp", async () => {
  const response = await listTools();
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"hello"');
});

test("foreign Origin is refused", async () => {
  expect((await listTools({ Origin: "https://evil.example" })).status).toBe(403);
});
```

- Set `Host` on in-process requests. Without it the handler returns `403` `Missing Host header` (observed).
- `exports.default.fetch()` calls the default export. For a direct handler call use `createExecutionContext()` and `waitOnExecutionContext()` from `cloudflare:test`, with `import { env } from "cloudflare:workers"`.
- Mock outbound HTTP with `@msw/cloudflare`. `fetchMock` from `cloudflare:test` is the superseded API.
- The local rate-limit binding enforces its limit (observed: 5 of 105 requests got `429` at `limit: 100`). Tests that loop through a limited Worker need their own key or a higher limit.
- Docs: <https://developers.cloudflare.com/workers/testing/vitest-integration/index.md> and `.../migration-guides/migrate-to-vitest-plugin/index.md`.

## MCP Inspector (optional)

`pnpm dlx` of Inspector 2.8.0 fails under pnpm's trust policy: `High-risk trust downgrade for "pino@9.14.0" (possible package takeover)` (re-observed 2026-09-28).
Never disable the trust policy to get round it. Tell the user, and let them decide on any exception. Meanwhile use the client probe above. It needs only `@modelcontextprotocol/client` at the `agents` peer pin.

Inspector 2.x CLI flags (verified against the Inspector repo at `1e31c78`, 2.8.0). The command below runs only once the user has approved a trust-policy exception or installed Inspector another way:

```sh
pnpm dlx @modelcontextprotocol/inspector@2.8.0 --cli \
  --transport http --server-url http://localhost:8787/mcp \
  --protocol-era modern --method tools/list --format json
```

- `--protocol-era legacy|auto|modern` picks the era. Run it once per era.
- `--method initialize` is a connect-only probe. `--method tools/call --tool-name <n> --tool-arg k=v` calls a tool and exits non-zero when the call fails.
- Transport is inferred only from a URL ending in `/mcp` or `/sse`, and a trailing `/` breaks that. Pass `--transport http` explicitly.
- Pin an exact version in CI. Node >= 22.19.0. Use `--stored-auth-only` in CI so OAuth never waits for a browser.
- Docs: <https://github.com/modelcontextprotocol/inspector/blob/main/docs/cli-smoke-testing.md>, <https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md>

## Debug locally: Local Explorer API

When `wrangler dev` detects an AI agent, it prints a Local Explorer API at `http://127.0.0.1:<port>/cdn-cgi/local/explorer/api`. Query captured spans and logs with read-only SQL:

```sh
curl -s -X POST http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/observability/query \
  -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT service, name, outcome, duration_ms FROM spans WHERE parent_id IS NULL ORDER BY rowid DESC LIMIT 20"}'
```

- Tables are `spans` and `logs`. Read attributes with `json(attributes)`.
- Captured data persists in local state across `wrangler dev` sessions. POST `.../local/observability/clear` before a repro.
- `GET .../local/workers` lists local Workers and bindings. Fetch the OpenAPI schema at `.../explorer/api` only as a last resort. It is large.

Verified with wrangler 4.137.0. The route list is printed at startup, so read it there if these paths move.

## Manual testing in real clients

`claude mcp add` writes the user's Claude Code config: `~/.claude.json` by default (`local` scope), or the repo's `.mcp.json` with `-s project`. Ask before running it, or hand the command to the user.
Claude Code reaches a local server directly:

```sh
claude mcp add --transport http hello http://localhost:8787/mcp
```

Then run `/mcp` inside Claude Code to check status and complete OAuth. `-s user` makes the entry global.

Claude.ai custom connectors and ChatGPT developer-mode connectors connect from the vendor's cloud. `localhost` is unreachable from there, so deploy first and use the public HTTPS `/mcp` URL.
Their auth requirements (401 challenge, redirect URIs, CIMD and DCR) live in `references/auth.md`.

To compare tool designs, run fixed questions with known answers through Claude against the deployed URL, and read the transcripts (observed working, Claude Code 2026-09-29):

```sh
claude -p "<question>" --mcp-config mcp.json --strict-mcp-config --tools "" --allowedTools "mcp__<name>__*" \
  --setting-sources "" --no-session-persistence --output-format stream-json --verbose < /dev/null > out.jsonl
```

Count `tool_use` events per run and read cost and turns from the final `result` event. `< /dev/null` avoids a 3 s stdin wait. This catches what the probe cannot, such as a tool result too large for the model or a parameter the model never finds.

Cloudflare's own testing guide: <https://developers.cloudflare.com/agents/model-context-protocol/guides/test-remote-mcp-server/index.md>. Its commands use `npx`. Use `pnpm dlx`.

## Deploy

### Config

```jsonc
// wrangler.jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-mcp",
  "main": "src/index.ts",
  "compatibility_date": "YYYY-MM-DD", // the day you create the project
  "compatibility_flags": ["nodejs_compat"],
  "routes": [{ "pattern": "mcp.example.com", "custom_domain": true }],
  "secrets": { "required": ["UPSTREAM_API_KEY"] },
  "observability": {
    "logs": { "enabled": true, "head_sampling_rate": 1 },
    "traces": { "enabled": true, "head_sampling_rate": 0.1 }
  },
  "ratelimits": [
    { "name": "MCP_RATE_LIMITER", "namespace_id": "1001", "simple": { "limit": 100, "period": 60 } }
  ]
}
```

`wrangler deploy --dry-run` accepts this config and lists the rate-limit binding (wrangler 4.137.0).

- `compatibility_date`, `nodejs_compat` and `Env` generation follow SKILL.md section 2.
- Use `wrangler.jsonc`, not `wrangler.toml`. Cloudflare recommends JSON config for new projects and releases some features for it only.
- In CI, `pnpm exec wrangler types --check` fails when the generated types are stale.
- Minimal `observability: { "enabled": true }` turns on logs at sampling rate 1. Split `logs` and `traces` as above to sample traces lower. Docs: <https://developers.cloudflare.com/workers/observability/traces/index.md>

### Secrets

1. List every secret name in `secrets.required`. `wrangler types` then types each as `string`, and `wrangler dev` warns `Missing required secrets: ...` when one is unset (observed).
   Only the listed keys load from `.dev.vars` or `.env`. Wrangler drops any other key in those files.
2. Local values go in `.dev.vars` or `.env`. Keep both out of git.
3. Production values: `pnpm exec wrangler secret put UPSTREAM_API_KEY`. The command prompts for the value, so the secret never lands in shell history.
   `wrangler deploy` and `wrangler versions upload` fail while any required secret is unset on the Worker. On a first deploy, run `secret put` for each name before Ship step 3.
4. Test values: the harness `secrets` option, or `miniflare.bindings` in `cloudflareTest()`.

Docs: <https://developers.cloudflare.com/workers/configuration/secrets/index.md>

### Ship

1. Run the typecheck (`wrangler types && tsc --noEmit`, `pnpm typecheck` in the template). A server instance passed to the handler fails here and otherwise returns 500 on every request.
2. Run the unit and integration suites.
3. `pnpm exec wrangler deploy`.
4. Re-run the three-mode client probe against the deployed `https://.../mcp` URL. A probe within about 20 s of the deploy can still reach the previous version (observed), so retry before concluding a fix failed.

### Custom domain

A custom domain changes the URL clients use. Each of these steps is separate, and missing one fails differently:

1. Add the `routes` entry with `"custom_domain": true`. Adding `routes` makes Wrangler infer `workers_dev: false` on the next deploy, so the `*.workers.dev` URL stops answering. Set `"workers_dev": true` to keep both.
2. Set `allowedHostnames: ["mcp.example.com"]` on `createMcpHandler`. Without it the handler accepts any `Host` on a custom domain (observed: `Host: evil.example` got `200`). With it, a foreign Host gets `403` `Invalid Host`. The list replaces the defaults, so add `localhost` and `127.0.0.1` if `wrangler dev` uses the same options (`references/handler.md` section 3).
3. On a custom domain, browser Origins other than `localhost`, `127.0.0.1`, `[::1]` and the `corsOptions.origin` host (if set) get `403` `Invalid Origin` until `allowedOriginHostnames` lists them. That includes the custom domain itself (observed). Non-browser clients send no Origin and pass. Details: `references/handler.md`.
4. With OAuth, change `resourceMetadata.resource` to the exact new `https://mcp.example.com/mcp`. Claude rejects a protected-resource `resource` that differs from the URL the user typed. See `references/auth.md`.

Preview URLs have their own hostnames, so the same Host, Origin and `resource` rules apply to them. Docs: <https://developers.cloudflare.com/workers/configuration/routing/custom-domains/index.md>, <https://developers.cloudflare.com/workers/previews/index.md>

### Rate limiting

The binding shape is in the config above. `period` must be `10` or `60`. Counters are per Cloudflare location and synced asynchronously, so treat the limit as abuse protection, not a quota.
Limit before the MCP handler runs, keyed by caller:

```ts
const mcp = createMcpHandler(createServer);

export default {
  async fetch(request, env, ctx) {
    const caller = request.headers.get("CF-Connecting-IP") ?? "local";
    const { success } = await env.MCP_RATE_LIMITER.limit({ key: caller });
    if (!success) return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "60" } });
    return mcp(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
```

- Cloudflare's docs advise against IP keys: many users share one IP. The IP key suits only an authless server.
- Do not key the only limiter on the `Mcp-Name` header. It is caller-controlled, and the server checks it against the body only on 2026-07-28 requests. On a legacy request an attacker sets a new `Mcp-Name` each time and never hits the limit (observed: 130 of 130 spoofed calls got `200` at `limit: 100`). For per-tool limits, add a second binding keyed on `${caller}:${tool}` behind the caller limiter.
- Behind OAuth, key on the user ID instead of the IP. Put the limiter inside the `apiHandler` wrapper, after the provider has verified the token (`references/auth.md`).
- Docs: <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/index.md>

## Not verified at runtime

- Deploying to a real account, custom-domain provisioning and hosted-client (Claude.ai, ChatGPT) connections. Everything above ran locally under `wrangler dev`, the test harness or the Vitest plugin.
- An OAuth round trip through the probe or Inspector.
- Which MCP era Claude.ai and ChatGPT speak.
