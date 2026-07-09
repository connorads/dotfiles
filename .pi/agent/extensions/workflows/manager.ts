import {
  createRunId,
  parseRunId,
  parseWorkflowInput,
  type JsonValue,
  type ResolvedWorkflowSource,
  type RunId,
  type WorkflowInput,
  type WorkflowRunSnapshot,
} from "./domain.ts";
import { parseWorkflowScript, type ParsedWorkflowScript } from "./parser.ts";
import { errorMessage, preview } from "./prelude.ts";
import { err, ok, type Result } from "./result.ts";
import { WorkflowRuntime, WorkflowRuntimeError, type AgentRunner } from "./runtime.ts";
import type { WorkflowStore } from "./store.ts";
import type { WorkflowToolPolicy } from "./tool-policy.ts";

/** Immediate result returned to the model after a background launch. */
export interface WorkflowLaunch {
  readonly status: "async_launched";
  readonly taskId: string;
  readonly taskType: "local_workflow";
  readonly runId: RunId;
  readonly workflowName: string;
  readonly scriptPath?: string;
  readonly summary: string;
}

export interface WorkflowLaunchOptions {
  readonly cwd: string;
  readonly store: WorkflowStore;
  readonly agentRunner: AgentRunner;
  readonly toolPolicy: WorkflowToolPolicy;
  readonly deliver?: (snapshot: WorkflowRunSnapshot) => void;
  readonly now?: () => number;
}

export class WorkflowManagerError extends Error {
  readonly _tag = "WorkflowManagerError";
}

/** Coordinates workflow launches, live cancellation, and durable snapshots. */
export class WorkflowManager {
  private readonly active = new Map<string, AbortController>();

  async launch(input: unknown, options: WorkflowLaunchOptions): Promise<Result<WorkflowLaunch, WorkflowManagerError>> {
    const parsedInput = parseWorkflowInput(input);
    if (!parsedInput.ok) return err(new WorkflowManagerError(parsedInput.error.message));

    // resumeFromRunId targets an existing run and errors on an unknown run id
    // rather than minting a fresh run over it. Bare, it resumes the run's
    // pinned script.js; with a source supplied, the source is the edited
    // script and replaces the pin (completed agents still replay by prefix).
    if (parsedInput.value.resumeFromRunId) {
      if (parsedInput.value.source === undefined) {
        return this.resume(parsedInput.value.resumeFromRunId, options);
      }
      const replacement = await options.store.resolveSource(parsedInput.value.source);
      if (!replacement.ok) return err(new WorkflowManagerError(replacement.error.message));
      return this.resume(parsedInput.value.resumeFromRunId, options, replacement.value);
    }
    if (parsedInput.value.source === undefined) {
      return err(new WorkflowManagerError("Must provide script, name, or scriptPath"));
    }

    const resolved = await options.store.resolveSource(parsedInput.value.source);
    if (!resolved.ok) return err(new WorkflowManagerError(resolved.error.message));

    const parsedScript = parseWorkflowScript(resolved.value.source);
    if (!parsedScript.ok) return err(new WorkflowManagerError(parsedScript.error.message));

    const runId = createRunId();
    const workflowName = parsedScript.value.meta.name;
    const now = options.now ?? Date.now;
    const generation = options.store.nextGeneration(runId);
    const toolPolicy = options.toolPolicy;

    const snapshot = makeInitialSnapshot({
      runId,
      projectKey: options.store.projectKey,
      cwd: options.cwd,
      workflowName,
      sourceKind: resolved.value.ref.kind,
      sourceHash: resolved.value.sourceHash,
      scriptPath: resolved.value.scriptPath,
      args: parsedInput.value.args,
      meta: parsedScript.value.meta.raw,
      toolPolicy,
      budgetTotal:
        typeof parsedScript.value.meta.budget === "number" && parsedScript.value.meta.budget > 0
          ? parsedScript.value.meta.budget
          : null,
      phases: parsedScript.value.meta.phases ?? [],
      now: now(),
    });
    await options.store.createRun(snapshot, resolved.value.source, generation);

    const controller = new AbortController();
    this.active.set(runId, controller);
    void this.execute(snapshot, parsedScript.value, {
      ...options,
      now,
      signal: controller.signal,
      generation,
    })
      .catch(() => {})
      .finally(() => {
        if (this.active.get(runId) === controller) this.active.delete(runId);
      });

    return ok({
      status: "async_launched",
      taskId: runId,
      taskType: "local_workflow",
      runId,
      workflowName,
      scriptPath: resolved.value.scriptPath,
      summary: `Workflow "${workflowName}" launched in the background. /workflows status ${runId} to inspect, /workflows stop ${runId} to cancel.`,
    });
  }

  async resume(
    runId: RunId,
    options: WorkflowLaunchOptions,
    replacement?: ResolvedWorkflowSource,
  ): Promise<Result<WorkflowLaunch, WorkflowManagerError>> {
    const existing = await options.store.readRun(runId);
    if (!existing.ok) return err(new WorkflowManagerError(existing.error.message));
    let scriptSource: string;
    if (replacement) {
      scriptSource = replacement.source;
    } else {
      const script = await options.store.readRunScript(runId);
      if (!script.ok) return err(new WorkflowManagerError(script.error.message));
      scriptSource = script.value;
    }
    const parsed = parseWorkflowScript(scriptSource);
    if (!parsed.ok) return err(new WorkflowManagerError(parsed.error.message));

    const now = options.now ?? Date.now;
    const toolPolicy = options.toolPolicy;
    this.active.get(runId)?.abort();
    // Claim write authority before the first write so any still-running prior
    // execution has its late snapshot/journal writes fenced.
    const generation = options.store.nextGeneration(runId);
    let snapshot: WorkflowRunSnapshot = {
      ...existing.value,
      status: "queued",
      error: undefined,
      result: undefined,
      summary: undefined,
      completedAt: undefined,
      toolAllowlist: toolPolicy.toolAllowlist,
      excludedTools: toolPolicy.excludedTools,
      budgetSpent: 0,
      agentCalls: 0,
      agents: [],
      logs: [],
      updatedAt: now(),
    };
    if (replacement) {
      // Re-pin the edited script: chained replay keys make the journal a
      // prefix cache, so the first edited call diverges and re-runs live.
      snapshot = {
        ...snapshot,
        workflowName: parsed.value.meta.name,
        sourceKind: replacement.ref.kind,
        sourceHash: replacement.sourceHash,
        scriptPath: replacement.scriptPath,
        meta: parsed.value.meta.raw,
        budgetTotal:
          typeof parsed.value.meta.budget === "number" && parsed.value.meta.budget > 0
            ? parsed.value.meta.budget
            : null,
        phases: parsed.value.meta.phases ?? [],
      };
      await options.store.createRun(snapshot, replacement.source, generation);
    } else {
      await options.store.updateRun(snapshot, generation);
    }
    const controller = new AbortController();
    this.active.set(runId, controller);
    void this.execute(snapshot, parsed.value, {
      ...options,
      now,
      signal: controller.signal,
      generation,
    })
      .catch(() => {})
      .finally(() => {
        if (this.active.get(runId) === controller) this.active.delete(runId);
      });

    return ok({
      status: "async_launched",
      taskId: runId,
      taskType: "local_workflow",
      runId,
      workflowName: snapshot.workflowName,
      scriptPath: snapshot.scriptPath,
      summary: `Workflow "${snapshot.workflowName}" resumed${
        existing.value.status === "completed" ? " (re-running a previously completed run)" : ""
      }${replacement ? " with the edited script" : ""}. /workflows status ${runId} to inspect, /workflows stop ${runId} to cancel.`,
    });
  }

  async stop(runId: RunId, store: WorkflowStore, now = Date.now): Promise<Result<WorkflowRunSnapshot, WorkflowManagerError>> {
    this.active.get(runId)?.abort();
    const existing = await store.readRun(runId);
    if (!existing.ok) return err(new WorkflowManagerError(existing.error.message));
    // Never overwrite a real terminal summary with "Stopped by user."
    if (existing.value.status === "completed" || existing.value.status === "failed" || existing.value.status === "stopped") {
      return ok(existing.value);
    }
    // Claim write authority so the aborted execution's terminal write is fenced.
    const generation = store.nextGeneration(runId);
    const snapshot: WorkflowRunSnapshot = {
      ...existing.value,
      status: "stopped",
      updatedAt: now(),
      completedAt: now(),
      summary: "Stopped by user.",
    };
    await store.updateRun(snapshot, generation);
    return ok(snapshot);
  }

  isActive(runId: RunId): boolean {
    return this.active.has(runId);
  }

  /**
   * Mark crashed runs failed. A running/queued run is reconciled only when it
   * is not active in this manager AND its recorded owning process is dead or
   * unrecorded - a live sibling Pi session's runs are left alone.
   */
  async reconcile(store: WorkflowStore, now = Date.now): Promise<WorkflowRunSnapshot[]> {
    const reconciled: WorkflowRunSnapshot[] = [];
    for (const run of await store.listRuns()) {
      if (run.status !== "running" && run.status !== "queued") continue;
      if (this.isActive(run.runId)) continue;
      if (isPidAlive(run.pid)) continue;
      const generation = store.nextGeneration(run.runId);
      const message = `Interrupted - Pi exited mid-run. Resume with /workflows resume ${run.runId}`;
      const snapshot: WorkflowRunSnapshot = {
        ...run,
        status: "failed",
        error: message,
        summary: `Failed: ${message}`,
        updatedAt: now(),
        completedAt: now(),
      };
      await store.updateRun(snapshot, generation);
      await store.removeOrphanedTempFiles(run.runId);
      reconciled.push(snapshot);
    }
    return reconciled;
  }

  private async execute(
    snapshot: WorkflowRunSnapshot,
    parsed: ParsedWorkflowScript,
    options: WorkflowLaunchOptions & { readonly signal: AbortSignal; readonly now: () => number; readonly generation: number },
  ): Promise<void> {
    const generation = options.generation;
    let next: WorkflowRunSnapshot = {
      ...snapshot,
      status: "running",
      pid: process.pid,
      updatedAt: options.now(),
    };
    await options.store.updateRun(next, generation);
    let runtime: WorkflowRuntime | undefined;

    try {
      const journal = await options.store.readJournal(snapshot.runId);
      runtime = new WorkflowRuntime(next, journal, {
        store: options.store,
        agentRunner: options.agentRunner,
        signal: options.signal,
        now: options.now,
        generation,
      });
      const result = await runtime.execute(parsed);
      next = {
        ...runtime.getSnapshot(),
        status: "completed",
        result,
        summary: summariseResult(result),
        updatedAt: options.now(),
        completedAt: options.now(),
      };
    } catch (error) {
      const stopped = options.signal.aborted || (error instanceof WorkflowRuntimeError && error.message === "Workflow was stopped");
      const current = runtime?.getSnapshot() ?? next;
      next = {
        ...current,
        status: stopped ? "stopped" : "failed",
        error: stopped ? undefined : errorMessage(error),
        summary: stopped ? "Stopped by user." : `Failed: ${errorMessage(error)}`,
        updatedAt: options.now(),
        completedAt: options.now(),
      };
    }

    await options.store.updateRun(next, generation);
    // A superseded execution (stopped or resumed over) must not announce its
    // stale terminal state; the superseding path owns user-facing delivery.
    if (options.store.currentGeneration(snapshot.runId) === generation) {
      options.deliver?.(next);
    }
  }
}

function isPidAlive(pid: number | undefined): boolean {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Parse a run id for command handlers. */
export function parseCommandRunId(value: string | undefined): Result<RunId, WorkflowManagerError> {
  if (!value) return err(new WorkflowManagerError("Missing workflow run id"));
  const parsed = parseRunId(value);
  return parsed.ok ? ok(parsed.value) : err(new WorkflowManagerError(parsed.error.message));
}

/**
 * Build tool input from `/workflows run ...` arguments. Only the first token is
 * split off as the target; the remainder is handed to `JSON.parse` verbatim so
 * whitespace inside JSON string values survives.
 */
export function parseRunCommand(args: string): Result<WorkflowInput, WorkflowManagerError> {
  const trimmed = args.trim();
  const firstSpace = trimmed.search(/\s/u);
  const target = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  if (!target) return err(new WorkflowManagerError("Usage: /workflows run <name|path> [jsonArgs]"));
  const rawArgs = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();
  let parsedArgs: JsonValue | undefined;
  if (rawArgs) {
    try {
      parsedArgs = JSON.parse(rawArgs) as JsonValue;
    } catch (error) {
      return err(new WorkflowManagerError(`Invalid JSON args: ${errorMessage(error)}`));
    }
  }
  const input: WorkflowInput = target.endsWith(".js") || target.includes("/") ? { scriptPath: target } : { name: target };
  return ok(parsedArgs === undefined ? input : { ...input, args: parsedArgs });
}

function makeInitialSnapshot(input: {
  readonly runId: RunId;
  readonly projectKey: string;
  readonly cwd: string;
  readonly workflowName: string;
  readonly sourceKind: WorkflowRunSnapshot["sourceKind"];
  readonly sourceHash: string;
  readonly scriptPath?: string;
  readonly args: JsonValue;
  readonly meta: JsonValue;
  readonly toolPolicy: WorkflowToolPolicy;
  readonly budgetTotal: number | null;
  readonly phases: readonly string[];
  readonly now: number;
}): WorkflowRunSnapshot {
  return {
    schemaVersion: 2,
    runId: input.runId,
    projectKey: input.projectKey,
    cwd: input.cwd,
    status: "queued",
    workflowName: input.workflowName,
    sourceKind: input.sourceKind,
    sourceHash: input.sourceHash,
    scriptPath: input.scriptPath,
    scriptFile: "script.js",
    args: input.args,
    meta: input.meta,
    toolAllowlist: input.toolPolicy.toolAllowlist,
    excludedTools: input.toolPolicy.excludedTools,
    budgetTotal: input.budgetTotal,
    budgetSpent: 0,
    agentCalls: 0,
    agents: [],
    phases: input.phases,
    logs: [],
    startedAt: input.now,
    updatedAt: input.now,
  };
}

function summariseResult(result: JsonValue): string {
  if (typeof result === "string") return preview(result, 500);
  return preview(JSON.stringify(result), 500);
}
