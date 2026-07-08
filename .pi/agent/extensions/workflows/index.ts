import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import { type RunId, type WorkflowRunSnapshot } from "./domain.ts";
import { WorkflowManager, parseCommandRunId, parseRunCommand } from "./manager.ts";
import { PiAgentRunner } from "./pi-agent-runner.ts";
import {
  WORKFLOWS_HELP,
  defaultRunTarget,
  renderCompletionMessage,
  renderRun,
  renderRunDetails,
  renderRuns,
  renderWidget,
} from "./render.ts";
import { errorMessage } from "./prelude.ts";
import {
  createStarterGate,
  routeStarterToolCall,
  routeStarterTurnEnd,
  type StarterGate,
} from "./starter-gate.ts";
import { createWorkflowStart, WORKFLOW_TOOL_NAME } from "./starter.ts";
import { createWorkflowStore, type WorkflowStore } from "./store.ts";

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

  /** Resolve a command's run target: explicit id, else single active/most recent run. */
  const resolveRunTarget = async (
    store: WorkflowStore,
    arg: string | undefined,
  ): Promise<{ ok: true; runId: RunId } | { ok: false; message: string }> => {
    if (arg) {
      const parsed = parseCommandRunId(arg);
      return parsed.ok ? { ok: true, runId: parsed.value } : { ok: false, message: parsed.error.message };
    }
    const target = defaultRunTarget(await store.listRuns());
    if (!target) return { ok: false, message: `No workflow runs in this project.\n\n${WORKFLOWS_HELP}` };
    return { ok: true, runId: target.runId };
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
    void pi.setActiveTools([...active]);
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
      const trimmed = args.trim();
      const firstSpace = trimmed.search(/\s/u);
      const command = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)) || "list";
      const tail = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();
      const rest = tail.split(/\s+/u).filter(Boolean);

      switch (command) {
        case "help": {
          ctx.ui.notify(WORKFLOWS_HELP, "info");
          return;
        }
        case "list": {
          ctx.ui.notify(renderRuns(await store.listRuns(), Date.now()), "info");
          await refreshWidget(ctx);
          return;
        }
        case "status": {
          const target = await resolveRunTarget(store, rest[0]);
          if (!target.ok) return ctx.ui.notify(target.message, "warning");
          const run = await store.readRun(target.runId);
          ctx.ui.notify(
            run.ok
              ? renderRun(run.value, manager.isActive(target.runId), Date.now())
              : friendlyRunError(target.runId, run.error.message),
            run.ok ? "info" : "warning",
          );
          await refreshWidget(ctx);
          return;
        }
        case "show": {
          const target = await resolveRunTarget(store, rest[0]);
          if (!target.ok) return ctx.ui.notify(target.message, "warning");
          const run = await store.readRun(target.runId);
          ctx.ui.notify(
            run.ok
              ? renderRunDetails(run.value, store.runDir(target.runId), Date.now())
              : friendlyRunError(target.runId, run.error.message),
            run.ok ? "info" : "warning",
          );
          await refreshWidget(ctx);
          return;
        }
        case "stop": {
          const target = await resolveRunTarget(store, rest[0]);
          if (!target.ok) return ctx.ui.notify(target.message, "warning");
          const stopped = await manager.stop(target.runId, store);
          ctx.ui.notify(
            stopped.ok ? `Stopped workflow ${target.runId}.` : friendlyRunError(target.runId, stopped.error.message),
            stopped.ok ? "info" : "warning",
          );
          await refreshWidget(ctx);
          return;
        }
        case "resume": {
          const target = await resolveRunTarget(store, rest[0]);
          if (!target.ok) return ctx.ui.notify(target.message, "warning");
          // Resuming a completed run wipes its stored result; make the human
          // path deliberate. Headless sessions proceed without a dialog.
          const existing = await store.readRun(target.runId);
          if (existing.ok && existing.value.status === "completed" && ctx.hasUI) {
            const confirmed = await ctx.ui.confirm(
              "Resume completed workflow?",
              `${target.runId} already completed. Resuming wipes its stored result and re-runs it (completed agents replay from the journal).`,
            );
            if (!confirmed) return ctx.ui.notify("Resume cancelled.", "info");
          }
          const resumed = await manager.resume(target.runId, {
            cwd: ctx.cwd,
            store,
            agentRunner: runnerFor(ctx),
            deliver,
          });
          ctx.ui.notify(
            resumed.ok ? resumed.value.summary : friendlyRunError(target.runId, resumed.error.message),
            resumed.ok ? "info" : "warning",
          );
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
          await startWorkflow(tail, ctx);
          return;
        }
        default:
          ctx.ui.notify(`Unknown /workflows command: ${command}\n\n${WORKFLOWS_HELP}`, "warning");
      }
    },
  });

  pi.registerCommand("workflow", {
    description: "Ask Pi to draft and launch an inline dynamic workflow",
    handler: async (args, ctx) => {
      await startWorkflow(args, ctx);
    },
  });
}

/** Map a raw store read failure to a friendly not-found message. */
function friendlyRunError(runId: RunId, message: string): string {
  if (/ENOENT|no such file/iu.test(message)) return `Workflow run not found: ${runId}`;
  return message;
}

function asSchema(value: unknown): TSchema {
  return value as TSchema;
}
