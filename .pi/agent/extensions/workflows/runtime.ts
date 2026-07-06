import { cpus } from "node:os";
import { createContext, Script } from "node:vm";

import {
  nextReplayKey,
  parseWorkflowInput,
  stableJson,
  toJsonValue,
  type AgentOptions,
  type JsonValue,
  type ReplayKey,
  type WorkflowJournalEntry,
  type WorkflowRunSnapshot,
} from "./domain.ts";
import { errorMessage, preview } from "./prelude.ts";
import { type ParsedWorkflowScript, parseWorkflowScript } from "./parser.ts";
import type { WorkflowStore } from "./store.ts";

const AGENT_CAP = 1000;
const LOG_CAP = 1000;
const ARRAY_CAP = 4096;

/** Result returned by a workflow subagent adapter. */
export interface AgentRunResult {
  readonly value: JsonValue;
  readonly outputTokens: number;
}

/** Narrow port used by the workflow runtime to launch Pi subagents. */
export interface AgentRunner {
  run(prompt: string, options: AgentOptions & { readonly signal: AbortSignal }): Promise<AgentRunResult>;
}

export interface WorkflowRuntimeDeps {
  readonly store: WorkflowStore;
  readonly agentRunner: AgentRunner;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly concurrency?: number;
}

export class WorkflowRuntimeError extends Error {
  readonly _tag: "WorkflowRuntimeError" | "WorkflowBudgetExceededError" = "WorkflowRuntimeError";
}

export class WorkflowBudgetExceededError extends WorkflowRuntimeError {
  readonly _tag = "WorkflowBudgetExceededError";
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

  constructor(
    snapshot: WorkflowRunSnapshot,
    journal: readonly WorkflowJournalEntry[],
    deps: WorkflowRuntimeDeps,
  ) {
    this.snapshot = snapshot;
    this.deps = deps;
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
      const result = await this.executeBody(parsed.body, this.snapshot.args, parsed.meta.name ?? this.snapshot.workflowName);
      const json = sanitiseBoundaryValue(result);
      return json === undefined ? null : json;
    } finally {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
    }
  }

  private async executeBody(body: string, args: JsonValue, filename: string): Promise<unknown> {
    this.throwIfAborted();
    const sandbox = Object.create(null) as Record<string, unknown>;
    const helpers = this.createHelpers();
    Object.assign(sandbox, helpers, {
      args: cloneJson(args),
      console: this.createConsole(),
      Date: createDateShim(),
      Math: createMathShim(),
      globalThis: sandbox,
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
    const wrapped = `(async () => {\n${body}\n})()`;
    const script = new Script(wrapped, { filename: `${filename}.js` });
    return await script.runInContext(context, { timeout: 30_000 });
  }

  private createHelpers(): WorkflowHelpers {
    return {
      agent: (prompt, options) => this.agent(prompt, options),
      parallel: (items) => this.parallel(items),
      pipeline: (items, ...stages) => this.pipeline(items, ...stages),
      phase: (title) => this.phase(title),
      log: (message) => this.log(String(message)),
      budget: {
        total: this.snapshot.budgetTotal,
        spent: () => this.snapshot.budgetSpent,
        remaining: () =>
          this.snapshot.budgetTotal === null ? Infinity : Math.max(0, this.snapshot.budgetTotal - this.snapshot.budgetSpent),
      },
      workflow: (nameOrSpec, args) => this.workflow(nameOrSpec, args),
      setTimeout: (callback, delay) => this.workflowSetTimeout(callback, delay),
      clearTimeout: (id) => this.workflowClearTimeout(id),
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
    if (options.isolation === "remote") {
      throw new WorkflowRuntimeError("agent({isolation:'remote'}) is not available in this build");
    }

    const replayKey = nextReplayKey(this.previousReplayKey, prompt, options);
    this.previousReplayKey = replayKey;
    const index = this.snapshot.agentCalls + 1;
    const phase = this.forcedAgentPhase ?? options.phase ?? this.currentPhase;
    this.snapshot = {
      ...this.snapshot,
      agentCalls: index,
      updatedAt: this.deps.now(),
    };
    await this.deps.store.updateRun(this.snapshot);

    const cached = this.cachedResults.get(replayKey);
    if (cached) {
      this.snapshot = {
        ...this.snapshot,
        budgetSpent: this.snapshot.budgetSpent + Math.max(0, cached.outputTokens),
        updatedAt: this.deps.now(),
      };
      await this.deps.store.updateRun(this.snapshot);
      this.log(`agent[${index}] cached${options.label ? `: ${options.label}` : ""}`);
      return cached.value;
    }

    await this.deps.store.appendJournal(this.snapshot.runId, {
      kind: "agent_started",
      at: this.deps.now(),
      replayKey,
      index,
      prompt,
      label: options.label,
      phase,
    });

    const result = await this.semaphore.run(() =>
      this.deps.agentRunner.run(prompt, {
        ...options,
        phase,
        signal: this.deps.signal,
      }),
    );
    this.snapshot = {
      ...this.snapshot,
      budgetSpent: this.snapshot.budgetSpent + Math.max(0, result.outputTokens),
      updatedAt: this.deps.now(),
    };
    await this.deps.store.appendJournal(this.snapshot.runId, {
      kind: "agent_result",
      at: this.deps.now(),
      replayKey,
      value: result.value,
      outputTokens: result.outputTokens,
    });
    await this.deps.store.updateRun(this.snapshot);
    return result.value;
  }

  private async parallel(items: unknown): Promise<Array<JsonValue | null>> {
    if (!Array.isArray(items)) throw new WorkflowRuntimeError("parallel() expects an array of functions");
    if (items.some((item) => typeof item !== "function")) {
      throw new WorkflowRuntimeError("parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)");
    }
    const tasks = items.map(async (item, index) => {
      try {
        const value = await Promise.resolve().then(() => (item as () => unknown)());
        return sanitiseBoundaryValue(value) ?? null;
      } catch (error) {
        this.log(`parallel[${index}] failed: ${errorMessage(error)}`);
        return null;
      }
    });
    return Promise.all(tasks);
  }

  private async pipeline(items: unknown, ...stages: unknown[]): Promise<Array<JsonValue | null>> {
    if (!Array.isArray(items)) throw new WorkflowRuntimeError("pipeline() expects an array as the first argument");
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
        return sanitiseBoundaryValue(current) ?? null;
      } catch (error) {
        this.log(`pipeline[${index}] failed: ${errorMessage(error)}`);
        return null;
      }
    });
    return Promise.all(tasks);
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
    void this.deps.store.updateRun(this.snapshot);
  }

  private log(message: string): void {
    const text = `${this.childLogPrefix}${message}`;
    this.snapshot = {
      ...this.snapshot,
      logs: [...this.snapshot.logs, text].slice(-LOG_CAP),
      updatedAt: this.deps.now(),
    };
    void this.deps.store.updateRun(this.snapshot);
  }

  private async workflow(nameOrSpec: unknown, argsInput?: unknown): Promise<JsonValue> {
    if (this.childDepth >= 1) throw new WorkflowRuntimeError("Child workflows cannot launch child workflows");

    const input =
      typeof nameOrSpec === "string"
        ? { name: nameOrSpec, args: argsInput }
        : { ...(isRecord(nameOrSpec) ? nameOrSpec : {}), args: argsInput };
    const parsedInput = parseWorkflowInput(input);
    if (!parsedInput.ok) throw parsedInput.error;

    const resolved = await this.deps.store.resolveSource(parsedInput.value.source);
    if (!resolved.ok) throw resolved.error;
    const parsed = parseWorkflowScript(resolved.value.source);
    if (!parsed.ok) throw parsed.error;

    const childName = parsed.value.meta.name ?? resolved.value.displayName;
    const priorDepth = this.childDepth;
    const priorPrefix = this.childLogPrefix;
    const priorForcedPhase = this.forcedAgentPhase;
    this.childDepth = priorDepth + 1;
    this.childLogPrefix = `[${childName}] `;
    this.forcedAgentPhase = `child:${childName}`;
    try {
      return sanitiseBoundaryValue(await this.executeBody(parsed.value.body, parsedInput.value.args, childName)) ?? null;
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
      try {
        void (callback as () => unknown)();
      } catch (error) {
        this.log(`timer failed: ${errorMessage(error)}`);
      }
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

  private createConsole(): Pick<Console, "log" | "info" | "debug" | "warn" | "error"> {
    const write = (prefix: string, values: readonly unknown[]): void => {
      this.log(`${prefix}${values.map(formatLogValue).join(" ")}`);
    };
    return {
      log: (...values) => write("", values),
      info: (...values) => write("", values),
      debug: (...values) => write("", values),
      warn: (...values) => write("[warn] ", values),
      error: (...values) => write("[error] ", values),
    };
  }

  private throwIfAborted(): void {
    if (this.deps.signal.aborted) throw new WorkflowRuntimeError("Workflow was stopped");
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

function sanitiseBoundaryValue(value: unknown, seen = new WeakSet<object>()): JsonValue | undefined {
  if (value === undefined) return null;
  if (typeof value === "function") throw new WorkflowRuntimeError("Workflow result cannot be a function");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new WorkflowRuntimeError("Workflow result cannot contain cycles");
    seen.add(value);
    return value.slice(0, ARRAY_CAP).map((item) => sanitiseBoundaryValue(item, seen) ?? null);
  }
  if (isRecord(value)) {
    if (seen.has(value)) throw new WorkflowRuntimeError("Workflow result cannot contain cycles");
    seen.add(value);
    const output: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__") continue;
      const parsed = sanitiseBoundaryValue(item, seen);
      if (parsed !== undefined) output[key] = parsed;
    }
    return output;
  }
  return String(value);
}

function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function formatLogValue(value: unknown): string {
  if (typeof value === "string") return value;
  const json = toJsonValue(value);
  if (json !== undefined) return preview(stableJson(json), 400);
  return preview(String(value), 400);
}

function createDateShim(): DateConstructor {
  const DateShim = function (this: Date, ...args: unknown[]) {
    if (!new.target) throw new WorkflowRuntimeError("Date() without explicit arguments is not available in workflows");
    if (args.length === 0) throw new WorkflowRuntimeError("new Date() without explicit arguments is not available in workflows");
    return Reflect.construct(Date, args, new.target);
  };
  Object.defineProperty(DateShim, "now", {
    value: () => {
      throw new WorkflowRuntimeError("Date.now is not available in workflows");
    },
  });
  Object.defineProperty(DateShim, "parse", { value: Date.parse });
  Object.defineProperty(DateShim, "UTC", { value: Date.UTC });
  DateShim.prototype = Date.prototype;
  Object.setPrototypeOf(DateShim, Date);
  return DateShim as unknown as DateConstructor;
}

function createMathShim(): Math {
  const math = Object.create(Math) as Math;
  for (const key of Object.getOwnPropertyNames(Math)) {
    if (key === "random") continue;
    Object.defineProperty(math, key, Object.getOwnPropertyDescriptor(Math, key) ?? { value: undefined });
  }
  Object.defineProperty(math, "random", {
    value: () => {
      throw new WorkflowRuntimeError("Math.random is not available in workflows");
    },
  });
  return Object.freeze(math);
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

interface WorkflowHelpers {
  readonly agent: (prompt: unknown, options?: unknown) => Promise<JsonValue>;
  readonly parallel: (items: unknown) => Promise<Array<JsonValue | null>>;
  readonly pipeline: (items: unknown, ...stages: unknown[]) => Promise<Array<JsonValue | null>>;
  readonly phase: (title: unknown) => void;
  readonly log: (message: unknown) => void;
  readonly budget: {
    readonly total: number | null;
    readonly spent: () => number;
    readonly remaining: () => number;
  };
  readonly workflow: (nameOrSpec: unknown, args?: unknown) => Promise<JsonValue>;
  readonly setTimeout: (callback: unknown, delay: unknown) => number;
  readonly clearTimeout: (id: unknown) => void;
}
