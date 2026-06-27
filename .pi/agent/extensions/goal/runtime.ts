// The narrow boundary between the goal orchestration and pi (ports & adapters).
//
// The engine in index.ts depends only on the domain-named `GoalRuntime` port —
// verbs like `record`, `sendContinuation`, `contextPercent` — never on pi's
// `ExtensionAPI`/`ExtensionContext` directly. That keeps the engine testable with
// a type-honest fake (no `as` cast) and confines every real pi/ctx touch (plus
// the clock and timers) to `createPiRuntime` below.
//
// Type-only pi imports are erased at runtime, so this module's only runtime
// dependencies are the first-party ./core.ts and ./prompts.ts. (ADR: see README
// "Phase 2".)
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { GOAL_ENTRY_TYPE, type GoalEvent, type GoalState, parseGoalEvent } from "./core.ts";
import { renderGoalWidget } from "./prompts.ts";

/** The model-callable goal tools, toggled active only while a goal self-drives. */
export const GOAL_TOOL_NAMES = ["update_goal", "get_goal"] as const;

const WIDGET_KEY = "goal";

/**
 * The port the orchestration runs against. The real adapter wraps (pi, ctx); the
 * tests supply an in-memory fake implementing exactly these verbs.
 */
export interface GoalRuntime {
  /** Goal events on the current branch, in order (parsed, never cast). */
  readEvents(): GoalEvent[];
  /** Persist a goal event as a custom session entry (compaction-independent). */
  record(event: GoalEvent): void;
  /** Queue a follow-up user message that triggers the next auto turn. */
  sendContinuation(kick: string): void;
  /** Current context usage percent (0–100), or null when unknown. */
  contextPercent(): number | null;
  /** Add/remove the goal tools from the active set (read-modify-write). */
  setGoalToolsActive(active: boolean): void;
  /** Update the goal widget from the current state. */
  showStatus(state: GoalState): void;
  /** Injected clock (deterministic in tests). */
  now(): number;
  /** Injected timer for the continuation cooldown (deterministic in tests). */
  sleep(ms: number): Promise<void>;
}

/** Build the real adapter from a pi handler's (pi, ctx). Cheap; rebuilt per event. */
export function createPiRuntime(pi: ExtensionAPI, ctx: ExtensionContext): GoalRuntime {
  return {
    readEvents() {
      const events: GoalEvent[] = [];
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === "custom" && entry.customType === GOAL_ENTRY_TYPE) {
          const parsed = parseGoalEvent(entry.data);
          if (parsed) events.push(parsed);
        }
      }
      return events;
    },
    record(event) {
      pi.appendEntry<GoalEvent>(GOAL_ENTRY_TYPE, event);
    },
    sendContinuation(kick) {
      pi.sendUserMessage(kick, { deliverAs: "followUp" });
    },
    contextPercent() {
      return ctx.getContextUsage()?.percent ?? null;
    },
    setGoalToolsActive(active) {
      const current = new Set(pi.getActiveTools());
      for (const name of GOAL_TOOL_NAMES) {
        if (active) current.add(name);
        else current.delete(name);
      }
      pi.setActiveTools([...current]);
    },
    showStatus(state) {
      ctx.ui.setWidget(WIDGET_KEY, renderGoalWidget(state));
    },
    now() {
      return Date.now();
    },
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
  };
}
