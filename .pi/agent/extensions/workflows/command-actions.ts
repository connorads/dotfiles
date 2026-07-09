import type { RunId, WorkflowInput, WorkflowRunSnapshot } from "./domain.ts";
import {
  parseCommandRunId,
  parseRunCommand,
  type WorkflowLaunch,
  type WorkflowLaunchOptions,
  type WorkflowManagerError,
} from "./manager.ts";
import {
  WORKFLOWS_HELP,
  defaultRunTarget,
  renderRun,
  renderRunAgents,
  renderRunDetails,
  renderRuns,
} from "./render.ts";
import type { Result } from "./result.ts";
import type { WorkflowStore } from "./store.ts";
import type { WorkflowToolPolicy } from "./tool-policy.ts";

type RunAction = "stop" | "resume";

const MENU_ACTIONS = ["Show details", "Show agents", "Show logs", "Stop", "Resume"] as const;

export type WorkflowNotifyLevel = "info" | "warning";

/** Minimal UI surface needed by workflow commands and menus. */
export interface WorkflowCommandUi {
  notify(message: string, level: WorkflowNotifyLevel): void;
  confirm(title: string, message: string): Promise<boolean>;
  select(title: string, options: readonly string[]): Promise<string | undefined>;
}

/** Narrow manager port used by the workflow command shell. */
export interface WorkflowCommandManager {
  launch(input: WorkflowInput, options: WorkflowLaunchOptions): Promise<Result<WorkflowLaunch, WorkflowManagerError>>;
  resume(runId: RunId, options: WorkflowLaunchOptions): Promise<Result<WorkflowLaunch, WorkflowManagerError>>;
  stop(runId: RunId, store: WorkflowStore): Promise<Result<WorkflowRunSnapshot, WorkflowManagerError>>;
  isActive(runId: RunId): boolean;
}

/** Runtime dependencies for `/workflows` command actions. */
export interface WorkflowCommandDeps {
  readonly manager: WorkflowCommandManager;
  readonly store: WorkflowStore;
  readonly cwd: string;
  readonly hasUI: boolean;
  readonly ui: WorkflowCommandUi;
  readonly agentRunner: WorkflowLaunchOptions["agentRunner"];
  readonly toolPolicy: () => WorkflowToolPolicy;
  readonly deliver?: (snapshot: WorkflowRunSnapshot) => void;
  readonly refreshWidget: () => Promise<void>;
  readonly startWorkflow?: (args: string) => Promise<void>;
  readonly now?: () => number;
}

/** Handle a `/workflows ...` command invocation. */
export async function handleWorkflowsCommand(args: string, deps: WorkflowCommandDeps): Promise<void> {
  const trimmed = args.trim();
  const firstSpace = trimmed.search(/\s/u);
  const command = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)) || "list";
  const tail = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();
  const rest = tail.split(/\s+/u).filter(Boolean);

  switch (command) {
    case "help":
      deps.ui.notify(WORKFLOWS_HELP, "info");
      return;
    case "list":
      deps.ui.notify(renderRuns(await deps.store.listRuns(), currentTime(deps)), "info");
      await deps.refreshWidget();
      return;
    case "status":
      await showRunStatus(deps, rest[0]);
      await deps.refreshWidget();
      return;
    case "show":
      await showRunDetailsAction(deps, rest[0]);
      await deps.refreshWidget();
      return;
    case "stop": {
      const target = await resolveRunTarget(deps.store, rest[0]);
      if (!target.ok) return deps.ui.notify(target.message, "warning");
      await handleRunAction("stop", target.runId, deps);
      await deps.refreshWidget();
      return;
    }
    case "resume": {
      const target = await resolveRunTarget(deps.store, rest[0]);
      if (!target.ok) return deps.ui.notify(target.message, "warning");
      await handleRunAction("resume", target.runId, deps);
      await deps.refreshWidget();
      return;
    }
    case "run": {
      const parsed = parseRunCommand(tail);
      if (!parsed.ok) return deps.ui.notify(parsed.error.message, "warning");
      const launch = await deps.manager.launch(parsed.value, launchOptions(deps));
      deps.ui.notify(launch.ok ? launch.value.summary : launch.error.message, launch.ok ? "info" : "warning");
      await deps.refreshWidget();
      return;
    }
    case "start":
      if (deps.startWorkflow === undefined) {
        deps.ui.notify("/workflows start is unavailable in this context.", "warning");
        return;
      }
      await deps.startWorkflow(tail);
      return;
    case "menu":
      await showWorkflowMenu(deps);
      await deps.refreshWidget();
      return;
    default:
      deps.ui.notify(`Unknown /workflows command: ${command}\n\n${WORKFLOWS_HELP}`, "warning");
  }
}

async function showWorkflowMenu(deps: WorkflowCommandDeps): Promise<void> {
  const runs = (await deps.store.listRuns()).slice(0, 20);
  if (runs.length === 0) {
    deps.ui.notify("No project workflow runs.", "info");
    return;
  }
  const selectedRun = await deps.ui.select(
    "Workflow runs",
    runs.map((run) => `${run.runId} ${run.status} ${run.workflowName}`),
  );
  if (!selectedRun) return;
  const runIdText = selectedRun.split(/\s/u)[0];
  const parsedRunId = parseCommandRunId(runIdText);
  if (!parsedRunId.ok) return deps.ui.notify(parsedRunId.error.message, "warning");
  const run = await deps.store.readRun(parsedRunId.value);
  if (!run.ok) return deps.ui.notify(friendlyRunError(parsedRunId.value, run.error.message), "warning");

  const action = await deps.ui.select(`${run.value.runId} ${run.value.workflowName}`, MENU_ACTIONS);
  if (!action) return;
  switch (action) {
    case "Show details":
      deps.ui.notify(renderRunDetails(run.value, deps.store.runDir(run.value.runId), currentTime(deps)), "info");
      return;
    case "Show agents":
      deps.ui.notify(renderRunAgents(run.value, currentTime(deps)), "info");
      return;
    case "Show logs":
      deps.ui.notify(run.value.logs.length > 0 ? run.value.logs.slice(-40).join("\n") : "No workflow logs.", "info");
      return;
    case "Stop":
      await handleRunAction("stop", run.value.runId, deps);
      return;
    case "Resume":
      await handleRunAction("resume", run.value.runId, deps);
      return;
    default:
      deps.ui.notify(`Unknown workflow menu action: ${action}`, "warning");
  }
}

async function handleRunAction(action: RunAction, runId: RunId, deps: WorkflowCommandDeps): Promise<void> {
  switch (action) {
    case "stop": {
      const stopped = await deps.manager.stop(runId, deps.store);
      deps.ui.notify(
        stopped.ok ? `Stopped workflow ${runId}.` : friendlyRunError(runId, stopped.error.message),
        stopped.ok ? "info" : "warning",
      );
      return;
    }
    case "resume": {
      const existing = await deps.store.readRun(runId);
      if (existing.ok && existing.value.status === "completed" && deps.hasUI) {
        const confirmed = await deps.ui.confirm(
          "Resume completed workflow?",
          `${runId} already completed. Resuming wipes its stored result and re-runs it (completed agents replay from the journal).`,
        );
        if (!confirmed) {
          deps.ui.notify("Resume cancelled.", "info");
          return;
        }
      }
      const resumed = await deps.manager.resume(runId, launchOptions(deps));
      deps.ui.notify(
        resumed.ok ? resumed.value.summary : friendlyRunError(runId, resumed.error.message),
        resumed.ok ? "info" : "warning",
      );
      return;
    }
  }
}

async function resolveRunTarget(
  store: WorkflowStore,
  arg: string | undefined,
): Promise<{ readonly ok: true; readonly runId: RunId } | { readonly ok: false; readonly message: string }> {
  if (arg) {
    const parsed = parseCommandRunId(arg);
    return parsed.ok ? { ok: true, runId: parsed.value } : { ok: false, message: parsed.error.message };
  }
  const target = defaultRunTarget(await store.listRuns());
  if (!target) return { ok: false, message: `No workflow runs in this project.\n\n${WORKFLOWS_HELP}` };
  return { ok: true, runId: target.runId };
}

function launchOptions(deps: WorkflowCommandDeps): WorkflowLaunchOptions {
  return {
    cwd: deps.cwd,
    store: deps.store,
    agentRunner: deps.agentRunner,
    toolPolicy: deps.toolPolicy(),
    deliver: deps.deliver,
    now: deps.now,
  };
}

async function showRunStatus(deps: WorkflowCommandDeps, arg: string | undefined): Promise<void> {
  const target = await resolveRunTarget(deps.store, arg);
  if (!target.ok) return deps.ui.notify(target.message, "warning");
  const run = await deps.store.readRun(target.runId);
  deps.ui.notify(
    run.ok
      ? renderRun(run.value, deps.manager.isActive(target.runId), currentTime(deps))
      : friendlyRunError(target.runId, run.error.message),
    run.ok ? "info" : "warning",
  );
}

async function showRunDetailsAction(deps: WorkflowCommandDeps, arg: string | undefined): Promise<void> {
  const target = await resolveRunTarget(deps.store, arg);
  if (!target.ok) return deps.ui.notify(target.message, "warning");
  const run = await deps.store.readRun(target.runId);
  deps.ui.notify(
    run.ok
      ? renderRunDetails(run.value, deps.store.runDir(target.runId), currentTime(deps))
      : friendlyRunError(target.runId, run.error.message),
    run.ok ? "info" : "warning",
  );
}

function friendlyRunError(runId: RunId, message: string): string {
  if (/ENOENT|no such file/iu.test(message)) return `Workflow run not found: ${runId}`;
  return message;
}

function currentTime(deps: WorkflowCommandDeps): number {
  return deps.now?.() ?? Date.now();
}
