import type { RunId, WorkflowRunSnapshot } from "./domain.ts";
import { preview } from "./prelude.ts";

/** How long terminal runs stay visible in the widget after completing. */
const WIDGET_LINGER_MS = 60_000;

export const WORKFLOWS_HELP = [
  "Pi workflows - background multi-agent orchestration.",
  "",
  "/workflows list                 list recent project runs",
  "/workflows status [runId]       show a run's status, phase, and budget (defaults to the active/most recent run)",
  "/workflows show [runId]         show full details, logs, and result (defaults like status)",
  "/workflows stop [runId]         stop a running workflow (defaults like status)",
  "/workflows resume [runId]       resume a run, replaying completed agents (defaults like status)",
  "/workflows run <name|path> [json]   launch a named or file workflow",
  "/workflows start <objective>    ask Pi to draft and launch an inline workflow",
  "/workflows help                 show this help",
].join("\n");

/**
 * Default target for run-scoped commands invoked without an id: the single
 * active run when there is exactly one, otherwise the most recent run.
 * `runs` must be sorted most-recently-updated first (as listRuns returns).
 */
export function defaultRunTarget(runs: readonly WorkflowRunSnapshot[]): WorkflowRunSnapshot | undefined {
  const active = runs.filter((run) => run.status === "running" || run.status === "queued");
  if (active.length === 1) return active[0];
  return runs[0];
}

/** Widget lines: live runs plus terminal runs that completed in the last minute. */
export function renderWidget(runs: readonly WorkflowRunSnapshot[], now: number): string[] {
  const interesting = runs
    .filter(
      (run) =>
        run.status === "running" ||
        run.status === "queued" ||
        (run.completedAt !== undefined && now - run.completedAt < WIDGET_LINGER_MS),
    )
    .slice(0, 3);
  if (interesting.length === 0) return [];
  return [
    "Project workflows",
    ...interesting.map((run) => {
      const phase = currentPhase(run);
      const detail = [`agents ${run.agentCalls}`, phase ? `phase ${phase}` : undefined, `${relativeTime(run.updatedAt, now)} ago`]
        .filter(Boolean)
        .join(", ");
      return `${run.status} ${run.runId} ${run.workflowName} (${detail})`;
    }),
  ];
}

export function renderRuns(runs: readonly WorkflowRunSnapshot[], now: number): string {
  if (runs.length === 0) return "No project workflow runs. Start one with /workflows run <name> or /workflow <objective>.";
  const rows = runs.slice(0, 12).map((run) => {
    const detail = [`agents ${run.agentCalls}`];
    if (run.budgetTotal !== null) detail.push(`budget ${run.budgetSpent}/${run.budgetTotal}`);
    const phase = currentPhase(run);
    if (phase) detail.push(`phase ${phase}`);
    return `${run.runId}  ${run.status.padEnd(9)}  ${relativeTime(run.updatedAt, now).padStart(7)}  ${run.workflowName}  (${detail.join(", ")})`;
  });
  return [`Project workflow runs (${runs.length})`, ...rows].join("\n");
}

export function renderRun(run: WorkflowRunSnapshot, active: boolean, now: number): string {
  const live = active ? " active" : "";
  const header = `${run.runId} ${run.status}${live}: ${run.workflowName}`;
  const progress =
    run.status === "running" || run.status === "queued"
      ? `agents ${run.agentCalls}${currentPhase(run) ? `, phase ${currentPhase(run)}` : ""}${run.budgetTotal !== null ? `, budget ${run.budgetSpent}/${run.budgetTotal}` : ""}`
      : undefined;
  return [header, timing(run, now), progress, run.summary, failedOrStoppedHint(run)]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
}

export function renderRunDetails(run: WorkflowRunSnapshot, runDir: string, now: number): string {
  const lines = [
    `${run.runId} ${run.status}: ${run.workflowName}`,
    timing(run, now),
    `cwd: ${run.cwd}`,
    `run dir: ${runDir}`,
    `agents: ${run.agentCalls}`,
    `budget: ${run.budgetTotal === null ? "uncapped" : `${run.budgetSpent}/${run.budgetTotal}`}`,
    run.summary ? `summary: ${run.summary}` : undefined,
    run.error ? `error: ${run.error}` : undefined,
    failedOrStoppedHint(run),
    run.logs.length > 0 ? `logs:\n${run.logs.slice(-20).join("\n")}` : undefined,
    run.result !== undefined ? `result:\n${preview(JSON.stringify(run.result, null, 2), 2000)}` : undefined,
  ].filter((line): line is string => typeof line === "string");
  return lines.join("\n");
}

export function renderCompletionMessage(run: WorkflowRunSnapshot, runDir: string): string {
  const status = run.status === "completed" ? "completed" : run.status;
  const body = run.summary ?? run.error ?? "";
  return [
    `Workflow ${status}: ${run.workflowName}`,
    `Run: ${run.runId}`,
    preview(body, 1200),
    failedOrStoppedHint(run),
    `Details: /workflows show ${run.runId}`,
    `Run dir: ${runDir}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Shared failed/stopped recovery line for completion messages and renders. */
export function recoveryHint(runId: RunId): string {
  return `Recover: edit the pinned script and run /workflows resume ${runId} - completed agents replay from the journal.`;
}

/** Compact relative time such as "3m" or "2h" for run listings. */
export function relativeTime(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** The most recent runtime phase, if any. */
function currentPhase(run: WorkflowRunSnapshot): string | undefined {
  return run.phases.length > 0 ? run.phases[run.phases.length - 1] : undefined;
}

function timing(run: WorkflowRunSnapshot, now: number): string {
  const end = run.completedAt ?? now;
  return `elapsed ${relativeTime(run.startedAt, end)}, last activity ${relativeTime(run.updatedAt, now)} ago`;
}

function failedOrStoppedHint(run: WorkflowRunSnapshot): string | undefined {
  return run.status === "failed" || run.status === "stopped" ? recoveryHint(run.runId) : undefined;
}
