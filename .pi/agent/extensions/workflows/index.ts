import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import { parseRunId, type RunId, type WorkflowRunSnapshot } from "./domain.ts";
import { WorkflowManager, parseCommandRunId, parseRunCommand } from "./manager.ts";
import { PiAgentRunner } from "./pi-agent-runner.ts";
import { preview } from "./prelude.ts";
import { startWorkflowFromCommand, WORKFLOW_TOOL_NAME, type WorkflowStarterRuntime } from "./starter.ts";
import { createWorkflowStore, type WorkflowStore } from "./store.ts";

const WORKFLOW_CUSTOM_MESSAGE = "workflow_result";
const WIDGET_KEY = "workflows";

const WORKFLOW_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    script: { type: "string", description: "Inline workflow JavaScript source." },
    name: { type: "string", description: "Named workflow from Pi workflow script directories." },
    description: { type: "string", description: "Optional ergonomic description; ignored by the runner." },
    title: { type: "string", description: "Optional ergonomic title; ignored by the runner." },
    args: { description: "JSON value exposed to the workflow as args." },
    scriptPath: { type: "string", description: "Path to a workflow script. Relative paths resolve from cwd." },
    resumeFromRunId: { type: "string", description: "Existing run id to resume with replayed completed agent calls." },
  },
} as const;

const manager = new WorkflowManager();

export default function extension(pi: ExtensionAPI) {
  let liveCtx: ExtensionContext | undefined;

  const storeFor = (ctx: Pick<ExtensionContext, "cwd">): WorkflowStore => createWorkflowStore(ctx.cwd);
  const runnerFor = (ctx: ExtensionContext): PiAgentRunner => new PiAgentRunner(ctx.cwd, ctx.model);
  const starterRuntime = (): WorkflowStarterRuntime => ({
    activateTool(name) {
      const active = new Set(pi.getActiveTools());
      active.add(name);
      pi.setActiveTools([...active]);
    },
    sendFollowUp(message) {
      pi.sendUserMessage(message, { deliverAs: "followUp" });
    },
  });
  const startWorkflow = (args: string, ctx: ExtensionContext): void => {
    const started = startWorkflowFromCommand(args, starterRuntime());
    ctx.ui.notify(started.ok ? started.value.summary : started.error.message, started.ok ? "info" : "warning");
  };
  const refreshWidget = async (ctx: ExtensionContext): Promise<void> => {
    const lines = renderWidget(await storeFor(ctx).listRuns());
    ctx.ui.setWidget(WIDGET_KEY, lines.length === 0 ? undefined : lines, { placement: "belowEditor" });
  };
  const deliver = (snapshot: WorkflowRunSnapshot): void => {
    const content = renderCompletionMessage(snapshot);
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
      { triggerTurn: false },
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
    executionMode: "parallel",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const launch = await manager.launch(params, {
        cwd: ctx.cwd,
        store: storeFor(ctx),
        agentRunner: runnerFor(ctx),
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
    const active = new Set(pi.getActiveTools());
    active.add(WORKFLOW_TOOL_NAME);
    pi.setActiveTools([...active]);
    void refreshWidget(ctx);
  });

  pi.on("session_shutdown", () => {
    liveCtx = undefined;
  });

  pi.registerCommand("workflows", {
    description: "List, inspect, stop, resume, or launch Pi project workflows",
    handler: async (args, ctx) => {
      const store = storeFor(ctx);
      const [command = "list", ...rest] = args.trim().split(/\s+/u).filter(Boolean);
      const tail = rest.join(" ");

      switch (command) {
        case "list": {
          ctx.ui.notify(renderRuns(await store.listRuns()), "info");
          await refreshWidget(ctx);
          return;
        }
        case "status": {
          if (!rest[0]) {
            ctx.ui.notify(renderRuns(await store.listRuns()), "info");
            await refreshWidget(ctx);
            return;
          }
          const runId = parseCommandRunId(rest[0]);
          if (!runId.ok) return ctx.ui.notify(runId.error.message, "warning");
          const run = await store.readRun(runId.value);
          ctx.ui.notify(run.ok ? renderRun(run.value, manager.isActive(runId.value)) : run.error.message, run.ok ? "info" : "warning");
          await refreshWidget(ctx);
          return;
        }
        case "show": {
          const runId = parseCommandRunId(rest[0]);
          if (!runId.ok) return ctx.ui.notify(runId.error.message, "warning");
          const run = await store.readRun(runId.value);
          ctx.ui.notify(run.ok ? renderRunDetails(run.value) : run.error.message, run.ok ? "info" : "warning");
          await refreshWidget(ctx);
          return;
        }
        case "stop": {
          const runId = parseCommandRunId(rest[0]);
          if (!runId.ok) return ctx.ui.notify(runId.error.message, "warning");
          const stopped = await manager.stop(runId.value, store);
          ctx.ui.notify(stopped.ok ? `Stopped workflow ${runId.value}.` : stopped.error.message, stopped.ok ? "info" : "warning");
          await refreshWidget(ctx);
          return;
        }
        case "resume": {
          const runId = parseCommandRunId(rest[0]);
          if (!runId.ok) return ctx.ui.notify(runId.error.message, "warning");
          const resumed = await manager.resume(runId.value, {
            cwd: ctx.cwd,
            store,
            agentRunner: runnerFor(ctx),
            deliver,
          });
          ctx.ui.notify(resumed.ok ? resumed.value.summary : resumed.error.message, resumed.ok ? "info" : "warning");
          await refreshWidget(ctx);
          return;
        }
        case "run": {
          const parsed = parseRunCommand(tail);
          if (!parsed.ok) return ctx.ui.notify(parsed.error.message, "warning");
          const launch = await manager.launch(parsed.value, {
            cwd: ctx.cwd,
            store,
            agentRunner: runnerFor(ctx),
            deliver,
          });
          ctx.ui.notify(launch.ok ? launch.value.summary : launch.error.message, launch.ok ? "info" : "warning");
          await refreshWidget(ctx);
          return;
        }
        case "start": {
          startWorkflow(tail, ctx);
          return;
        }
        default:
          ctx.ui.notify("Usage: /workflows [list|status|show|stop|resume|run|start] ...", "warning");
      }
    },
  });

  pi.registerCommand("workflow", {
    description: "Ask Pi to draft and launch an inline dynamic workflow",
    handler: async (args, ctx) => {
      startWorkflow(args, ctx);
    },
  });
}

function renderWidget(runs: readonly WorkflowRunSnapshot[]): string[] {
  const interesting = runs.filter((run) => run.status === "running" || run.status === "queued").slice(0, 3);
  if (interesting.length === 0) return [];
  return ["Project workflows", ...interesting.map((run) => `${run.status} ${run.runId} ${run.workflowName}`)];
}

function renderRuns(runs: readonly WorkflowRunSnapshot[]): string {
  if (runs.length === 0) return "No project workflow runs.";
  const rows = runs.slice(0, 12).map((run) => `${run.runId}  ${run.status.padEnd(9)}  ${run.workflowName}`);
  return ["Project workflow runs", ...rows].join("\n");
}

function renderRun(run: WorkflowRunSnapshot, active: boolean): string {
  const live = active ? " active" : "";
  return `${run.runId} ${run.status}${live}: ${run.workflowName}\n${run.summary ?? ""}`;
}

function renderRunDetails(run: WorkflowRunSnapshot): string {
  const lines = [
    `${run.runId} ${run.status}: ${run.workflowName}`,
    `cwd: ${run.cwd}`,
    `agents: ${run.agentCalls}`,
    `budget: ${run.budgetTotal === null ? "uncapped" : `${run.budgetSpent}/${run.budgetTotal}`}`,
    run.summary ? `summary: ${run.summary}` : undefined,
    run.error ? `error: ${run.error}` : undefined,
    run.logs.length > 0 ? `logs:\n${run.logs.slice(-20).join("\n")}` : undefined,
    run.result !== undefined ? `result:\n${preview(JSON.stringify(run.result, null, 2), 2000)}` : undefined,
  ].filter((line): line is string => typeof line === "string");
  return lines.join("\n");
}

function renderCompletionMessage(run: WorkflowRunSnapshot): string {
  const status = run.status === "completed" ? "completed" : run.status;
  const body = run.summary ?? run.error ?? "";
  return [`Workflow ${status}: ${run.workflowName}`, `Run: ${run.runId}`, preview(body, 1200), `Details: /workflows show ${run.runId}`]
    .filter(Boolean)
    .join("\n");
}

function asSchema(value: unknown): TSchema {
  return value as TSchema;
}
