import { cpus } from "node:os";
import { createContext, Script } from "node:vm";

import {
  markAgentCached,
  markAgentCompleted,
  markAgentFailed,
  startAgent,
  touchAgentProgress,
} from "./agent-lifecycle.ts";
import {
  nextReplayKey,
  parseWorkflowInput,
  type AgentOptions,
  type JsonValue,
  type ReplayKey,
  type WorkflowJournalEntry,
  type WorkflowRunSnapshot,
} from "./domain.ts";
import { errorMessage } from "./prelude.ts";
import { type ParsedWorkflowScript, parseWorkflowScript } from "./parser.ts";
import { WorkflowSnapshotWriter } from "./snapshot-writer.ts";
import type { WorkflowStore } from "./store.ts";
import type { WorkflowToolPolicy } from "./tool-policy.ts";

const AGENT_CAP = 1000;
const LOG_CAP = 1000;
const ARRAY_CAP = 4096;

/** Result returned by a workflow subagent adapter. */
export interface AgentRunResult {
  readonly value: JsonValue;
  readonly outputTokens: number;
}

/** Runtime options supplied to the concrete Pi subagent adapter. */
export type AgentRunOptions = AgentOptions & {
  readonly signal: AbortSignal;
  readonly onProgress?: () => void;
  readonly toolPolicy: WorkflowToolPolicy;
};

/** Narrow port used by the workflow runtime to launch Pi subagents. */
export interface AgentRunner {
  run(prompt: string, options: AgentRunOptions): Promise<AgentRunResult>;
}

export interface WorkflowRuntimeDeps {
  readonly store: WorkflowStore;
  readonly agentRunner: AgentRunner;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly concurrency?: number;
  /** Write-authority epoch; superseded executions have their durable writes fenced. */
  readonly generation?: number;
}

/** Default per-agent stall timeout: abort a subagent that makes no progress. */
const DEFAULT_STALL_MS = 180_000;

export class WorkflowRuntimeError extends Error {
  readonly _tag: "WorkflowRuntimeError" | "WorkflowBudgetExceededError" = "WorkflowRuntimeError";
}

class WorkflowBudgetExceededError extends WorkflowRuntimeError {
  override readonly _tag = "WorkflowBudgetExceededError";
}

/** Execute parsed workflow JavaScript in a restricted VM with workflow helpers. */
export class WorkflowRuntime {
  private snapshot: WorkflowRunSnapshot;
  private previousReplayKey: ReplayKey | "" = "";
  private readonly cachedResults = new Map<ReplayKey, WorkflowJournalEntry & { readonly kind: "agent_result" }>();
  private readonly semaphore: Semaphore;
  private currentPhase: string | undefined;
  private childDepth = 0;
  private childLogPrefix = "";
  private forcedAgentPhase: string | undefined;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextTimerId = 1;
  private readonly deps: WorkflowRuntimeDeps;
  private readonly snapshots: WorkflowSnapshotWriter;

  constructor(
    snapshot: WorkflowRunSnapshot,
    journal: readonly WorkflowJournalEntry[],
    deps: WorkflowRuntimeDeps,
  ) {
    this.snapshot = snapshot;
    this.deps = deps;
    this.snapshots = new WorkflowSnapshotWriter({ store: deps.store, generation: deps.generation });
    this.semaphore = new Semaphore(deps.concurrency ?? defaultConcurrency());
    for (const entry of journal) {
      if (entry.kind === "agent_result") this.cachedResults.set(entry.replayKey, entry);
    }
  }

  /** Current durable snapshot. */
  getSnapshot(): WorkflowRunSnapshot {
    return this.snapshot;
  }

  /** Execute the top-level workflow body. */
  async execute(parsed: ParsedWorkflowScript): Promise<JsonValue> {
    try {
      const result = await this.executeBody(parsed.body, this.snapshot.args, parsed.meta.name);
      const json = this.sanitise(result);
      return json === undefined ? null : json;
    } finally {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
      await this.snapshots.drainAndDispose().catch(() => {});
    }
  }

  private async executeBody(body: string, args: JsonValue, filename: string): Promise<unknown> {
    this.throwIfAborted();
    // Inject only host callables under hidden `__host$*` names. The static
    // bootstrap captures them into a closure, deletes the globals, and exposes
    // in-realm DSL wrappers that marshal every result back through JSON. The
    // workflow body can therefore name no host object, sealing the
    // `.constructor` -> host `Function` escape. See ADR 0001.
    const sandbox = Object.create(null) as Record<string, unknown>;
    Object.assign(sandbox, this.createHostBridge(args), {
      WebAssembly: undefined,
      ShadowRealm: undefined,
      FinalizationRegistry: undefined,
      WeakRef: undefined,
      Atomics: undefined,
      SharedArrayBuffer: undefined,
      queueMicrotask: undefined,
      eval: undefined,
      Function: undefined,
    });
    const context = createContext(sandbox, {
      name: "pi-workflow",
      codeGeneration: { strings: false, wasm: false },
    });
    new Script(BOOTSTRAP, { filename: "pi-workflow-bootstrap.js" }).runInContext(context, { timeout: 30_000 });
    const wrapped = `(async () => {\n${body}\n})()`;
    const script = new Script(wrapped, { filename: `${filename}.js` });
    return await script.runInContext(context, { timeout: 30_000 });
  }

  /**
   * Host callables exposed to the bootstrap under `__host$*` names. Async
   * helpers return a JSON envelope string so neither results nor host errors
   * cross into the realm as host objects; the bootstrap re-throws in-realm.
   */
  private createHostBridge(args: JsonValue): Record<string, unknown> {
    const marshal = async (run: () => Promise<JsonValue>): Promise<string> => {
      try {
        return JSON.stringify({ ok: true, value: await run() });
      } catch (error) {
        return JSON.stringify({ ok: false, error: errorMessage(error) });
      }
    };
    return {
      __host$argsJson: JSON.stringify(cloneJson(args)),
      __host$agent: (prompt: unknown, options: unknown): Promise<string> => marshal(() => this.agent(prompt, options)),
      __host$parallel: (items: unknown): Promise<string> => marshal(() => this.parallel(items)),
      __host$pipeline: (items: unknown, stages: unknown): Promise<string> =>
        marshal(() => this.pipeline(items, ...(Array.isArray(stages) ? stages : []))),
      __host$workflow: (nameOrSpec: unknown, workflowArgs: unknown): Promise<string> =>
        marshal(() => this.workflow(nameOrSpec, workflowArgs)),
      __host$phase: (title: unknown): void => {
        try {
          this.phase(title);
        } catch {
          // Progress markers must never fail the workflow body.
        }
      },
      __host$log: (message: unknown): void => {
        try {
          this.log(String(message));
        } catch {
          // Logging must never fail the workflow body.
        }
      },
      __host$setTimeout: (callback: unknown, delay: unknown): string => {
        try {
          return JSON.stringify({ ok: true, value: this.workflowSetTimeout(callback, delay) });
        } catch (error) {
          return JSON.stringify({ ok: false, error: errorMessage(error) });
        }
      },
      __host$clearTimeout: (id: unknown): void => {
        try {
          this.workflowClearTimeout(id);
        } catch {
          // Clearing an unknown timer id is a no-op.
        }
      },
      __host$budgetTotal: this.snapshot.budgetTotal,
      __host$budgetSpent: (): number => this.snapshot.budgetSpent,
      __host$budgetRemaining: (): number =>
        this.snapshot.budgetTotal === null
          ? Infinity
          : Math.max(0, this.snapshot.budgetTotal - this.snapshot.budgetSpent),
    };
  }

  private async agent(promptInput: unknown, optionsInput?: unknown): Promise<JsonValue> {
    this.throwIfAborted();
    if (this.snapshot.agentCalls >= AGENT_CAP) {
      throw new WorkflowRuntimeError(
        "Workflow agent() call cap reached (1000). Add a hard iteration cap to loops or pass a token budget.",
      );
    }
    if (this.snapshot.budgetTotal !== null && this.snapshot.budgetSpent >= this.snapshot.budgetTotal) {
      throw new WorkflowBudgetExceededError("Workflow token budget exceeded");
    }

    const prompt = String(promptInput);
    const options = parseAgentOptions(optionsInput);
    if (options.isolation === "remote" || options.isolation === "worktree") {
      throw new WorkflowRuntimeError(`agent({isolation:'${options.isolation}'}) is not available in this build`);
    }
    if (options.agentType !== undefined) {
      this.log(`agent option agentType="${options.agentType}" is not supported in this build and was ignored`);
    }

    const replayKey = nextReplayKey(this.previousReplayKey, prompt, options);
    this.previousReplayKey = replayKey;
    const phase = this.forcedAgentPhase ?? options.phase ?? this.currentPhase;
    const startedAt = this.deps.now();
    const started = startAgent(this.snapshot, { replayKey, prompt, options, phase, now: startedAt });
    const index = started.index;
    this.snapshot = started.snapshot;
    await this.snapshots.writeNow(this.snapshot);

    const cached = this.cachedResults.get(replayKey);
    if (cached) {
      const completedAt = this.deps.now();
      this.snapshot = markAgentCached(this.snapshot, index, cached.outputTokens, completedAt);
      await this.snapshots.writeNow(this.snapshot);
      this.log(`agent[${index}] cached${options.label ? `: ${options.label}` : ""}`);
      return cached.value;
    }

    await this.deps.store.appendJournal(
      this.snapshot.runId,
      {
        kind: "agent_started",
        at: this.deps.now(),
        replayKey,
        index,
        prompt,
        label: options.label,
        phase,
      },
      this.deps.generation,
    );

    let result: AgentRunResult;
    try {
      result = await this.semaphore.run(() => this.runAgent(prompt, { ...options, phase }, index));
    } catch (error) {
      const failedAt = this.deps.now();
      this.snapshot = markAgentFailed(this.snapshot, index, errorMessage(error), failedAt);
      await this.snapshots.writeNow(this.snapshot);
      throw error;
    }
    const completedAt = this.deps.now();
    this.snapshot = markAgentCompleted(this.snapshot, index, result.outputTokens, completedAt);
    // Match the spec: only successful non-null results are journalled, so
    // null/skipped agents re-run rather than replaying `null` on resume.
    if (result.value !== null) {
      await this.deps.store.appendJournal(
        this.snapshot.runId,
        {
          kind: "agent_result",
          at: this.deps.now(),
          replayKey,
          value: result.value,
          outputTokens: result.outputTokens,
        },
        this.deps.generation,
      );
    }
    await this.snapshots.writeNow(this.snapshot);
    return result.value;
  }

  /**
   * Run a single subagent under a per-agent stall watchdog. The agent aborts if
   * `deps.signal` fires or it makes no progress for `stallMs` (default 180s;
   * `<= 0` disables), so a hung agent cannot wedge a background run.
   */
  private async runAgent(prompt: string, options: AgentOptions & { readonly phase?: string }, index: number): Promise<AgentRunResult> {
    const stallMs = options.stallMs ?? DEFAULT_STALL_MS;
    const controller = new AbortController();
    const abortFromParent = (): void => controller.abort();
    if (this.deps.signal.aborted) controller.abort();
    else this.deps.signal.addEventListener("abort", abortFromParent, { once: true });

    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Resettable no-progress watchdog: each runner progress event (message
    // deltas, tool executions, turn starts) pushes the deadline out, so only a
    // genuinely silent agent is aborted, however long its real work takes.
    const armWatchdog =
      stallMs > 0
        ? (): void => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              stalled = true;
              controller.abort();
            }, stallMs);
          }
        : undefined;
    armWatchdog?.();
    const onProgress = (): void => {
      armWatchdog?.();
      this.markAgentProgress(index);
    };

    try {
      return await this.deps.agentRunner.run(prompt, {
        ...options,
        signal: controller.signal,
        onProgress,
        toolPolicy: {
          toolAllowlist: this.snapshot.toolAllowlist,
          excludedTools: this.snapshot.excludedTools,
        },
      });
    } catch (error) {
      if (stalled) {
        this.log(`agent[${index}] stalled after ${stallMs}ms and was aborted`);
        throw new WorkflowRuntimeError(`agent[${index}] stalled after ${stallMs}ms with no progress`);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      this.deps.signal.removeEventListener("abort", abortFromParent);
    }
  }

  private async parallel(items: unknown): Promise<Array<JsonValue | null>> {
    this.throwIfBudgetExceeded();
    if (!Array.isArray(items)) throw new WorkflowRuntimeError("parallel() expects an array of functions");
    if (items.length > ARRAY_CAP) {
      throw new WorkflowRuntimeError(`parallel() accepts at most ${ARRAY_CAP} items; got ${items.length}`);
    }
    if (items.some((item) => typeof item !== "function")) {
      throw new WorkflowRuntimeError("parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)");
    }
    const tasks = items.map(async (item, index) => {
      try {
        const value = await Promise.resolve().then(() => (item as () => unknown)());
        return this.sanitise(value) ?? null;
      } catch (error) {
        this.log(`parallel[${index}] failed: ${errorMessage(error)}`);
        return null;
      }
    });
    return Promise.all(tasks);
  }

  private async pipeline(items: unknown, ...stages: unknown[]): Promise<Array<JsonValue | null>> {
    this.throwIfBudgetExceeded();
    if (!Array.isArray(items)) throw new WorkflowRuntimeError("pipeline() expects an array as the first argument");
    if (items.length > ARRAY_CAP) {
      throw new WorkflowRuntimeError(`pipeline() accepts at most ${ARRAY_CAP} items; got ${items.length}`);
    }
    if (stages.some((stage) => typeof stage !== "function")) {
      throw new WorkflowRuntimeError("pipeline() stages must be functions: pipeline(items, item => ..., result => ...)");
    }
    const tasks = items.map(async (item, index) => {
      try {
        let current: unknown = item;
        for (const stage of stages) {
          if (current === null) break;
          current = await (stage as (current: unknown, original: unknown, index: number) => unknown)(current, item, index);
        }
        return this.sanitise(current) ?? null;
      } catch (error) {
        this.log(`pipeline[${index}] failed: ${errorMessage(error)}`);
        return null;
      }
    });
    return Promise.all(tasks);
  }

  /** Boundary sanitiser that surfaces silent array truncation in the run log. */
  private sanitise(value: unknown): JsonValue | undefined {
    return sanitiseBoundaryValue(value, () =>
      this.log(`array truncated to ${ARRAY_CAP} elements at the workflow boundary`),
    );
  }

  private phase(title: unknown): void {
    if (this.childDepth > 0) return;
    const phase = String(title);
    this.currentPhase = phase;
    this.snapshot = {
      ...this.snapshot,
      phases: this.snapshot.phases.includes(phase) ? this.snapshot.phases : [...this.snapshot.phases, phase],
      updatedAt: this.deps.now(),
    };
    this.snapshots.touch(this.snapshot);
  }

  private log(message: string): void {
    const text = `${this.childLogPrefix}${message}`;
    this.snapshot = {
      ...this.snapshot,
      logs: [...this.snapshot.logs, text].slice(-LOG_CAP),
      updatedAt: this.deps.now(),
    };
    this.snapshots.touch(this.snapshot);
  }

  private throwIfBudgetExceeded(): void {
    if (this.snapshot.budgetTotal !== null && this.snapshot.budgetSpent >= this.snapshot.budgetTotal) {
      throw new WorkflowBudgetExceededError("Workflow token budget exceeded");
    }
  }

  private async workflow(nameOrSpec: unknown, argsInput?: unknown): Promise<JsonValue> {
    if (this.childDepth >= 1) throw new WorkflowRuntimeError("Child workflows cannot launch child workflows");

    const input =
      typeof nameOrSpec === "string"
        ? { name: nameOrSpec, args: argsInput }
        : { ...(isRecord(nameOrSpec) ? nameOrSpec : {}), args: argsInput };
    const parsedInput = parseWorkflowInput(input);
    if (!parsedInput.ok) throw parsedInput.error;
    if (parsedInput.value.source === undefined) {
      throw new WorkflowRuntimeError("workflow() requires a script source; child workflows cannot resume runs");
    }

    const resolved = await this.deps.store.resolveSource(parsedInput.value.source);
    if (!resolved.ok) throw resolved.error;
    const parsed = parseWorkflowScript(resolved.value.source);
    if (!parsed.ok) throw parsed.error;

    const childName = parsed.value.meta.name;
    const priorDepth = this.childDepth;
    const priorPrefix = this.childLogPrefix;
    const priorForcedPhase = this.forcedAgentPhase;
    this.childDepth = priorDepth + 1;
    this.childLogPrefix = `[${childName}] `;
    this.forcedAgentPhase = `child:${childName}`;
    try {
      return this.sanitise(await this.executeBody(parsed.value.body, parsedInput.value.args, childName)) ?? null;
    } finally {
      this.childDepth = priorDepth;
      this.childLogPrefix = priorPrefix;
      this.forcedAgentPhase = priorForcedPhase;
    }
  }

  private workflowSetTimeout(callback: unknown, delay: unknown): number {
    if (typeof callback !== "function") throw new WorkflowRuntimeError("setTimeout callback must be a function");
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    const ms = Math.max(0, Number(delay) || 0);
    const timer = setTimeout(() => {
      this.timers.delete(id);
      // Route async callback rejections into the run log too; a bare void call
      // would surface them as host-level unhandled rejections.
      Promise.resolve()
        .then(() => (callback as () => unknown)())
        .catch((error) => this.log(`timer failed: ${errorMessage(error)}`));
    }, ms);
    this.timers.set(id, timer);
    return id;
  }

  private workflowClearTimeout(id: unknown): void {
    const numeric = Number(id);
    const timer = this.timers.get(numeric);
    if (timer) clearTimeout(timer);
    this.timers.delete(numeric);
  }

  private throwIfAborted(): void {
    if (this.deps.signal.aborted) throw new WorkflowRuntimeError("Workflow was stopped");
  }

  private markAgentProgress(index: number): void {
    const now = this.deps.now();
    this.snapshot = touchAgentProgress(this.snapshot, index, now);
    this.snapshots.touch(this.snapshot);
  }
}

function parseAgentOptions(input: unknown): AgentOptions {
  if (!isRecord(input)) return {};
  const schema = input.schema === undefined ? undefined : sanitiseBoundaryValue(input.schema);
  return {
    label: typeof input.label === "string" ? input.label : undefined,
    schema,
    model: typeof input.model === "string" ? input.model : undefined,
    effort: typeof input.effort === "string" ? input.effort : undefined,
    isolation: typeof input.isolation === "string" ? input.isolation : undefined,
    agentType: typeof input.agentType === "string" ? input.agentType : undefined,
    phase: typeof input.phase === "string" ? input.phase : undefined,
    stallMs: typeof input.stallMs === "number" && Number.isFinite(input.stallMs) ? input.stallMs : undefined,
  };
}

function sanitiseBoundaryValue(
  value: unknown,
  onTruncate?: () => void,
  seen = new WeakSet<object>(),
): JsonValue | undefined {
  if (value === undefined) return null;
  if (typeof value === "function") throw new WorkflowRuntimeError("Workflow result cannot be a function");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new WorkflowRuntimeError("Workflow result cannot contain cycles");
    seen.add(value);
    // Build a fresh host-realm array rather than value.slice()/map(), which
    // would preserve the (possibly in-realm) prototype of the input array.
    const output: JsonValue[] = [];
    for (let index = 0; index < value.length && index < ARRAY_CAP; index += 1) {
      output.push(sanitiseBoundaryValue(value[index], onTruncate, seen) ?? null);
    }
    if (value.length > ARRAY_CAP) onTruncate?.();
    return output;
  }
  if (isRecord(value)) {
    if (seen.has(value)) throw new WorkflowRuntimeError("Workflow result cannot contain cycles");
    seen.add(value);
    const output: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__") continue;
      const parsed = sanitiseBoundaryValue(item, onTruncate, seen);
      if (parsed !== undefined) output[key] = parsed;
    }
    return output;
  }
  return String(value);
}

function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function defaultConcurrency(): number {
  return Math.min(16, Math.max(2, cpus().length - 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}

/**
 * Static, host-authored bootstrap run in the VM context before the workflow
 * body. It captures the injected `__host$*` callables into a closure, deletes
 * them from the global object, and installs in-realm DSL wrappers that marshal
 * every value across the boundary through JSON. It also tames the context's own
 * `Date`/`Math` intrinsics for determinism. After this runs, the workflow body
 * can reach no host object, so `.constructor` resolves only to the in-realm
 * `Function` (neutered by `codeGeneration.strings: false`).
 */
const BOOTSTRAP = `
"use strict";
(() => {
  const H = {
    agent: globalThis.__host$agent,
    parallel: globalThis.__host$parallel,
    pipeline: globalThis.__host$pipeline,
    workflow: globalThis.__host$workflow,
    phase: globalThis.__host$phase,
    log: globalThis.__host$log,
    setTimeout: globalThis.__host$setTimeout,
    clearTimeout: globalThis.__host$clearTimeout,
    budgetTotal: globalThis.__host$budgetTotal,
    budgetSpent: globalThis.__host$budgetSpent,
    budgetRemaining: globalThis.__host$budgetRemaining,
    argsJson: globalThis.__host$argsJson,
  };
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.indexOf("__host$") === 0) delete globalThis[key];
  }

  const unwrap = (envelopeJson) => {
    const env = JSON.parse(envelopeJson);
    if (env && env.ok) return env.value;
    throw new Error(env && typeof env.error === "string" ? env.error : "Workflow host call failed");
  };

  globalThis.args = JSON.parse(H.argsJson);
  globalThis.agent = async (prompt, options) => unwrap(await H.agent(prompt, options));
  globalThis.parallel = async (items) => unwrap(await H.parallel(items));
  globalThis.pipeline = async (items, ...stages) => unwrap(await H.pipeline(items, stages));
  globalThis.workflow = async (nameOrSpec, workflowArgs) => unwrap(await H.workflow(nameOrSpec, workflowArgs));
  globalThis.phase = (title) => { H.phase(title); };
  globalThis.log = (message) => { H.log(message); };
  globalThis.setTimeout = (callback, delay) => unwrap(H.setTimeout(callback, delay));
  globalThis.clearTimeout = (id) => { H.clearTimeout(id); };
  globalThis.budget = {
    total: H.budgetTotal,
    spent: () => H.budgetSpent(),
    remaining: () => H.budgetRemaining(),
  };

  const truncate = (text) => (text.length <= 400 ? text : text.slice(0, 400) + "...");
  const formatValue = (value) => {
    if (typeof value === "string") return value;
    try {
      const json = JSON.stringify(value);
      return truncate(json === undefined ? String(value) : json);
    } catch {
      return truncate(String(value));
    }
  };
  const writeLog = (prefix, values) => { H.log(prefix + values.map(formatValue).join(" ")); };
  globalThis.console = {
    log: (...values) => writeLog("", values),
    info: (...values) => writeLog("", values),
    debug: (...values) => writeLog("", values),
    warn: (...values) => writeLog("[warn] ", values),
    error: (...values) => writeLog("[error] ", values),
  };

  const RealDate = Date;
  const WorkflowDate = function (...args) {
    if (!new.target) throw new Error("Date() without explicit arguments is not available in workflows");
    if (args.length === 0) throw new Error("new Date() without explicit arguments is not available in workflows");
    return Reflect.construct(RealDate, args, new.target);
  };
  WorkflowDate.prototype = RealDate.prototype;
  Object.defineProperty(RealDate.prototype, "constructor", { value: WorkflowDate, writable: true, configurable: true });
  WorkflowDate.parse = RealDate.parse;
  WorkflowDate.UTC = RealDate.UTC;
  WorkflowDate.now = () => { throw new Error("Date.now is not available in workflows"); };
  globalThis.Date = WorkflowDate;

  Object.defineProperty(Math, "random", {
    value: () => { throw new Error("Math.random is not available in workflows"); },
    writable: true,
    configurable: true,
  });
})();
`;
