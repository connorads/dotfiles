import assert from "node:assert/strict";
import test from "node:test";

import {
  createStarterGate,
  routeStarterToolCall,
  routeStarterTurnEnd,
  WORKFLOW_TOOL_NAME,
} from "./starter-gate.ts";

test("non-workflow tool call blocks and keeps the gate awaiting", () => {
  const gate = createStarterGate();
  const routed = routeStarterToolCall(gate, { toolCallId: "tc_1", toolName: "read" });

  assert.equal(routed.block, true);
  assert.match(routed.reason, /workflow/i);
  assert.equal(routed.gate._tag, "awaitingWorkflow");
});

test("first workflow call is allowed and marks the gate accepted", () => {
  const gate = createStarterGate();
  const routed = routeStarterToolCall(gate, { toolCallId: "tc_1", toolName: WORKFLOW_TOOL_NAME });

  assert.equal(routed.block, false);
  assert.equal(routed.gate._tag, "acceptedWorkflow");
  if (routed.gate._tag !== "acceptedWorkflow") return;
  assert.equal(routed.gate.toolCallId, "tc_1");
});

test("second tool call after acceptance blocks", () => {
  const first = routeStarterToolCall(createStarterGate(), {
    toolCallId: "tc_1",
    toolName: WORKFLOW_TOOL_NAME,
  });
  const second = routeStarterToolCall(first.gate, { toolCallId: "tc_2", toolName: WORKFLOW_TOOL_NAME });

  assert.equal(second.block, true);
  assert.match(second.reason, /already accepted/i);
  assert.equal(second.gate._tag, "acceptedWorkflow");
});

test("accepted gate restores on turn_end", () => {
  const accepted = routeStarterToolCall(createStarterGate(), {
    toolCallId: "tc_1",
    toolName: WORKFLOW_TOOL_NAME,
  });
  const routed = routeStarterTurnEnd(accepted.gate, { toolResults: [{ toolCallId: "tc_1" }] });

  assert.equal(routed.restore, true);
});

test("awaiting gate with blocked or invalid tool result stays active for retry", () => {
  const blocked = routeStarterToolCall(createStarterGate(), { toolCallId: "tc_1", toolName: "grep" });
  const routed = routeStarterTurnEnd(blocked.gate, { toolResults: [{ toolCallId: "tc_1", isError: true }] });

  assert.equal(routed.restore, false);
  if (routed.restore) return;
  assert.equal(routed.gate._tag, "awaitingWorkflow");
});

test("awaiting gate with no tool results restores", () => {
  const routed = routeStarterTurnEnd(createStarterGate(), { toolResults: [] });

  assert.equal(routed.restore, true);
});
