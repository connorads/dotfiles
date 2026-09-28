# Stateless MCP server on Cloudflare Workers

Minimal remote MCP server: `createMcpHandler` from `agents/mcp/server` with an `@modelcontextprotocol/server` v2 factory. One `/mcp` route serves 2025-era (legacy) and 2026-07-28 (modern) clients. No Durable Object, no KV, no auth.

## Files

- `src/server.ts` - `createServer()` factory with three tools (`inputSchema`, `outputSchema`, `structuredContent`, `annotations`). `server_time` has no `inputSchema`, so its callback receives only `(context)`.
- `src/index.ts` - module-scope handler and the Worker's object default export.
- `scripts/probe.mjs` - connects in legacy, auto and pinned `2026-07-28` modes, lists tools and calls `add`.
- `test/mcp.test.mjs` - boots the Worker with wrangler's `createTestHarness` and runs the probe in all three modes.

## Use

1. Copy the directory and rename it: `cp -R assets/stateless-server my-mcp && cd my-mcp`.
2. Set `name` in `package.json` and `wrangler.jsonc`, and the server name in `src/server.ts`.
3. Set `compatibility_date` in `wrangler.jsonc` to today's date.
4. Install: `pnpm install`.
5. Typecheck: `pnpm typecheck`. It runs `wrangler types` first, which writes the git-ignored `worker-configuration.d.ts`. Rerun `pnpm types` after editing `wrangler.jsonc`.
6. Test: `pnpm test`.
7. Run locally: `pnpm dev --port 8787`, wait for the `Ready on <url>` line, then `pnpm probe <url>/mcp`. If the port is busy, Wrangler picks another one, and a probe of 8787 reaches a different process.
8. Deploy: `pnpm deploy`, then `pnpm probe https://<name>.<subdomain>.workers.dev/mcp`.
9. Connect Claude Code: `claude mcp add --transport http my-mcp https://<name>.<subdomain>.workers.dev/mcp`. It writes the user's Claude Code config, so ask first or hand the command over.

`wrangler types` suggests installing `@types/node` because `nodejs_compat` is on. Add it only when `src/` imports `node:*` modules.

## Before you ship

- On a custom domain, add `allowedHostnames: ["mcp.example.com"]` to the `createMcpHandler` options. The default Host check covers only localhost and `*.workers.dev`.
- Keep `createMcpHandler` at module scope. A handler built per request cannot deliver `notify.*` to listening clients.
- Keep the object default export. `agents` returns a callable handler, and a function default export is treated as a `WorkerEntrypoint` class.
- Keep the default `legacy: "stateless"` for public connectors. `legacy: "reject"` drops every 2025-era client.

## Versions

The MCP packages are exact because `agents` declares them as exact peers. Check the current set before upgrading `agents`:

```sh
pnpm view agents@latest peerDependencies --json | jq '{server: .["@modelcontextprotocol/server"], client: .["@modelcontextprotocol/client"], zod}'
```

The pins here match `agents@0.24.0` (verified 2026-09-28). `zod` stays at `^4.2.0` or later; 4.0 and 4.1 drop `.describe()` text from tool schemas.

No `pnpm-lock.yaml` ships with the template. A copied lockfile freezes the authoring-day `wrangler` and transitive versions, and the exact MCP pins already fix the versions that must match. Commit the lockfile your first `pnpm install` creates.

## References

- Handler API: <https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/index.md>
- Test harness: <https://developers.cloudflare.com/workers/testing/test-harness/get-started/index.md>
- Upstream example: <https://github.com/cloudflare/agents/tree/main/examples/mcp-worker>
