import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conciseReason, formatAccountLabel, hostFor, mergeInventories,
  parseSearchInventory, parseSkillsInventory, searchProbeArgs, skillsProbeArgs, webUrlFor,
} from "./health.ts";

test("formats Executor account strings into clean human labels", () => {
  assert.equal(formatAccountLabel("service: acc_788a84e2-ce2f-43ea-942b-f7c71c41c6a6 (Connor (Read only))"), "Connor (Read only)");
  assert.equal(formatAccountLabel("oauth: acc_1 (Work), oauth: acc_2 (Personal)"), "Work, Personal");
  assert.equal(formatAccountLabel("service: acc_abc123"), "service: acc_abc123");
  assert.equal(formatAccountLabel("   "), null);
  assert.equal(formatAccountLabel(undefined), null);
});

test("parses search structuredContent with namespaces, accounts, unavailableApps and toolCount", () => {
  const parsed = parseSearchInventory({
    content: [],
    structuredContent: {
      items: [{ path: 'tools["cloudflare-mcp"].zones_list' }],
      namespaces: [
        { path: 'tools["cloudflare-mcp"]', app: "Cloudflare MCP", accounts: "service: acc_123 (Connor (Read only))" },
        { path: "tools.notion", app: "Notion", accounts: "oauth: acc_456 (Workspace)" },
      ],
      remaining: 3771,
      unavailableApps: [{ app: "Notion", reason: "Token expired" }, "Linear"],
    },
  });
  assert.deepEqual(parsed, {
    apps: [
      { app: "Cloudflare MCP", account: "Connor (Read only)", ok: true, reason: null },
      { app: "Notion", account: "Workspace", ok: false, reason: "Token expired" },
      { app: "Linear", account: null, ok: false, reason: "Needs attention in Executor" },
    ],
    toolCount: 3772,
    unavailableCount: 2,
  });
});

test("falls back to JSON text content when structuredContent is absent", () => {
  const parsed = parseSearchInventory({
    content: [{ type: "text", text: JSON.stringify({ items: [], namespaces: [{ path: "tools.github", app: "GitHub" }], remaining: 12, unavailableApps: [] }) }],
  });
  assert.deepEqual(parsed, {
    apps: [{ app: "GitHub", account: null, ok: true, reason: null }],
    toolCount: 12,
    unavailableCount: 0,
  });
});

test("chooses safe search probe arguments from tool schema", () => {
  assert.deepEqual(searchProbeArgs([{ name: "search", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } } }]), { limit: 1 });
  assert.deepEqual(searchProbeArgs([{ name: "search", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } } }]), { query: "" });
  assert.equal(searchProbeArgs([{ name: "search", inputSchema: { type: "object", required: ["unknownField"], properties: {} } }]), null);
  assert.equal(searchProbeArgs([{ name: "execute", inputSchema: { type: "object", properties: {} } }]), null);
});

test("derives host and web URL for hosted and self-hosted Executor endpoints", () => {
  assert.equal(hostFor("https://mcp.executor.sh/mcp?connection=c_1"), "mcp.executor.sh");
  assert.equal(webUrlFor("https://mcp.executor.sh/mcp?connection=c_1"), "https://app.executor.sh");
  assert.equal(hostFor("https://rex.connoradams.co.uk/mcp?connection=c_2"), "rex.connoradams.co.uk");
  assert.equal(webUrlFor("https://rex.connoradams.co.uk/mcp?connection=c_2"), "https://rex.connoradams.co.uk");
});

test("parses skills({}) apps, prefers display name over opaque app_ UUIDs, and merges with search({})", () => {
  const skillsInv = parseSkillsInventory({
    content: [],
    structuredContent: {
      skills: [
        { name: "tools", app: { id: "app_11111111-1111-1111-1111-111111111111", name: "FreeAgent", slug: "freeagent" } },
        { name: "tools-gmail", app: { id: "app_22222222-2222-2222-2222-222222222222", name: "Google", slug: "google" } },
        { name: "tools-calendar", app: { id: "app_22222222-2222-2222-2222-222222222222", name: "Google", slug: "google" } },
      ],
      unavailableApps: [
        {
          app: "app_f88e8ec7-b610-4f2c-91dd-e6c1b4bfd0ff",
          name: "Executor",
          reason: "AppEvaluationFailed (HTTP 502): Could not reach rex.connoradams.co.uk to load skills. Recovery: Try again. Reference: abc.",
        },
      ],
    },
  });
  const searchInv = parseSearchInventory({
    content: [],
    structuredContent: {
      items: [{ path: 'tools["cloudflare-mcp"].zones_list' }],
      namespaces: [{ path: 'tools["cloudflare-mcp"]', app: "Cloudflare MCP", accounts: "service: acc_1 (Connor (Read only))" }],
      remaining: 3771,
      unavailableApps: [],
    },
  });
  const merged = mergeInventories(skillsInv, searchInv);
  assert.deepEqual(merged, {
    apps: [
      { app: "Executor", account: null, ok: false, reason: "HTTP 502: Could not reach rex.connoradams.co.uk to load skills." },
      { app: "Cloudflare MCP", account: "Connor (Read only)", ok: true, reason: null },
      { app: "FreeAgent", account: null, ok: true, reason: null },
      { app: "Google", account: null, ok: true, reason: null },
    ],
    toolCount: 3772,
    unavailableCount: 1,
  });
  assert.equal(conciseReason("AppEvaluationFailed (HTTP 502): Bad gateway. Recovery: retry"), "HTTP 502: Bad gateway.");
  assert.deepEqual(skillsProbeArgs([{ name: "skills", inputSchema: { type: "object", properties: { app: { type: "string" } } } }]), {});
});
