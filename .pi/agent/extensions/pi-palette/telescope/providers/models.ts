/**
 * Models Provider
 *
 * Browse and switch between available AI models.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { TelescopeProvider } from "../types.js";

interface ModelInfo {
  id: string;
  provider: string;
  name: string;
}

export function createModelsProvider(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): TelescopeProvider<ModelInfo> {
  return {
    name: "models",
    icon: "🤖",
    description: "Available models",

    load() {
      const models = ctx.modelRegistry.getAvailable();
      return models.map((m) => ({
        id: m.id,
        provider: m.provider,
        name: m.name ?? m.id,
      }));
    },

    searchText(item) {
      return `${item.provider} ${item.id} ${item.name}`;
    },

    displayText(item, theme) {
      const badge = theme.fg("accent", item.provider);
      const current = ctx.model?.id === item.id ? theme.fg("success", " ●") : "";
      return `[${badge}] ${item.name}${current}`;
    },

    async onSelect(item) {
      pi.setModel({ id: item.id, provider: item.provider });
      ctx.ui.notify(`Switched to ${item.provider}/${item.id}`, "info");
    },

    preview(item) {
      return [
        `Model: ${item.name}`,
        `Provider: ${item.provider}`,
        `ID: ${item.id}`,
      ];
    },

    frecencyKey(item) {
      return `${item.provider}/${item.id}`;
    },
  };
}
