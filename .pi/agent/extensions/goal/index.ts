// Imperative shell for the /goal extension. Phase 2 turns the v1 static anchor into
// a self-driving loop: setting an auto goal kicks a continuation each turn until the
// objective is complete, blocked, or out of budget — bounded by a token budget, a
// max-iteration backstop, a no-progress guard, a context-full guard, and a cooldown.
//
// Structure follows functional-core / imperative-shell + ports & adapters:
//   - core.ts      — all decisions (pure, event-sourced, deterministic)
//   - runtime.ts   — the GoalRuntime port + the real pi adapter (the only pi/ctx touch)
//   - this file    — the engine (volatile flags + orchestration over GoalRuntime) and
//                    the pi wiring (pi.on / registerCommand / registerTool).
//
// The engine takes a GoalRuntime per call, so it is driven in tests by a type-honest
// in-memory fake (no `as` cast). pi types are imported type-only (erased at runtime),
// so — like core.ts and runtime.ts — this module's only runtime dependency is ./core.ts.
import type {
  AgentEndEvent,
  AgentMessage,
  BeforeAgentStartEvent,
  ContextEvent,
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import {
  BUDGET_WRAPUP_KICK,
  CONTINUATION_COOLDOWN_MS,
  CONTINUATION_KICK,
  type GoalEvent,
  type GoalMode,
  type GoalState,
  classifyError,
  computeOutputTokens,
  computePromptCost,
  decideCompletion,
  decideContinuation,
  goalToolsShouldBeActive,
  isDriving,
  isTerminal,
  lastAssistantErrorMessage,
  lastAssistantStopReason,
  parseGoalCommand,
  reduceGoal,
  renderGoalBlock,
  renderGoalStatus,
  renderGoalTail,
} from "./core.ts";
import { createPiRuntime, type GoalRuntime } from "./runtime.ts";

// ---------------------------------------------------------------------------
// Structural message shape used by the tail injector. A faithful subset of pi's
// AgentMessage (role/content/timestamp) so the engine stays decoupled from pi and
// testable with plain objects.
// ---------------------------------------------------------------------------

type TextBlock = { type: "text"; text: string };
interface ChatMessage {
  role: string;
  content: unknown;
  timestamp?: number;
}

/**
 * Append the goal tail to the trailing user message (or, if the last message is
 * not a user message, as a new trailing user message). Merging avoids two
 * consecutive user messages, which pi forwards verbatim to the provider. Operates
 * on a deep copy — the live session entries are never mutated.
 */
function appendGoalTail(messages: readonly ChatMessage[], tail: string, at: number): ChatMessage[] {
  const copy: ChatMessage[] = messages.map((m) => ({ ...m, content: cloneContent(m.content) }));
  const last = copy[copy.length - 1];
  const block: TextBlock = { type: "text", text: tail };
  if (last && last.role === "user") {
    last.content = appendBlock(last.content, block);
    return copy;
  }
  copy.push({ role: "user", content: [block], timestamp: at });
  return copy;
}

function cloneContent(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === "object" && b !== null ? { ...b } : b));
  return content;
}

function appendBlock(content: unknown, block: TextBlock): unknown {
  if (typeof content === "string") return [{ type: "text", text: content }, block];
  if (Array.isArray(content)) return [...content, block];
  return [block];
}

// ---------------------------------------------------------------------------
// The engine: volatile (reset-on-reload) flags + orchestration. Every method
// takes a GoalRuntime so the real adapter can be rebuilt per pi event while the
// flags persist across the session.
// ---------------------------------------------------------------------------

export interface GoalEngine {
  beforeAgentStart(rt: GoalRuntime, systemPrompt: string): string | undefined;
  onContext(rt: GoalRuntime, messages: readonly ChatMessage[]): ChatMessage[] | undefined;
  onAgentStart(): void;
  onTurnStart(): void;
  onAgentEnd(rt: GoalRuntime, messages: readonly MeteredMessage[]): Promise<void>;
  onInput(source: string, text: string): void;
  refresh(rt: GoalRuntime): void;
  onSessionTree(rt: GoalRuntime): void;
  onShutdown(rt: GoalRuntime): void;
  applySet(rt: GoalRuntime, text: string, mode: GoalMode): void;
  applyEdit(rt: GoalRuntime, text: string): void;
  applyPause(rt: GoalRuntime): void;
  applyResume(rt: GoalRuntime): void;
  applyClear(rt: GoalRuntime): void;
  execUpdateGoal(rt: GoalRuntime, status: "complete" | "blocked", summary: string): ToolReply;
  execGetGoal(rt: GoalRuntime): ToolReply;
}

/** The metering view of agent_end messages (assistant usage/stop reason). */
type MeteredMessage = Parameters<typeof computePromptCost>[0][number];

interface ToolReply {
  content: TextBlock[];
  details: unknown;
}

export function createGoalEngine(): GoalEngine {
  // Volatile flags — intentionally NOT event-sourced; they reset on reload, which
  // is correct (an in-flight continuation or takeover does not survive a restart).
  let continuationInFlight = false;
  let humanTookOver = false;
  let tailGate = false;
  // Loop-ownership epoch: bumped by every event that re-claims or drops the loop
  // (agent_start, session_tree, set/resume/pause/clear). onAgentEnd captures it before
  // its cooldown sleep and bails if it changed — so a command run during the ~2s
  // cooldown (which yields the event loop) cannot be double-kicked by a stale continuation.
  let epoch = 0;
  const bumpEpoch = (): void => {
    epoch += 1;
  };

  const syncUi = (rt: GoalRuntime): GoalState => {
    const state = reduceGoal(rt.readEvents());
    rt.showStatus(state);
    rt.setGoalToolsActive(goalToolsShouldBeActive(state));
    return state;
  };

  const kick = (rt: GoalRuntime, message: string): void => {
    continuationInFlight = true;
    rt.sendContinuation(message);
  };

  const pauseFromLoop = (rt: GoalRuntime, reason: "interrupted" | "human_takeover"): void => {
    rt.record({ kind: "status", at: rt.now(), status: "paused", reason });
    syncUi(rt);
    continuationInFlight = false;
  };

  return {
    beforeAgentStart(rt, systemPrompt) {
      const state = reduceGoal(rt.readEvents());
      if (state && isDriving(state.status)) {
        return systemPrompt + renderGoalBlock(state.text, state.mode);
      }
      return undefined;
    },

    onContext(rt, messages) {
      if (!tailGate) return undefined;
      const state = reduceGoal(rt.readEvents());
      if (!state || state.mode.kind !== "auto" || !isDriving(state.status)) return undefined;
      const tail = renderGoalTail(state);
      if (!tail) return undefined;
      tailGate = false;
      return appendGoalTail(messages, tail, rt.now());
    },

    onAgentStart() {
      bumpEpoch();
      continuationInFlight = false;
      tailGate = true;
    },

    onTurnStart() {
      tailGate = true;
    },

    async onAgentEnd(rt, messages) {
      // Re-entrancy / dedup guard: a second agent_end before the next agent_start
      // (which clears the flag) must not record a second progress or continuation.
      if (continuationInFlight) return;

      const before = reduceGoal(rt.readEvents());
      if (!before || before.mode.kind !== "auto" || !isDriving(before.status)) return;

      const stopReason = lastAssistantStopReason(messages);
      // Aborted (Esc) or human takeover: pause without counting the turn.
      if (stopReason === "aborted") return pauseFromLoop(rt, "interrupted");
      if (humanTookOver) return pauseFromLoop(rt, "human_takeover");

      // Count the turn (event-sourced metering), then re-fold.
      rt.record({
        kind: "progress",
        at: rt.now(),
        promptCost: computePromptCost(messages),
        outputTokens: computeOutputTokens(messages),
      });
      const state = reduceGoal(rt.readEvents());
      // The model may have flipped status via update_goal, or this was the budget
      // wrap-up turn — either way, only an active goal keeps driving.
      if (!state || state.status !== "active") {
        syncUi(rt);
        return;
      }

      const decision = decideContinuation(state, {
        aborted: false,
        humanTookOver: false,
        errorClass: classifyError(stopReason, lastAssistantErrorMessage(messages)),
        contextPercent: rt.contextPercent(),
      });
      if (decision.mark) {
        rt.record({ kind: "status", at: rt.now(), status: decision.mark.status, reason: decision.mark.reason });
      }
      syncUi(rt);
      if (decision.action !== "continue") return;

      // Commit to continuing: claim the flag + epoch, cool down, then re-check.
      continuationInFlight = true;
      const myEpoch = epoch;
      await rt.sleep(CONTINUATION_COOLDOWN_MS);
      // Another path took over the loop during the cooldown (a new goal, resume, pause,
      // clear, or tree navigation): it already owns the flag and did any kicking. Bail
      // without touching the flag so we don't double-kick or clobber the new owner.
      if (myEpoch !== epoch) return;
      // Still our continuation, but the goal may have stopped driving meanwhile.
      const after = reduceGoal(rt.readEvents());
      if (!after || after.mode.kind !== "auto" || !isDriving(after.status) || humanTookOver) {
        continuationInFlight = false;
        return;
      }
      rt.sendContinuation(decision.reason === "budget_wrapup" ? BUDGET_WRAPUP_KICK : CONTINUATION_KICK);
      // Leave the flag set; the kicked turn's agent_start clears it.
    },

    onInput(source, text) {
      // A human typing (not a slash command, not our own extension messages) takes
      // manual control: the loop yields until /goal resume. Never blocks the input.
      if (source === "interactive" && !text.startsWith("/")) {
        humanTookOver = true;
      }
    },

    refresh(rt) {
      syncUi(rt);
    },

    onSessionTree(rt) {
      // A tree/fork navigation lands on a different branch: drop any in-flight
      // continuation and takeover, then rebuild widget + tool state from the branch.
      bumpEpoch();
      continuationInFlight = false;
      humanTookOver = false;
      syncUi(rt);
    },

    onShutdown(rt) {
      rt.showStatus(null);
    },

    applySet(rt, text, mode) {
      bumpEpoch();
      humanTookOver = false;
      rt.record({ kind: "set", text, at: rt.now(), mode });
      syncUi(rt);
      if (mode.kind === "auto") kick(rt, CONTINUATION_KICK);
    },

    applyEdit(rt, text) {
      // Editing the objective does not change loop ownership — an in-flight
      // continuation should still fire (the kick is generic), so no epoch bump.
      rt.record({ kind: "edit", text, at: rt.now() });
      syncUi(rt);
    },

    applyPause(rt) {
      bumpEpoch();
      rt.record({ kind: "pause", at: rt.now() });
      syncUi(rt);
      continuationInFlight = false;
    },

    applyResume(rt) {
      bumpEpoch();
      humanTookOver = false;
      rt.record({ kind: "resume", at: rt.now() });
      const state = syncUi(rt);
      if (state && state.mode.kind === "auto" && state.status === "active") kick(rt, CONTINUATION_KICK);
    },

    applyClear(rt) {
      bumpEpoch();
      rt.record({ kind: "clear", at: rt.now() });
      syncUi(rt);
      continuationInFlight = false;
      humanTookOver = false;
    },

    execUpdateGoal(rt, status, summary) {
      const result = decideCompletion(reduceGoal(rt.readEvents()), status, summary, rt.now());
      if (!result.ok) {
        // Surface as a tool error so the model sees the rejection and keeps working.
        throw new Error(result.message);
      }
      rt.record(result.event);
      syncUi(rt);
      return {
        content: [{ type: "text", text: `Goal marked ${status}.` }],
        details: { status },
      };
    },

    execGetGoal(rt) {
      const state = reduceGoal(rt.readEvents());
      return {
        content: [{ type: "text", text: renderGoalStatus(state) }],
        details: {
          status: state?.status ?? null,
          mode: state?.mode.kind ?? null,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool schemas. Plain JSON Schema objects rather than TypeBox — pi's validator
// (pi-ai validation.js) has an explicit branch for schemas without TypeBox
// metadata, so this keeps the extension's only runtime dependency ./core.ts and
// keeps the tests free of a `typebox` import. See README "Phase 2" (ADR).
const UPDATE_GOAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary"],
  properties: {
    status: {
      type: "string",
      enum: ["complete", "blocked"],
      description:
        'Set "complete" only when the objective is achieved and every requirement is verified against current ' +
        'state. Set "blocked" only after the same blocking condition has recurred for at least three consecutive ' +
        "goal turns and you are at an impasse. You cannot pause/resume/budget-limit a goal with this tool.",
    },
    summary: {
      type: "string",
      description:
        "Evidence-based summary: for complete, the requirement-by-requirement evidence that proves it; for blocked, " +
        "the specific blocking condition and what is needed to unblock.",
    },
  },
};

const GET_GOAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

// SAFETY: pi's tool `parameters` is typed as TypeBox's TSchema, but pi accepts a
// plain JSON Schema object at runtime (pi-ai validation.js compiles/checks schemas
// that lack TypeBox metadata). This single documented cast keeps the runtime
// dependency-free; verified by a probe against the real validator.
const asSchema = (schema: object): TSchema => schema as unknown as TSchema;

// ---------------------------------------------------------------------------
// pi wiring.
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  const engine = createGoalEngine();
  const rtOf = (ctx: ExtensionContext): GoalRuntime => createPiRuntime(pi, ctx);

  // Optional global opt-out: `pi --no-auto` makes new goals steer-only by default.
  pi.registerFlag("no-auto", {
    description: "Default new /goal objectives to steer-only (no auto-continuation)",
    type: "boolean",
    default: false,
  });
  const defaultAuto = (): boolean => pi.getFlag("no-auto") !== true;

  // Rebuild widget + tool state whenever the active branch changes.
  pi.on("session_start", (_event, ctx) => engine.refresh(rtOf(ctx)));
  pi.on("session_tree", (_event, ctx) => engine.onSessionTree(rtOf(ctx)));
  pi.on("session_shutdown", (_event, ctx) => engine.onShutdown(rtOf(ctx)));

  // D4: the anchor + tail re-inject the objective/status every post-compaction
  // turn, so compaction needs no special handling.
  pi.on("session_before_compact", () => undefined);

  // Re-state an active goal into the system prompt each turn (cache-stable anchor).
  pi.on("before_agent_start", (event: BeforeAgentStartEvent, ctx) => {
    const systemPrompt = engine.beforeAgentStart(rtOf(ctx), event.systemPrompt);
    return systemPrompt ? { systemPrompt } : undefined;
  });

  // Inject the volatile per-turn tail (budget countdown / wrap-up) into the live
  // message list, once per turn.
  pi.on("context", (event: ContextEvent, ctx) => {
    const messages = engine.onContext(rtOf(ctx), event.messages);
    // SAFETY: onContext returns the same structural shape it received (AgentMessage
    // fields role/content/timestamp), only appending a well-formed user message.
    return messages ? { messages: messages as unknown as AgentMessage[] } : undefined;
  });

  pi.on("agent_start", () => engine.onAgentStart());
  pi.on("turn_start", () => engine.onTurnStart());
  pi.on("agent_end", (event: AgentEndEvent, ctx) => engine.onAgentEnd(rtOf(ctx), event.messages));

  pi.on("input", (event: InputEvent) => {
    engine.onInput(event.source, event.text);
  });

  const updateGoalTool: ToolDefinition = {
    name: "update_goal",
    label: "Update Goal",
    description:
      "Update the active self-driving goal. Use only to mark the goal achieved or genuinely blocked. " +
      'Set status "complete" only when the objective has actually been achieved and no required work remains. ' +
      'Set status "blocked" only when the same blocking condition has repeated for at least three consecutive ' +
      "goal turns (counting the original turn and any automatic continuations) and you cannot make progress " +
      "without user input or an external-state change. Do not mark complete merely because the budget is nearly " +
      "exhausted or because you are stopping work.",
    parameters: asSchema(UPDATE_GOAL_SCHEMA),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { status, summary } = params as { status: "complete" | "blocked"; summary: string };
      return engine.execUpdateGoal(rtOf(ctx), status, summary);
    },
  };

  const getGoalTool: ToolDefinition = {
    name: "get_goal",
    label: "Get Goal",
    description: "Get the active goal's objective, status, and remaining token/iteration budget.",
    parameters: asSchema(GET_GOAL_SCHEMA),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      return engine.execGetGoal(rtOf(ctx));
    },
  };
  pi.registerTool(updateGoalTool);
  pi.registerTool(getGoalTool);

  pi.registerCommand("goal", {
    description:
      "Set a persistent, self-driving objective (auto-continuation by default; --steer-only for v1 anchor-only)",
    handler: async (args, ctx) => {
      const rt = rtOf(ctx);
      const command = parseGoalCommand(args, defaultAuto());
      const current = reduceGoal(rt.readEvents());

      switch (command.kind) {
        case "show":
          ctx.ui.notify(
            current
              ? `Goal${current.status === "active" ? "" : ` (${current.status})`}: ${current.text}`
              : "No active goal. Set one with /goal <objective>.",
            "info",
          );
          return;

        case "status":
          ctx.ui.notify(renderGoalStatus(current), current ? "info" : "warning");
          return;

        case "set":
          if (!command.text) {
            ctx.ui.notify("Usage: /goal <objective>  [--steer-only] [--tokens 200k] [--max-iterations 25]", "warning");
            return;
          }
          engine.applySet(rt, command.text, command.mode);
          ctx.ui.notify(
            command.mode.kind === "auto"
              ? `Goal set (self-driving, budget ${command.mode.tokenBudget} tokens / ${command.mode.maxIterations} iterations): ${command.text}`
              : `Goal set (steer-only): ${command.text}`,
            "info",
          );
          return;

        case "set_invalid":
          ctx.ui.notify(`Invalid --${command.error.field} value: "${command.error.value}".`, "warning");
          return;

        case "edit": {
          if (!current) {
            ctx.ui.notify("No goal to edit. Set one with /goal <objective>.", "warning");
            return;
          }
          if (!ctx.hasUI) {
            ctx.ui.notify("Editing the goal needs an interactive UI.", "warning");
            return;
          }
          const edited = (await ctx.ui.editor("Edit goal", current.text))?.trim();
          if (!edited || edited === current.text) {
            ctx.ui.notify("Goal unchanged.", "info");
            return;
          }
          engine.applyEdit(rt, edited);
          ctx.ui.notify(`Goal updated: ${edited}`, "info");
          return;
        }

        case "pause":
          if (!current) {
            ctx.ui.notify("No active goal to pause.", "warning");
            return;
          }
          if (current.status === "paused") {
            ctx.ui.notify("Goal is already paused.", "info");
            return;
          }
          if (isTerminal(current.status)) {
            ctx.ui.notify(`Goal is already ${current.status}; nothing to pause.`, "info");
            return;
          }
          engine.applyPause(rt);
          ctx.ui.notify("Goal paused — it will stop steering and self-driving until /goal resume.", "info");
          return;

        case "resume":
          if (!current) {
            ctx.ui.notify("No goal to resume.", "warning");
            return;
          }
          if (current.status === "active") {
            ctx.ui.notify("Goal is already active.", "info");
            return;
          }
          if (current.status === "complete") {
            ctx.ui.notify("Goal is complete — start a new one with /goal <objective> to keep working.", "info");
            return;
          }
          engine.applyResume(rt);
          ctx.ui.notify("Goal resumed (runway reset).", "info");
          return;

        case "clear":
          if (!current) {
            ctx.ui.notify("No active goal to clear.", "info");
            return;
          }
          engine.applyClear(rt);
          ctx.ui.notify("Goal cleared.", "info");
          return;
      }
    },
  });
}
