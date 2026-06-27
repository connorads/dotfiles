// Imperative shell for the /goal extension. Wires pi's lifecycle to the pure core:
// commands append goal events to the session, state is folded back from the current
// branch on demand, and an active objective is re-injected into the system prompt
// every turn (so it survives compaction and is prompt-cache friendly).
//
// Type-only import — erased at runtime; the extension's only runtime dependency is
// ./core.ts. All pi objects arrive as handler arguments.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  GOAL_ENTRY_TYPE,
  type GoalEvent,
  type GoalState,
  parseGoalCommand,
  reduceGoal,
  renderGoalBlock,
} from "./core.ts";

const WIDGET_KEY = "goal";

/** Goal events on the current branch, in order — the input to reduceGoal. */
function readGoalEvents(ctx: ExtensionContext): GoalEvent[] {
  const events: GoalEvent[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === GOAL_ENTRY_TYPE && entry.data) {
      events.push(entry.data as GoalEvent);
    }
  }
  return events;
}

function showWidget(ctx: ExtensionContext, state: GoalState | null): void {
  if (!state) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }
  const suffix = state.status === "paused" ? "  (paused)" : "";
  ctx.ui.setWidget(WIDGET_KEY, [`◆ goal: ${state.text}${suffix}`]);
}

export default function (pi: ExtensionAPI): void {
  const refresh = (ctx: ExtensionContext): void => {
    showWidget(ctx, reduceGoal(readGoalEvents(ctx)));
  };

  // Rebuild the widget whenever the active branch changes.
  pi.on("session_start", (_event, ctx) => refresh(ctx));
  pi.on("session_tree", (_event, ctx) => refresh(ctx));
  pi.on("session_shutdown", (_event, ctx) => ctx.ui.setWidget(WIDGET_KEY, undefined));

  // The whole point: re-state an active goal into the system prompt each turn.
  // Derived from the branch (not in-memory) so it stays correct across /tree and
  // /resume. Stable text → written to the prompt cache once, then read every turn.
  pi.on("before_agent_start", (event, ctx) => {
    const state = reduceGoal(readGoalEvents(ctx));
    if (state?.status === "active") {
      return { systemPrompt: event.systemPrompt + renderGoalBlock(state.text) };
    }
    return undefined;
  });

  pi.registerCommand("goal", {
    description: "Set or view a persistent objective that steers the agent and survives compaction",
    handler: async (args, ctx) => {
      const command = parseGoalCommand(args);
      const events = readGoalEvents(ctx);
      const current = reduceGoal(events);

      const commit = (event: GoalEvent): void => {
        pi.appendEntry<GoalEvent>(GOAL_ENTRY_TYPE, event);
        showWidget(ctx, reduceGoal([...events, event]));
      };

      switch (command.kind) {
        case "show":
          ctx.ui.notify(
            current
              ? `Goal${current.status === "paused" ? " (paused)" : ""}: ${current.text}`
              : "No active goal. Set one with /goal <objective>.",
            "info",
          );
          return;

        case "set":
          commit({ kind: "set", text: command.text, at: Date.now() });
          ctx.ui.notify(`Goal set: ${command.text}`, "info");
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
          commit({ kind: "edit", text: edited, at: Date.now() });
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
          commit({ kind: "pause", at: Date.now() });
          ctx.ui.notify("Goal paused — it will stop steering until /goal resume.", "info");
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
          commit({ kind: "resume", at: Date.now() });
          ctx.ui.notify("Goal resumed.", "info");
          return;

        case "clear":
          if (!current) {
            ctx.ui.notify("No active goal to clear.", "info");
            return;
          }
          commit({ kind: "clear", at: Date.now() });
          ctx.ui.notify("Goal cleared.", "info");
          return;
      }
    },
  });
}
