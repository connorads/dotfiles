/**
 * Commands Provider
 *
 * Browse all available pi commands (extensions, skills, prompts).
 */

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import type { TelescopeProvider } from "../types.js";
import { copyToClipboard } from "../../shared/clipboard.js";

interface CommandInfo {
  name: string;
  description: string;
  source: string;
}

export function createCommandsProvider(
  pi: ExtensionAPI,
): TelescopeProvider<CommandInfo> {
  return {
    name: "commands",
    icon: "⚡",
    description: "Pi commands",

    load() {
      return pi.getCommands().map((cmd) => ({
        name: cmd.name,
        description: cmd.description ?? "",
        source: cmd.source,
      }));
    },

    searchText(item) {
      return `${item.name} ${item.description}`;
    },

    displayText(item, theme) {
      const sourceBadge =
        item.source === "extension"
          ? theme.fg("accent", "ext")
          : item.source === "skill"
            ? theme.fg("warning", "skill")
            : theme.fg("dim", "prompt");
      return `[${sourceBadge}] /${theme.bold(item.name)} ${theme.fg("dim", item.description)}`;
    },

    async onSelect(item, ctx) {
      ctx.ui.setEditorText(`/${item.name}`);
      setTimeout(() => process.stdin.emit("data", "\r"), 0);
    },

    preview(item) {
      return [
        `Command: /${item.name}`,
        `Source: ${item.source}`,
        "",
        item.description || "(no description)",
      ];
    },

    frecencyKey(item) {
      return item.name;
    },

    actions: [
      {
        key: "c",
        label: "Copy command",
        description: "Copy /command to clipboard",
      },
    ],

    onAction(actionKey, items) {
      if (actionKey === "c") {
        copyToClipboard(items.map((i) => `/${i.name}`).join("\n"));
      }
    },
  };
}
