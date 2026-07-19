// Pure core for the /goal extension: command/option parsing, event-sourced state,
// the self-driving truth table, completion auditing, and token metering. No pi
// imports, no I/O, no clock — every function here is deterministic so the whole
// decision surface is unit- and property-testable in isolation (functional core;
// the imperative shell lives in index.ts/runtime.ts). The model-/UI-facing copy
// (anchor, kicks, tail, status/widget renderers) lives in prompts.ts, which imports
// this module one-way (core.ts imports nothing back).

// ---------------------------------------------------------------------------
// Constants (decided defaults; see README "Phase 2")
// ---------------------------------------------------------------------------

/** customType used with pi.appendEntry / read back from session entries. */
export const GOAL_ENTRY_TYPE = "goal" as const;

/** Default self-driving token budget (Σ fresh prompt+output tokens). */
export const DEFAULT_TOKEN_BUDGET = 200_000;
/** Hard backstop on auto-continuations before the loop pauses itself. */
export const DEFAULT_MAX_ITERATIONS = 25;
/** A completed run producing fewer output tokens than this counts as "no progress". */
export const NO_PROGRESS_OUTPUT_TOKENS = 50;
/** Consecutive no-progress runs that pause the loop (stuck guard). */
export const NO_PROGRESS_LIMIT = 3;
/** Pause the loop once context usage reaches this percent (pi reports 0–100). */
export const CONTEXT_SAFETY_PERCENT = 95;
/** Cooldown between a run ending and the next auto-continuation (hot-loop guard). */
export const CONTINUATION_COOLDOWN_MS = 2_000;

// ---------------------------------------------------------------------------
// Domain model — tagged unions so illegal states are unrepresentable.
// `mode` carries the auto-only counters: a steer-only goal cannot hold a budget
// or iteration counter (it has nowhere to put one).
// ---------------------------------------------------------------------------

export type GoalStatus = "active" | "paused" | "complete" | "blocked" | "budget_limited";

export type GoalMode =
  | { kind: "steer" }
  | {
      kind: "auto";
      tokenBudget: number;
      maxIterations: number;
      tokensUsed: number;
      iteration: number;
      noProgressCount: number;
    };

export type GoalState = { text: string; status: GoalStatus; mode: GoalMode } | null;

/** Structured stop/pause reasons — never free text, so the widget and /goal status can surface them. */
export type StopReason =
  | "no_goal"
  | "steer_only"
  | "already_terminal"
  | "interrupted"
  | "human_takeover"
  | "error_fatal"
  | "budget"
  | "stuck"
  | "max_iterations"
  | "context_full"
  | "model_complete"
  | "model_blocked";

/** Persisted as the `data` of a `goal` custom session entry, one per command/observation. */
export type GoalEvent =
  | { kind: "set"; text: string; at: number; mode: GoalMode } // mode resolved at parse time
  | { kind: "edit"; text: string; at: number } // preserves status + mode counters
  | { kind: "pause"; at: number }
  | { kind: "resume"; at: number } // resets the runway (D3)
  | { kind: "clear"; at: number }
  | { kind: "progress"; at: number; promptCost: number; outputTokens: number }
  | { kind: "status"; at: number; status: Exclude<GoalStatus, "active">; reason: StopReason };

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

/** Resolved options for a `set`. */
export type GoalOptions = { mode: GoalMode };

/** A flag that failed to parse (errors as values, not thrown). */
export type OptionsError = { field: "tokens" | "max-iterations"; value: string };

/** What the user typed after `/goal`. */
export type GoalCommand =
  | { kind: "show" }
  | { kind: "status" }
  | { kind: "edit" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "clear" }
  | { kind: "set"; text: string; mode: GoalMode }
  | { kind: "set_invalid"; error: OptionsError };

/**
 * Parse a token budget written as `200000`, `200_000`, `200k`, or `1.5m`.
 * Returns a positive integer, or null when the input is not a valid budget.
 */
export function parseTokenBudget(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/[_,]/g, "");
  const match = /^(\d+(?:\.\d+)?)([km]?)$/.exec(cleaned);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : 1;
  const result = Math.round(value * multiplier);
  // Re-check finiteness AFTER the multiply: a huge literal can overflow to Infinity,
  // which would disable the budget cap (finite >= Infinity is always false).
  return Number.isFinite(result) && result > 0 ? result : null;
}

/** Parse a positive integer iteration cap. Returns null when invalid. */
export function parseMaxIterations(raw: string): number | null {
  const cleaned = raw.trim().replace(/[_,]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Parse the raw `/goal` argument string into an objective plus a resolved mode.
 * Recognised flags are stripped from the objective; everything else is the goal
 * text. Absent flags fall to defaults (auto unless --steer-only/--no-auto). An
 * invalid flag value is returned as an error value so the shell can notify.
 */
export function parseGoalOptions(
  rawArgs: string,
  defaultAuto = true,
): { ok: true; text: string; mode: GoalMode } | { ok: false; error: OptionsError } {
  const tokens = rawArgs.trim().split(/\s+/).filter((t) => t.length > 0);
  const words: string[] = [];
  let sawSteer = false;
  let sawAuto = false;
  let tokenBudget: number | null = null;
  let maxIterations: number | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) break;
    // --flag=value, or --flag value (consuming the next token)
    const eq = token.indexOf("=");
    const named = token.startsWith("--");
    const flag = named ? (eq >= 0 ? token.slice(0, eq) : token) : "";
    const inlineValue = eq >= 0 ? token.slice(eq + 1) : undefined;
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        i++;
        return next;
      }
      return undefined;
    };

    switch (flag) {
      case "--steer-only":
      case "--no-auto":
      case "--steer":
        sawSteer = true;
        continue;
      case "--auto":
        sawAuto = true;
        continue;
      case "--tokens":
      case "--budget": {
        const value = takeValue() ?? "";
        const parsed = parseTokenBudget(value);
        if (parsed === null) return { ok: false, error: { field: "tokens", value } };
        tokenBudget = parsed;
        continue;
      }
      case "--max-iterations":
      case "--max-iter": {
        const value = takeValue() ?? "";
        const parsed = parseMaxIterations(value);
        if (parsed === null) return { ok: false, error: { field: "max-iterations", value } };
        maxIterations = parsed;
        continue;
      }
      default:
        words.push(token);
    }
  }

  // Budget flags imply auto. --steer-only wins; otherwise fall to the caller's default.
  const explicitAuto = sawAuto || tokenBudget !== null || maxIterations !== null;
  const steerOnly = sawSteer ? true : explicitAuto ? false : !defaultAuto;
  const text = words.join(" ");
  const mode: GoalMode = steerOnly
    ? { kind: "steer" }
    : {
        kind: "auto",
        tokenBudget: tokenBudget ?? DEFAULT_TOKEN_BUDGET,
        maxIterations: maxIterations ?? DEFAULT_MAX_ITERATIONS,
        tokensUsed: 0,
        iteration: 0,
        noProgressCount: 0,
      };
  return { ok: true, text, mode };
}

/**
 * Parse `/goal` arguments. A reserved word (status/edit/pause/resume/clear) only
 * counts as a subcommand when it is the entire argument — `/goal pause the build`
 * sets a goal whose text happens to start with "pause". Bare `/goal` shows.
 */
export function parseGoalCommand(rawArgs: string, defaultAuto = true): GoalCommand {
  const trimmed = rawArgs.trim();
  if (trimmed === "") return { kind: "show" };
  switch (trimmed.toLowerCase()) {
    case "status":
      return { kind: "status" };
    case "edit":
      return { kind: "edit" };
    case "pause":
      return { kind: "pause" };
    case "resume":
      return { kind: "resume" };
    case "clear":
      return { kind: "clear" };
  }
  const parsed = parseGoalOptions(rawArgs, defaultAuto);
  if (!parsed.ok) return { kind: "set_invalid", error: parsed.error };
  return { kind: "set", text: parsed.text, mode: parsed.mode };
}

// ---------------------------------------------------------------------------
// Defensive parsing of persisted entries (parse, don't cast).
// Guards against malformed data and v1 entries (set without a mode).
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Parse a persisted mode, defaulting a missing/invalid mode to steer (v1 goals never self-drove). */
function parseGoalMode(value: unknown): GoalMode {
  if (!isRecord(value)) return { kind: "steer" };
  if (value["kind"] === "steer") return { kind: "steer" };
  if (value["kind"] === "auto") {
    return {
      kind: "auto",
      tokenBudget: isFiniteNumber(value["tokenBudget"]) ? value["tokenBudget"] : DEFAULT_TOKEN_BUDGET,
      maxIterations: isFiniteNumber(value["maxIterations"]) ? value["maxIterations"] : DEFAULT_MAX_ITERATIONS,
      tokensUsed: isFiniteNumber(value["tokensUsed"]) ? value["tokensUsed"] : 0,
      iteration: isFiniteNumber(value["iteration"]) ? value["iteration"] : 0,
      noProgressCount: isFiniteNumber(value["noProgressCount"]) ? value["noProgressCount"] : 0,
    };
  }
  return { kind: "steer" };
}

const TERMINAL_OR_PAUSED: ReadonlySet<string> = new Set<GoalStatus>([
  "paused",
  "complete",
  "blocked",
  "budget_limited",
]);

const STOP_REASONS: ReadonlySet<string> = new Set<StopReason>([
  "no_goal",
  "steer_only",
  "already_terminal",
  "interrupted",
  "human_takeover",
  "error_fatal",
  "budget",
  "stuck",
  "max_iterations",
  "context_full",
  "model_complete",
  "model_blocked",
]);

/**
 * Parse one persisted goal entry's `data` into a GoalEvent, or null when it is
 * malformed or of an unknown shape. Replaces v1's `entry.data as GoalEvent`.
 */
export function parseGoalEvent(data: unknown): GoalEvent | null {
  if (!isRecord(data)) return null;
  const at = isFiniteNumber(data["at"]) ? data["at"] : 0;
  switch (data["kind"]) {
    case "set":
      if (typeof data["text"] !== "string") return null;
      return { kind: "set", text: data["text"], at, mode: parseGoalMode(data["mode"]) };
    case "edit":
      if (typeof data["text"] !== "string") return null;
      return { kind: "edit", text: data["text"], at };
    case "pause":
      return { kind: "pause", at };
    case "resume":
      return { kind: "resume", at };
    case "clear":
      return { kind: "clear", at };
    case "progress":
      if (!isFiniteNumber(data["promptCost"]) || !isFiniteNumber(data["outputTokens"])) return null;
      return { kind: "progress", at, promptCost: data["promptCost"], outputTokens: data["outputTokens"] };
    case "status":
      if (
        typeof data["status"] !== "string" ||
        !TERMINAL_OR_PAUSED.has(data["status"]) ||
        typeof data["reason"] !== "string" ||
        !STOP_REASONS.has(data["reason"])
      ) {
        return null;
      }
      return {
        kind: "status",
        at,
        status: data["status"] as Exclude<GoalStatus, "active">,
        reason: data["reason"] as StopReason,
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Event-sourced fold (latest wins). Branch-correct across /fork and /tree for
// free because the shell passes the current branch's events in order.
// ---------------------------------------------------------------------------

function resetRunway(mode: GoalMode): GoalMode {
  if (mode.kind === "steer") return mode;
  return { ...mode, tokensUsed: 0, iteration: 0, noProgressCount: 0 };
}

function accumulateProgress(mode: GoalMode, promptCost: number, outputTokens: number): GoalMode {
  if (mode.kind === "steer") return mode;
  return {
    ...mode,
    tokensUsed: mode.tokensUsed + Math.max(0, promptCost),
    iteration: mode.iteration + 1,
    noProgressCount: outputTokens < NO_PROGRESS_OUTPUT_TOKENS ? mode.noProgressCount + 1 : 0,
  };
}

/**
 * Apply one event to the current state — the fold step. Pulled out of reduceGoal's
 * loop so `state` is a parameter rather than a reassigned `let`: the latter defeats
 * TS's narrowing of the `GoalState` (`… | null`) union inside the loop and trips
 * TS2698 on the `{ ...state }` spreads, even though the narrowing is correct at
 * runtime. As a parameter the spreads typecheck cleanly.
 */
function applyGoalEvent(state: GoalState, event: GoalEvent): GoalState {
  switch (event.kind) {
    case "set":
      return { text: event.text, status: "active", mode: event.mode };
    case "edit":
      return state ? { ...state, text: event.text } : state;
    case "pause":
      // Only a driving goal can be paused; never overwrite a terminal status.
      return state && isDriving(state.status) ? { ...state, status: "paused" } : state;
    case "resume":
      // Resume re-activates from paused/budget_limited/blocked (a resumed blocked
      // goal restarts its blocked audit). A `complete` goal stays complete — set a
      // new goal to keep working — so a finished objective is never silently re-driven.
      return state && (state.status === "paused" || state.status === "budget_limited" || state.status === "blocked")
        ? { ...state, status: "active", mode: resetRunway(state.mode) }
        : state;
    case "clear":
      return null;
    case "progress":
      return state && state.mode.kind === "auto"
        ? { ...state, mode: accumulateProgress(state.mode, event.promptCost, event.outputTokens) }
        : state;
    case "status":
      return state ? { ...state, status: event.status } : state;
    default:
      return assertNever(event);
  }
}

/**
 * Fold the current branch's goal events into the active state (latest wins).
 * Returns null when there is no goal (or it was cleared).
 */
export function reduceGoal(events: readonly GoalEvent[]): GoalState {
  let state: GoalState = null;
  for (const event of events) state = applyGoalEvent(state, event);
  return state;
}

// ---------------------------------------------------------------------------
// Token metering & error classification (structural typing — no pi-ai import).
// ---------------------------------------------------------------------------

export interface UsageLike {
  input: number;
  output: number;
  cacheRead: number;
}

export interface MessageLike {
  role: string;
  usage?: UsageLike;
  stopReason?: string;
  errorMessage?: string;
}

function assistantMessages(messages: readonly MessageLike[]): MessageLike[] {
  return messages.filter((m) => m.role === "assistant");
}

/**
 * Fresh (non-cached) prompt + output tokens spent across this run's assistant
 * messages: Σ max(0, input) + max(0, output). pi already reports `usage.input` net
 * of cache reads (cacheRead is a separate, much cheaper bucket across the Anthropic,
 * Google, and OpenAI providers), so we must NOT subtract cacheRead again — doing so
 * collapses the cost to ~0 in the cache-stable steady state and silently defeats the
 * token budget. agent_end carries only the run's new messages, so summing here never
 * double-counts across turns.
 */
export function computePromptCost(messages: readonly MessageLike[]): number {
  let total = 0;
  for (const m of assistantMessages(messages)) {
    const u = m.usage;
    if (!u) continue;
    total += Math.max(0, u.input ?? 0) + Math.max(0, u.output ?? 0);
  }
  return total;
}

/** Output tokens produced this run — the signal behind the no-progress guard. */
export function computeOutputTokens(messages: readonly MessageLike[]): number {
  let total = 0;
  for (const m of assistantMessages(messages)) {
    total += Math.max(0, m.usage?.output ?? 0);
  }
  return total;
}

/** The stop reason of the run's final assistant message, if any. */
export function lastAssistantStopReason(messages: readonly MessageLike[]): string | undefined {
  const assistants = assistantMessages(messages);
  return assistants.at(-1)?.stopReason;
}

/** The error message of the run's final assistant message, if any. */
export function lastAssistantErrorMessage(messages: readonly MessageLike[]): string | undefined {
  const assistants = assistantMessages(messages);
  return assistants.at(-1)?.errorMessage;
}

const RETRYABLE_ERROR = /rate.?limit|overload|throttl|429|50[234]|timed?.?out|etimedout|econnreset|enotfound|eai_again|temporar|try again|service unavailable|capacity|connection (reset|closed)/i;

/**
 * Classify a finished run's outcome. Only `error` stop reasons are errors here
 * (aborts are handled separately). Transient/network errors are classified
 * retryable so the loop keeps going (still bounded by the hard caps in
 * decideContinuation); pi also auto-retries these at the provider layer. Anything
 * not recognisably transient is fatal — the safer default for a self-driving loop.
 */
export function classifyError(
  stopReason: string | undefined,
  errorMessage: string | undefined,
): "none" | "retryable" | "fatal" {
  if (stopReason !== "error") return "none";
  if (errorMessage && RETRYABLE_ERROR.test(errorMessage)) return "retryable";
  return "fatal";
}

// ---------------------------------------------------------------------------
// The self-driving decision (pure truth table).
// ---------------------------------------------------------------------------

export interface ContinuationSignals {
  /** Classification of the run's terminal error, if any. */
  errorClass: "none" | "retryable" | "fatal";
  /** Context usage percent (0–100), or null when unknown. */
  contextPercent: number | null;
}

export type Decision =
  | { action: "continue"; reason: "ok" | "retry" | "budget_wrapup"; mark?: { status: Exclude<GoalStatus, "active">; reason: StopReason } }
  | { action: "pause"; reason: StopReason; mark: { status: Exclude<GoalStatus, "active">; reason: StopReason } }
  | { action: "stop"; reason: StopReason };

/** A driving status is one the loop actively works under. */
export function isDriving(status: GoalStatus): boolean {
  return status === "active" || status === "budget_limited";
}

export function isTerminal(status: GoalStatus): boolean {
  return status === "complete" || status === "blocked";
}

/** The goal tools are live only while an auto goal is actively driving (or wrapping up). */
export function goalToolsShouldBeActive(state: GoalState): boolean {
  return !!state && state.mode.kind === "auto" && isDriving(state.status);
}

/**
 * Decide whether to auto-continue after a run, as a total pure function of the
 * post-progress state and the run's signals. Precedence (highest first):
 *
 *   no-goal → steer-only → status≠active → fatal-error(→blocked) →
 *   budget(→one wrap-up turn) → stuck → max-iterations → context-full → continue
 *
 * Abort and human-takeover are owned by the shell (onAgentEnd pre-empts them via
 * pauseFromLoop, before metering), so they never reach this function.
 *
 * Hard caps (budget/stuck/max-iter/context) sit ABOVE retryable errors so that a
 * persistently-erroring run cannot bypass them and run away — the whole point of
 * the guard set, since the runtime imposes no recursion limit of its own.
 */
export function decideContinuation(state: GoalState, signals: ContinuationSignals): Decision {
  if (!state) return { action: "stop", reason: "no_goal" };
  if (state.mode.kind !== "auto") return { action: "stop", reason: "steer_only" };
  if (state.status !== "active") return { action: "stop", reason: "already_terminal" };

  if (signals.errorClass === "fatal") {
    return { action: "pause", reason: "error_fatal", mark: { status: "blocked", reason: "error_fatal" } };
  }

  const mode = state.mode;
  if (mode.tokensUsed >= mode.tokenBudget) {
    // One more "wrap-up" turn, marked budget_limited so the next run stops.
    return { action: "continue", reason: "budget_wrapup", mark: { status: "budget_limited", reason: "budget" } };
  }
  if (mode.noProgressCount >= NO_PROGRESS_LIMIT) {
    return { action: "pause", reason: "stuck", mark: { status: "paused", reason: "stuck" } };
  }
  if (mode.iteration >= mode.maxIterations) {
    return { action: "pause", reason: "max_iterations", mark: { status: "paused", reason: "max_iterations" } };
  }
  if (signals.contextPercent !== null && signals.contextPercent >= CONTEXT_SAFETY_PERCENT) {
    return { action: "pause", reason: "context_full", mark: { status: "paused", reason: "context_full" } };
  }

  // Retryable errors fall through to a normal continue (caps already checked).
  return { action: "continue", reason: signals.errorClass === "retryable" ? "retry" : "ok" };
}

// ---------------------------------------------------------------------------
// Completion auditing (the update_goal tool's decision lives here, in core;
// the tool's execute only translates the result into pi's error channel).
// ---------------------------------------------------------------------------

// Negation guard so success phrasing ("no remaining work", "nothing still needs
// doing") is not mistaken for an admission of incomplete work.
const NEG = "(?<!\\b(?:no|zero|without|nothing|never|not)\\s)";

// Patterns that always indicate unfinished work, regardless of the objective.
const ALWAYS_CONTRADICTS = [
  /\bnot\s+(yet\s+)?(complete|completed|done|finished|working)\b/i,
  /\b(tests?|build|ci|lints?|checks?)\s+(are\s+|is\s+|still\s+|currently\s+)*(fail|fails|failing|failed|broke|broken|red)\b/i,
  new RegExp(`${NEG}\\bstill\\s+(need|needs|needed|have to|to\\b)`, "i"),
  new RegExp(`${NEG}\\b(remaining|outstanding|leftover)\\s+(work|tasks?|items?|steps?)\\b`, "i"),
  /\b(does\s*n[o']?t|do\s*n[o']?t|cannot|can\s*not|couldn[o']?t)\s+(yet\s+)?work\b/i,
];

// Marker words that signal incompleteness only when they are NOT part of the
// objective's own vocabulary (a goal "add a TODO list" or "partial streaming" must
// be allowed to describe its finished deliverable using those words).
const VOCAB_CONTRADICTS: { re: RegExp; words: string[] }[] = [
  { re: /\bpartially\b/i, words: ["partial"] },
  { re: /\b(todo|fixme|wip)\b/i, words: ["todo", "fixme", "wip"] },
];

/**
 * Cheap regex backstop: does a "complete" summary contradict actually being done?
 * Negation-aware (so "no remaining work" passes) and objective-aware (so marker words
 * that appear in the objective itself are not treated as admissions).
 */
export function summaryContradictsCompletion(summary: string, objective = ""): boolean {
  if (ALWAYS_CONTRADICTS.some((re) => re.test(summary))) return true;
  const obj = objective.toLowerCase();
  return VOCAB_CONTRADICTS.some(({ re, words }) => re.test(summary) && !words.some((w) => obj.includes(w)));
}

/**
 * Decide whether a model-issued update_goal is accepted. Returns the status event
 * to persist, or an error message for the model. Rejects a `complete` whose own
 * summary admits the work is unfinished (the regex backstop).
 */
export function decideCompletion(
  state: GoalState,
  status: "complete" | "blocked",
  summary: string,
  at: number,
): { ok: true; event: GoalEvent } | { ok: false; message: string } {
  if (!state) return { ok: false, message: "No active goal to update." };
  if (state.mode.kind !== "auto") {
    return { ok: false, message: "update_goal is only available for self-driving goals." };
  }
  if (isTerminal(state.status)) {
    return { ok: false, message: `Goal is already ${state.status}.` };
  }
  if (status === "complete" && summaryContradictsCompletion(summary, state.text)) {
    return {
      ok: false,
      message:
        "Completion rejected: your summary indicates the work is not actually finished " +
        "(it mentions failing tests, TODOs, partial/remaining work, or 'not complete'). " +
        "Keep working and only mark the goal complete once every requirement is verified against current state.",
    };
  }
  const reason: StopReason = status === "complete" ? "model_complete" : "model_blocked";
  return { ok: true, event: { kind: "status", at, status, reason } };
}

/** Exhaustiveness guard — turns a new unhandled variant into a compile error. */
export function assertNever(value: never): never {
  throw new Error(`Unreachable goal variant: ${JSON.stringify(value)}`);
}
