import { WORKFLOW_TOOL_NAME } from "./starter.ts";

export { WORKFLOW_TOOL_NAME };

/** One-turn lease state for `/workflow` and `/workflows start`. */
export type StarterGate =
  | { readonly _tag: "awaitingWorkflow" }
  | { readonly _tag: "acceptedWorkflow"; readonly toolCallId: string };

export interface StarterToolCall {
  readonly toolName: string;
  readonly toolCallId: string;
}

export interface StarterTurnEnd {
  readonly toolResults: readonly unknown[];
}

export type StarterToolCallRoute =
  | { readonly block: false; readonly gate: StarterGate }
  | { readonly block: true; readonly reason: string; readonly gate: StarterGate };

export type StarterTurnEndRoute =
  | { readonly restore: true }
  | { readonly restore: false; readonly gate: StarterGate };

export function createStarterGate(): StarterGate {
  return { _tag: "awaitingWorkflow" };
}

export function routeStarterToolCall(gate: StarterGate, event: StarterToolCall): StarterToolCallRoute {
  switch (gate._tag) {
    case "awaitingWorkflow":
      if (event.toolName === WORKFLOW_TOOL_NAME) {
        return { block: false, gate: { _tag: "acceptedWorkflow", toolCallId: event.toolCallId } };
      }
      return {
        block: true,
        reason:
          "Workflow starter is waiting for a `workflow` tool call. Do not use other tools before launching the workflow.",
        gate,
      };
    case "acceptedWorkflow":
      return {
        block: true,
        reason: "Workflow starter already accepted one workflow tool call. Do not call additional tools in this turn.",
        gate,
      };
  }
}

export function routeStarterTurnEnd(gate: StarterGate, event: StarterTurnEnd): StarterTurnEndRoute {
  switch (gate._tag) {
    case "acceptedWorkflow":
      return { restore: true };
    case "awaitingWorkflow":
      return event.toolResults.length === 0 ? { restore: true } : { restore: false, gate };
  }
}
