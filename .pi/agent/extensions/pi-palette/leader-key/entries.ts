/**
 * Leader Key Entry Builder (Pure)
 *
 * Builds the top-level entry tree from pi state.
 * Pure function — no side effects, testable with fixture data.
 */

import type { TopLevelEntry } from "./types.js";

interface CommandLike {
  name: string;
  description: string;
  source: string;
}

// Commands already represented by built-in entries
const BUILTIN_NAMES = new Set([
  "new",
  "resume",
  "tree",
  "fork",
  "compact",
  "model",
  "thinking",
  "tools",
  "reload",
  "switch",
  "lk",
  "leader-key",
  "telescope",
  "ts",
  "palette",
  "mode",
  "permissions",
  "quit",
]);

interface Callbacks {
  setThinkingLevel?: (level: string) => void;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

/**
 * Build the leader-key top-level entries.
 *
 * Takes pre-fetched state so the function stays pure:
 * - commands: all registered commands
 * - currentModel: "provider/id" string
 * - thinkingLevel: current thinking level
 * - callbacks: optional API callbacks for direct actions
 */
export function buildEntries(
  commands: readonly CommandLike[],
  currentModel: string,
  thinkingLevel: string,
  callbacks?: Callbacks,
): TopLevelEntry[] {
  const entries: TopLevelEntry[] = [];

  // ── Search (telescope) ──
  entries.push({
    type: "action",
    key: "/",
    label: "Search",
    description: "fuzzy finder",
    action: (ctx) => {
      ctx.ui.setEditorText("/telescope commands");
      setTimeout(() => process.stdin.emit("data", "\r"), 0);
    },
  });

  // ── Session group ──
  entries.push({
    type: "group",
    group: {
      key: "s",
      label: "Session",
      items: [
        {
          key: "n",
          label: "New session",
          description: "start fresh",
          action: (ctx) => {
            ctx.ui.setEditorText("/new");
            setTimeout(() => process.stdin.emit("data", "\r"), 0);
          },
        },
        {
          key: "r",
          label: "Resume session",
          description: "/resume",
          action: (ctx) => {
            ctx.ui.setEditorText("/resume");
            setTimeout(() => process.stdin.emit("data", "\r"), 0);
          },
        },
        {
          key: "t",
          label: "Session tree",
          description: "/tree",
          action: (ctx) => {
            ctx.ui.setEditorText("/tree");
            setTimeout(() => process.stdin.emit("data", "\r"), 0);
          },
        },
        {
          key: "f",
          label: "Fork session",
          description: "/fork",
          action: (ctx) => {
            ctx.ui.setEditorText("/fork");
            setTimeout(() => process.stdin.emit("data", "\r"), 0);
          },
        },
        {
          key: "c",
          label: "Compact context",
          description: "compact now",
          action: (ctx) => {
            ctx.compact({});
            ctx.ui.notify("Compaction started", "info");
          },
        },
      ],
    },
  });

  // ── Model (direct action) ──
  entries.push({
    type: "action",
    key: "m",
    label: "Model",
    description: currentModel || "switch model",
    action: (ctx) => {
      ctx.ui.setEditorText("/model");
      setTimeout(() => process.stdin.emit("data", "\r"), 0);
    },
  });

  // ── Thinking group ──
  entries.push({
    type: "group",
    group: {
      key: "t",
      label: `Thinking (${thinkingLevel})`,
      items: THINKING_LEVELS.map((level, i) => ({
        key: String(i + 1),
        label: level,
        description: level === thinkingLevel ? "current" : undefined,
        action: (ctx) => {
          if (callbacks?.setThinkingLevel) {
            callbacks.setThinkingLevel(level);
            ctx.ui.notify(`Thinking: ${level}`, "info");
          } else {
            ctx.ui.setEditorText(`/thinking ${level}`);
            setTimeout(() => process.stdin.emit("data", "\r"), 0);
          }
        },
      })),
    },
  });

  // ── Extension commands ──
  const extCommands = commands
    .filter((c) => c.source === "extension")
    .filter((c) => !BUILTIN_NAMES.has(c.name));

  if (extCommands.length > 0) {
    entries.push({
      type: "action",
      key: "e",
      label: "Extensions",
      description: `${extCommands.length} command${extCommands.length !== 1 ? "s" : ""}`,
      action: (ctx) => {
        // Delegate to telescope commands provider
        ctx.ui.setEditorText("/telescope commands");
        setTimeout(() => process.stdin.emit("data", "\r"), 0);
      },
    });
  }

  // ── Skills ──
  const skillCommands = commands.filter((c) => c.source === "skill");
  if (skillCommands.length > 0) {
    entries.push({
      type: "action",
      key: "k",
      label: "Skills",
      description: `${skillCommands.length} skill${skillCommands.length !== 1 ? "s" : ""}`,
      action: (ctx) => {
        ctx.ui.setEditorText("/telescope skills");
        setTimeout(() => process.stdin.emit("data", "\r"), 0);
      },
    });
  }

  // ── Exit ──
  entries.push({
    type: "action",
    key: "q",
    label: "Exit",
    description: "quit pi",
    action: (ctx) => {
      ctx.ui.setEditorText("/quit");
      setTimeout(() => process.stdin.emit("data", "\r"), 0);
    },
  });

  return entries;
}
