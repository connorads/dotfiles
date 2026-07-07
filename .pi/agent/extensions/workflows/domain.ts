import { createHash, randomUUID } from "node:crypto";

import type { Brand, Instant } from "./prelude.ts";
import { err, ok, type Result } from "./result.ts";

/** JSON value accepted at workflow boundaries. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

/** Stable workflow run identifier. */
export type RunId = Brand<string, "RunId">;

/** Safe named workflow identifier. */
export type WorkflowName = Brand<string, "WorkflowName">;

/** Replay cache key for an agent call. */
export type ReplayKey = Brand<string, "ReplayKey">;

/** Workflow source kind after boundary parsing. */
export type WorkflowSourceRef =
  | { readonly kind: "inline"; readonly script: string }
  | { readonly kind: "path"; readonly scriptPath: string }
  | { readonly kind: "name"; readonly name: WorkflowName };

/** Source loaded and normalised before execution. */
export interface ResolvedWorkflowSource {
  readonly ref: WorkflowSourceRef;
  readonly source: string;
  readonly sourceHash: string;
  readonly displayName: string;
  readonly scriptPath?: string;
}

/** Parsed metadata exported by a workflow script. */
export interface WorkflowMeta {
  readonly name: string;
  readonly description: string;
  readonly phases?: readonly string[];
  readonly budget?: number;
  readonly raw: JsonValue;
}

/** Launch input accepted by the Pi workflow tool. */
export interface WorkflowInput {
  readonly script?: string;
  readonly scriptPath?: string;
  readonly name?: string;
  readonly title?: string;
  readonly description?: string;
  readonly args?: JsonValue;
  readonly resumeFromRunId?: string;
}

/** Parsed launch request, with the executable source still unresolved. */
export interface ParsedWorkflowInput {
  /** Absent only on a bare resume, which re-runs the run's pinned script. */
  readonly source?: WorkflowSourceRef;
  readonly args: JsonValue;
  readonly resumeFromRunId?: RunId;
}

/** Status persisted for a workflow run. */
export type WorkflowRunStatus = "queued" | "running" | "completed" | "failed" | "stopped";

/** Durable workflow run snapshot. */
export interface WorkflowRunSnapshot {
  readonly schemaVersion: 1;
  readonly runId: RunId;
  readonly projectKey: string;
  readonly cwd: string;
  readonly status: WorkflowRunStatus;
  readonly workflowName: string;
  readonly sourceKind: WorkflowSourceRef["kind"];
  readonly sourceHash: string;
  readonly scriptPath?: string;
  readonly scriptFile: string;
  readonly args: JsonValue;
  readonly meta: JsonValue;
  readonly budgetTotal: number | null;
  readonly budgetSpent: number;
  readonly agentCalls: number;
  readonly phases: readonly string[];
  readonly logs: readonly string[];
  readonly summary?: string;
  readonly result?: JsonValue;
  readonly error?: string;
  readonly startedAt: Instant;
  readonly updatedAt: Instant;
  readonly completedAt?: Instant;
  /** Process that owns the live execution; used to detect crashed runs. */
  readonly pid?: number;
}

/** Journal entry persisted for replay/resume. */
export type WorkflowJournalEntry =
  | {
      readonly kind: "agent_started";
      readonly at: Instant;
      readonly replayKey: ReplayKey;
      readonly index: number;
      readonly prompt: string;
      readonly label?: string;
      readonly phase?: string;
    }
  | {
      readonly kind: "agent_result";
      readonly at: Instant;
      readonly replayKey: ReplayKey;
      readonly value: JsonValue;
      readonly outputTokens: number;
    };

/** Agent options that affect replay identity. */
export interface AgentReplayOptions {
  readonly schema?: JsonValue;
  readonly model?: string;
  readonly effort?: string;
  readonly isolation?: string;
  readonly agentType?: string;
}

/** Parsed agent options used by the runtime. */
export interface AgentOptions extends AgentReplayOptions {
  readonly label?: string;
  readonly phase?: string;
  readonly stallMs?: number;
}

export class InvalidWorkflowInput extends Error {
  readonly _tag = "InvalidWorkflowInput";
}

export class InvalidWorkflowName extends Error {
  readonly _tag = "InvalidWorkflowName";
}

export class InvalidRunId extends Error {
  readonly _tag = "InvalidRunId";
}

/** Parse a run id from untrusted input. */
export function parseRunId(input: string): Result<RunId, InvalidRunId> {
  if (/^wf_[a-z0-9-]{6,}$/.test(input)) {
    // SAFETY: the regex is the only constructor for RunId.
    return ok(input as RunId);
  }
  return err(new InvalidRunId(`Invalid workflow run id: ${input}`));
}

/** Create a fresh workflow run id. */
export function createRunId(): RunId {
  const value = `wf_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  // SAFETY: createRunId controls the prefix and character set.
  return value as RunId;
}

/** Parse a direct-file workflow name. */
export function parseWorkflowName(input: string): Result<WorkflowName, InvalidWorkflowName> {
  const trimmed = input.trim().replace(/\.js$/u, "");
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed) && !trimmed.includes("..")) {
    // SAFETY: the regex excludes path separators and empty/hidden names.
    return ok(trimmed as WorkflowName);
  }
  return err(new InvalidWorkflowName(`Invalid workflow name: ${input}`));
}

/** Parse model/tool input into a single source plus optional args. */
export function parseWorkflowInput(input: unknown): Result<ParsedWorkflowInput, InvalidWorkflowInput> {
  if (!isPlainRecord(input)) return err(new InvalidWorkflowInput("Workflow input must be an object"));

  const allowed = new Set(["script", "scriptPath", "name", "title", "description", "args", "resumeFromRunId"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) return err(new InvalidWorkflowInput(`Unknown workflow input key: ${key}`));
  }

  const script = typeof input.script === "string" ? input.script : undefined;
  const scriptPath = typeof input.scriptPath === "string" ? input.scriptPath : undefined;
  const name = typeof input.name === "string" ? input.name : undefined;
  const sources = [script, scriptPath, name].filter((value) => value !== undefined);
  if (sources.length > 1) {
    return err(new InvalidWorkflowInput("Provide exactly one of script, name, or scriptPath"));
  }

  const args = input.args === undefined ? null : toJsonValue(input.args);
  if (args === undefined) return err(new InvalidWorkflowInput("args must be JSON-serialisable"));

  let resumeFromRunId: RunId | undefined;
  if (input.resumeFromRunId !== undefined) {
    if (typeof input.resumeFromRunId !== "string") {
      return err(new InvalidWorkflowInput("resumeFromRunId must be a string"));
    }
    const parsed = parseRunId(input.resumeFromRunId);
    if (!parsed.ok) return err(new InvalidWorkflowInput(parsed.error.message));
    resumeFromRunId = parsed.value;
  }

  // A bare resume re-runs the pinned script; a launch needs a source.
  if (sources.length === 0) {
    if (resumeFromRunId !== undefined) return ok({ args, resumeFromRunId });
    return err(new InvalidWorkflowInput("Must provide script, name, or scriptPath"));
  }

  if (script !== undefined) return ok({ source: { kind: "inline", script }, args, resumeFromRunId });
  if (scriptPath !== undefined) return ok({ source: { kind: "path", scriptPath }, args, resumeFromRunId });

  const parsedName = parseWorkflowName(name ?? "");
  if (!parsedName.ok) return err(new InvalidWorkflowInput(parsedName.error.message));
  return ok({ source: { kind: "name", name: parsedName.value }, args, resumeFromRunId });
}

/** Convert untrusted values to JSON data, dropping unsafe object prototypes. */
export function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const next: JsonValue[] = [];
    for (const item of value) {
      const parsed = toJsonValue(item);
      if (parsed === undefined) return undefined;
      next.push(parsed);
    }
    return next;
  }
  if (isPlainRecord(value)) {
    const next: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__") continue;
      const parsed = toJsonValue(item);
      if (parsed === undefined) return undefined;
      next[key] = parsed;
    }
    return next;
  }
  return undefined;
}

/** Stable JSON serialisation with sorted object keys and skipped unsafe values. */
export function stableJson(value: unknown): string {
  return JSON.stringify(normaliseForStableJson(value));
}

/** Hash text with SHA-256 hex output. */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Compute a chained replay key for an agent call. */
export function nextReplayKey(previous: ReplayKey | "", prompt: string, options: AgentReplayOptions): ReplayKey {
  const selected: {
    schema?: JsonValue;
    model?: string;
    effort?: string;
    isolation?: string;
    agentType?: string;
  } = {};
  if (options.schema !== undefined) selected.schema = options.schema;
  if (options.model !== undefined) selected.model = options.model;
  if (options.effort !== undefined) selected.effort = options.effort;
  if (options.isolation !== undefined) selected.isolation = options.isolation;
  if (options.agentType !== undefined) selected.agentType = options.agentType;
  // Each field is hashed separately before the outer hash, so no content in
  // one field (e.g. a NUL or delimiter in the prompt) can masquerade as
  // another field's bytes.
  const value = `v3:${sha256(`${sha256(previous)}:${sha256(prompt)}:${sha256(stableJson(selected))}`)}`;
  // SAFETY: replay keys are constructed only from this v3 field-hashed SHA-256 format.
  return value as ReplayKey;
}

/** True for JSON-like plain objects. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item === undefined || typeof item === "function") return null;
      return normaliseForStableJson(item);
    });
  }
  if (isPlainRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === "__proto__") continue;
      const item = value[key];
      if (item === undefined || typeof item === "function") continue;
      next[key] = normaliseForStableJson(item);
    }
    return next;
  }
  return value;
}
