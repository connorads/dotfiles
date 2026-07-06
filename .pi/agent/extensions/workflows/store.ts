import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  MAX_WORKFLOW_SOURCE_CHARS,
} from "./parser.ts";
import {
  parseRunId,
  parseWorkflowName,
  sha256,
  toJsonValue,
  type JsonValue,
  type ResolvedWorkflowSource,
  type RunId,
  type WorkflowJournalEntry,
  type WorkflowName,
  type WorkflowRunSnapshot,
  type WorkflowSourceRef,
} from "./domain.ts";
import { err, ok, type Result } from "./result.ts";

/** Durable store and source provider for Pi workflow runs. */
export interface WorkflowStore {
  readonly projectKey: string;
  resolveSource(ref: WorkflowSourceRef): Promise<Result<ResolvedWorkflowSource, WorkflowStoreError>>;
  listWorkflowNames(): Promise<string[]>;
  createRun(snapshot: WorkflowRunSnapshot, script: string): Promise<void>;
  updateRun(snapshot: WorkflowRunSnapshot): Promise<void>;
  readRun(runId: RunId): Promise<Result<WorkflowRunSnapshot, WorkflowStoreError>>;
  readRunScript(runId: RunId): Promise<Result<string, WorkflowStoreError>>;
  listRuns(): Promise<WorkflowRunSnapshot[]>;
  appendJournal(runId: RunId, entry: WorkflowJournalEntry): Promise<void>;
  readJournal(runId: RunId): Promise<WorkflowJournalEntry[]>;
}

export class WorkflowStoreError extends Error {
  readonly _tag = "WorkflowStoreError";
}

/** Create a filesystem-backed workflow store for a cwd. */
export function createWorkflowStore(cwd: string, root = join(homedir(), ".pi", "agent", "workflows")): WorkflowStore {
  const resolvedCwd = resolve(cwd);
  const projectKey = workflowProjectKey(resolvedCwd);
  const projectRoot = join(root, "projects", projectKey);
  const runsRoot = join(projectRoot, "runs");
  const userScriptsDir = join(root, "scripts");
  const projectScriptsDir = resolve(resolvedCwd, ".pi", "workflows");

  const runDir = (runId: RunId): string => join(runsRoot, runId);
  const snapshotPath = (runId: RunId): string => join(runDir(runId), "run.json");
  const scriptPath = (runId: RunId): string => join(runDir(runId), "script.js");
  const journalPath = (runId: RunId): string => join(runDir(runId), "journal.jsonl");

  return {
    projectKey,

    async resolveSource(ref) {
      try {
        switch (ref.kind) {
          case "inline":
            return ok({
              ref,
              source: ref.script,
              sourceHash: sha256(ref.script),
              displayName: "inline workflow",
            });
          case "path": {
            const file = resolve(resolvedCwd, ref.scriptPath);
            const source = await readWorkflowFile(file);
            if (!source.ok) return source;
            return ok({
              ref,
              source: source.value,
              sourceHash: sha256(source.value),
              displayName: basename(file),
              scriptPath: file,
            });
          }
          case "name": {
            const candidates = namedWorkflowCandidates(ref.name, projectScriptsDir, userScriptsDir);
            for (const candidate of candidates) {
              const source = await readWorkflowFile(candidate);
              if (source.ok) {
                return ok({
                  ref,
                  source: source.value,
                  sourceHash: sha256(source.value),
                  displayName: ref.name,
                  scriptPath: candidate,
                });
              }
            }
            const available = await listNames([projectScriptsDir, userScriptsDir]);
            const suffix = available.length > 0 ? ` Available: ${available.join(", ")}` : "";
            return err(new WorkflowStoreError(`Workflow not found: ${ref.name}.${suffix}`));
          }
        }
      } catch (error) {
        return err(new WorkflowStoreError(error instanceof Error ? error.message : String(error)));
      }
    },

    listWorkflowNames() {
      return listNames([projectScriptsDir, userScriptsDir]);
    },

    async createRun(snapshot, script) {
      await mkdir(runDir(snapshot.runId), { recursive: true });
      await atomicWrite(scriptPath(snapshot.runId), script);
      await atomicWrite(snapshotPath(snapshot.runId), JSON.stringify(snapshot, null, 2));
    },

    async updateRun(snapshot) {
      await mkdir(runDir(snapshot.runId), { recursive: true });
      await atomicWrite(snapshotPath(snapshot.runId), JSON.stringify(snapshot, null, 2));
    },

    async readRun(runId) {
      try {
        const raw = JSON.parse(await readFile(snapshotPath(runId), "utf8")) as unknown;
        const parsed = parseStoredRun(raw);
        return parsed.ok ? ok(parsed.value) : err(new WorkflowStoreError(parsed.error.message));
      } catch (error) {
        return err(new WorkflowStoreError(error instanceof Error ? error.message : String(error)));
      }
    },

    async readRunScript(runId) {
      return readWorkflowFile(scriptPath(runId));
    },

    async listRuns() {
      try {
        const entries = await readdir(runsRoot, { withFileTypes: true });
        const runs: WorkflowRunSnapshot[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const id = parseRunId(entry.name);
          if (!id.ok) continue;
          const run = await this.readRun(id.value);
          if (run.ok) runs.push(run.value);
        }
        return runs.sort((a, b) => b.updatedAt - a.updatedAt);
      } catch {
        return [];
      }
    },

    async appendJournal(runId, entry) {
      await mkdir(runDir(runId), { recursive: true });
      await appendFile(journalPath(runId), `${JSON.stringify(entry)}\n`, "utf8");
    },

    async readJournal(runId) {
      try {
        const text = await readFile(journalPath(runId), "utf8");
        const entries: WorkflowJournalEntry[] = [];
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          const parsed = parseJournalEntry(JSON.parse(line) as unknown);
          if (parsed) entries.push(parsed);
        }
        return entries;
      } catch {
        return [];
      }
    },
  };
}

/** Stable project key matching the local Pi extension convention. */
export function workflowProjectKey(cwd: string): string {
  const slug = sanitizePathSegment(basename(resolve(cwd)) || "project");
  const hash = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 12);
  return `${slug}-${hash}`;
}

async function readWorkflowFile(file: string): Promise<Result<string, WorkflowStoreError>> {
  try {
    if (!isAbsolute(file)) return err(new WorkflowStoreError("Workflow script path must resolve to an absolute path"));
    const info = await stat(file);
    if (!info.isFile()) return err(new WorkflowStoreError(`Workflow path is not a file: ${file}`));
    if (info.size > MAX_WORKFLOW_SOURCE_CHARS) {
      return err(new WorkflowStoreError(`Workflow script exceeds ${MAX_WORKFLOW_SOURCE_CHARS} bytes: ${file}`));
    }
    return ok(await readFile(file, "utf8"));
  } catch (error) {
    return err(new WorkflowStoreError(error instanceof Error ? error.message : String(error)));
  }
}

function namedWorkflowCandidates(name: WorkflowName, projectDir: string, userDir: string): string[] {
  return [resolve(projectDir, `${name}.js`), resolve(userDir, `${name}.js`)];
}

async function listNames(dirs: readonly string[]): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
        const parsed = parseWorkflowName(entry.name);
        if (parsed.ok) names.add(parsed.value);
      }
    } catch {
      // Missing source directories are normal.
    }
  }
  return [...names].sort();
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return sanitized || "project";
}

function parseStoredRun(value: unknown): Result<WorkflowRunSnapshot, Error> {
  if (!isRecord(value)) return err(new Error("Stored workflow run is not an object"));
  if (value.schemaVersion !== 1) return err(new Error("Unsupported workflow run schema"));
  if (typeof value.runId !== "string") return err(new Error("Stored run id is missing"));
  const runId = parseRunId(value.runId);
  if (!runId.ok) return err(runId.error);
  return ok({
    schemaVersion: 1,
    runId: runId.value,
    projectKey: stringField(value.projectKey),
    cwd: stringField(value.cwd),
    status: parseStatus(value.status),
    workflowName: stringField(value.workflowName),
    sourceKind: parseSourceKind(value.sourceKind),
    sourceHash: stringField(value.sourceHash),
    scriptPath: optionalString(value.scriptPath),
    scriptFile: stringField(value.scriptFile),
    args: parseJsonField(value.args),
    meta: parseJsonField(value.meta),
    budgetTotal: typeof value.budgetTotal === "number" ? value.budgetTotal : null,
    budgetSpent: numberField(value.budgetSpent),
    agentCalls: numberField(value.agentCalls),
    phases: stringArray(value.phases),
    logs: stringArray(value.logs),
    summary: optionalString(value.summary),
    result: value.result === undefined ? undefined : parseJsonField(value.result),
    error: optionalString(value.error),
    startedAt: numberField(value.startedAt),
    updatedAt: numberField(value.updatedAt),
    completedAt: optionalNumber(value.completedAt),
  });
}

function parseJournalEntry(value: unknown): WorkflowJournalEntry | undefined {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.replayKey !== "string") return undefined;
  if (value.kind === "agent_started") {
    return {
      kind: "agent_started",
      at: numberField(value.at),
      replayKey: value.replayKey as WorkflowJournalEntry["replayKey"],
      index: numberField(value.index),
      prompt: stringField(value.prompt),
      label: optionalString(value.label),
      phase: optionalString(value.phase),
    };
  }
  if (value.kind === "agent_result") {
    return {
      kind: "agent_result",
      at: numberField(value.at),
      replayKey: value.replayKey as WorkflowJournalEntry["replayKey"],
      value: parseJsonField(value.value),
      outputTokens: numberField(value.outputTokens),
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseJsonField(value: unknown): JsonValue {
  return toJsonValue(value) ?? null;
}

function parseStatus(value: unknown): WorkflowRunSnapshot["status"] {
  return value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "stopped"
    ? value
    : "failed";
}

function parseSourceKind(value: unknown): WorkflowSourceRef["kind"] {
  return value === "inline" || value === "path" || value === "name" ? value : "inline";
}
