import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import { handleWorkflowsCommand } from "./command-actions.ts";
import { type WorkflowRunSnapshot } from "./domain.ts";
import { WorkflowManager } from "./manager.ts";
import { PiAgentRunner } from "./pi-agent-runner.ts";
import {
  renderCompletionMessage,
  renderWidget,
} from "./render.ts";
import { errorMessage } from "./prelude.ts";
import {
  createStarterGate,
  routeStarterToolCall,
  routeStarterTurnEnd,
  type StarterGate,
} from "./starter-gate.ts";
import { createWorkflowStart } from "./starter.ts";
import { createWorkflowStore, type WorkflowStore } from "./store.ts";
import { deriveWorkflowToolPolicy, WORKFLOW_TOOL_NAME, type WorkflowToolPolicy } from "./tool-policy.ts";

const WORKFLOW_CUSTOM_MESSAGE = "workflow_result";
const WIDGET_KEY = "workflows";
const WIDGET_REFRESH_MS = 5_000;
// Completion messages trigger a turn so the launching session reacts to the
// result without the user prodding it. Set PI_WORKFLOWS_COMPLETION_TURN=0 to
// deliver silently instead (read once at load).
const COMPLETION_TRIGGERS_TURN = process.env.PI_WORKFLOWS_COMPLETION_TURN !== "0";

const WORKFLOW_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    script: { type: "string", description: "Inline workflow JavaScript source." },
    name: { type: "string", description: "Named workflow from Pi workflow script directories." },
    description: { type: "string", description: "Optional ergonomic description; ignored by the runner." },
    title: { type: "string", description: "Optional ergonomic title; ignored by the runner." },
    args: { description: "JSON value exposed to the workflow as args." },
    scriptPath: {
      type: "string",
      description:
        "Path to a workflow script. Relative paths resolve from cwd. With resumeFromRunId, this file is treated as the edited script and replaces the run's pinned copy.",
    },
    resumeFromRunId: {
      type: "string",
      description:
        "Existing run id to resume; completed agent calls replay from the journal. Alone, resumes the run's pinned script. With script/scriptPath/name supplied, that source is the edited script: it is re-pinned and only calls after the first change re-run.",
    },
  },
} as const;

const manager = new WorkflowManager();

export default function extension(pi: ExtensionAPI) {
  let liveCtx: ExtensionContext | undefined;
  let widgetTimer: ReturnType<typeof setInterval> | undefined;
  let starterLease: { readonly previousTools: readonly string[]; gate: StarterGate } | undefined;

  const storeFor = (ctx: Pick<ExtensionContext, "cwd">): WorkflowStore => createWorkflowStore(ctx.cwd);
  const runnerFor = (ctx: ExtensionContext): PiAgentRunner => new PiAgentRunner(ctx.cwd, ctx.model, ctx.modelRegistry);
  const commandToolPolicy = (): WorkflowToolPolicy => deriveWorkflowToolPolicy(pi.getActiveTools());
  const toolCallPolicy = (): WorkflowToolPolicy => deriveWorkflowToolPolicy(starterLease?.previousTools ?? pi.getActiveTools());
  const restoreStarterLease = async (): Promise<void> => {
    const lease = starterLease;
    if (!lease) return;
    starterLease = undefined;
    await pi.setActiveTools([...lease.previousTools]);
  };
  const startWorkflow = async (args: string, ctx: ExtensionContext): Promise<void> => {
    if (starterLease) {
      ctx.ui.notify("Workflow starter already pending. Wait for the current starter turn to finish.", "warning");
      return;
    }

    const started = createWorkflowStart(args);
    if (!started.ok) {
      ctx.ui.notify(started.error.message, "warning");
      return;
    }

    starterLease = { previousTools: pi.getActiveTools(), gate: createStarterGate() };
    try {
      await pi.setActiveTools([WORKFLOW_TOOL_NAME]);
      pi.sendUserMessage(started.value.prompt, { deliverAs: "steer" });
      ctx.ui.notify(started.value.summary, "info");
    } catch (error) {
      await restoreStarterLease();
      ctx.ui.notify(`Workflow starter failed: ${errorMessage(error)}`, "warning");
    }
  };
  const stopWidgetTimer = (): void => {
    if (widgetTimer) clearInterval(widgetTimer);
    widgetTimer = undefined;
  };
  const refreshWidget = async (ctx: ExtensionContext): Promise<void> => {
    const lines = renderWidget(await storeFor(ctx).listRuns(), Date.now());
    ctx.ui.setWidget(WIDGET_KEY, lines.length === 0 ? undefined : lines, { placement: "belowEditor" });
    // Keep a ticker while the widget shows anything: live runs update their
    // relative times, and lingering terminal lines clear themselves.
    if (lines.length > 0 && !widgetTimer) {
      widgetTimer = setInterval(() => {
        if (liveCtx) void refreshWidget(liveCtx).catch(() => {});
        else stopWidgetTimer();
      }, WIDGET_REFRESH_MS);
    } else if (lines.length === 0) {
      stopWidgetTimer();
    }
  };
  const deliver = (snapshot: WorkflowRunSnapshot): void => {
    // Skip delivery once the session has ended: a post-shutdown send would
    // target a dead session and surface as an unhandled rejection.
    if (!liveCtx) return;
    const content = renderCompletionMessage(snapshot, createWorkflowStore(snapshot.cwd).runDir(snapshot.runId));
    const terminal = snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "stopped";
    pi.sendMessage(
      {
        customType: WORKFLOW_CUSTOM_MESSAGE,
        content,
        display: true,
        details: {
          runId: snapshot.runId,
          status: snapshot.status,
          workflowName: snapshot.workflowName,
        },
      },
      // Delivery only fires in the launching Pi process, so a completion turn
      // cannot double-fire across sessions.
      { triggerTurn: terminal && COMPLETION_TRIGGERS_TURN, deliverAs: "followUp" },
    );
    if (liveCtx) void refreshWidget(liveCtx);
  };

  const workflowTool: ToolDefinition = defineTool({
    name: "workflow",
    label: "Workflow",
    description:
      "Launch a Pi dynamic workflow in the background. Use this for multi-step or multi-agent work described by the documented workflow script format.",
    promptSnippet: "Launch a dynamic workflow in the background and monitor it with /workflows.",
    promptGuidelines: [
      "Use workflow for substantial decomposable work where a workflow script gives clearer orchestration than ad hoc tool calls.",
      "Provide exactly one of script, name, or scriptPath. Use args for JSON data passed into the workflow.",
      "When starting a dynamic workflow from a user objective, generate a Claude-compatible inline script and call this tool with the script field.",
    ],
    parameters: asSchema(WORKFLOW_INPUT_SCHEMA),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const launch = await manager.launch(params, {
        cwd: ctx.cwd,
        store: storeFor(ctx),
        agentRunner: runnerFor(ctx),
        toolPolicy: toolCallPolicy(),
        deliver,
      });
      await refreshWidget(ctx);
      if (!launch.ok) {
        return {
          content: [{ type: "text", text: `Workflow launch failed: ${launch.error.message}` }],
          details: { error: launch.error.message },
        };
      }
      return {
        content: [{ type: "text", text: launch.value.summary }],
        details: launch.value,
      };
    },
  });

  pi.registerTool(workflowTool);

  pi.on("session_start", (_event, ctx) => {
    liveCtx = ctx;
    void (async () => {
      const reconciled = await manager.reconcile(storeFor(ctx));
      if (reconciled.length > 0) {
        const lines = reconciled.map((run) => `  ${run.runId} - /workflows resume ${run.runId} to continue`);
        ctx.ui.notify(
          [`${reconciled.length} interrupted workflow run(s) from a previous Pi process:`, ...lines].join("\n"),
          "warning",
        );
      }
      await refreshWidget(ctx);
    })().catch(() => {});
  });

  pi.on("tool_call", (event) => {
    if (!starterLease) return undefined;
    const routed = routeStarterToolCall(starterLease.gate, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    });
    starterLease = { ...starterLease, gate: routed.gate };
    return routed.block ? { block: true, reason: routed.reason } : undefined;
  });

  pi.on("turn_end", async (event) => {
    if (!starterLease) return;
    const routed = routeStarterTurnEnd(starterLease.gate, { toolResults: event.toolResults });
    if (routed.restore) {
      await restoreStarterLease();
      return;
    }
    starterLease = { ...starterLease, gate: routed.gate };
  });

  pi.on("agent_end", async () => {
    await restoreStarterLease();
  });

  pi.on("session_shutdown", async () => {
    await restoreStarterLease();
    liveCtx = undefined;
    stopWidgetTimer();
  });

  pi.registerCommand("workflows", {
    description: "List, inspect, stop, resume, or launch Pi project workflows",
    handler: async (args, ctx) => {
      const store = storeFor(ctx);
      await handleWorkflowsCommand(args, {
        manager,
        store,
        cwd: ctx.cwd,
        hasUI: ctx.hasUI,
        ui: ctx.ui,
        agentRunner: runnerFor(ctx),
        toolPolicy: commandToolPolicy,
        deliver,
        refreshWidget: () => refreshWidget(ctx),
        startWorkflow: (tail) => startWorkflow(tail, ctx),
      });
    },
  });

  pi.registerCommand("workflow", {
    description: "Ask Pi to draft and launch an inline dynamic workflow",
    handler: async (args, ctx) => {
      await startWorkflow(args, ctx);
    },
  });
}

function asSchema(value: unknown): TSchema {
  // SAFETY: Pi tool parameters accept TypeBox-compatible JSON schema data, and
  // WORKFLOW_INPUT_SCHEMA is a literal schema object owned by this module.
  return value as TSchema;
}
