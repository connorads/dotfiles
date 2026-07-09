import assert from "node:assert/strict";
import test from "node:test";

import { deriveWorkflowToolPolicy, toolsForSubagent } from "./tool-policy.ts";

test("deriveWorkflowToolPolicy inherits active tools except workflow", () => {
  const policy = deriveWorkflowToolPolicy(["read", "workflow", "web_search", "read", " bash ", ""]);

  assert.deepEqual(policy.toolAllowlist, ["read", "web_search", "bash"]);
  assert.deepEqual(policy.excludedTools, ["workflow"]);
});

test("toolsForSubagent adds structured_output only for schema agents", () => {
  const policy = deriveWorkflowToolPolicy(["read", "web_search"]);

  assert.deepEqual(toolsForSubagent(policy, false), ["read", "web_search"]);
  assert.deepEqual(toolsForSubagent(policy, true), ["read", "web_search", "structured_output"]);
});
