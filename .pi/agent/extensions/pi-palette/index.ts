/**
 * Pi Palette Extension
 *
 * Two complementary overlays for pi:
 *   Ctrl+X — leader-key chord palette (press / within to search)
 *   /telescope, /lk — slash command fallbacks
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import type { TelescopeProvider } from "./telescope/types.js";
import { openTelescope } from "./telescope/overlay.js";
import { openLeaderKey } from "./leader-key/overlay.js";

import { createFilesProvider } from "./telescope/providers/files.js";
import { createGitLogProvider } from "./telescope/providers/git-log.js";
import { createSessionsProvider } from "./telescope/providers/sessions.js";
import { createSkillsProvider } from "./telescope/providers/skills.js";
import { createCommandsProvider } from "./telescope/providers/commands.js";
import { createModelsProvider } from "./telescope/providers/models.js";

// ── Provider registry ──────────────────────────────

type ProviderFactory = (
  cwd: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
) => TelescopeProvider;

const PROVIDERS: Record<string, ProviderFactory> = {
  files: (cwd) => createFilesProvider(cwd),
  "git-log": (cwd) => createGitLogProvider(cwd),
  sessions: () => createSessionsProvider(),
  skills: (cwd) => createSkillsProvider(cwd),
  commands: (_cwd, pi) => createCommandsProvider(pi),
  models: (_cwd, pi, ctx) => createModelsProvider(pi, ctx),
};

const PROVIDER_NAMES = Object.keys(PROVIDERS);

function buildAllProviders(
  cwd: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Record<string, () => TelescopeProvider> {
  const result: Record<string, () => TelescopeProvider> = {};
  for (const [name, factory] of Object.entries(PROVIDERS)) {
    result[name] = () => factory(cwd, pi, ctx);
  }
  return result;
}

async function runTelescope(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  providerName?: string,
) {
  const name = providerName?.trim().toLowerCase() || "commands";
  const factory = PROVIDERS[name];

  if (!factory) {
    ctx.ui.notify(
      `Unknown provider: ${name}. Available: ${PROVIDER_NAMES.join(", ")}`,
      "warning",
    );
    return;
  }

  const provider = factory(ctx.cwd, pi, ctx);
  await openTelescope(provider, ctx, {
    allProviders: buildAllProviders(ctx.cwd, pi, ctx),
  });
}

// ── Extension entry point ──────────────────────────

export default function piPalette(pi: ExtensionAPI) {
  // Ctrl+X -> leader key palette
  pi.registerShortcut(Key.ctrl("x"), {
    description: "Leader key palette",
    handler: (ctx) => openLeaderKey(pi, ctx),
  });

  // /telescope [provider] command
  pi.registerCommand("telescope", {
    description: "Open telescope (optional: provider name)",
    getArgumentCompletions: (prefix) => {
      const items = PROVIDER_NAMES.filter((n) => n.startsWith(prefix)).map(
        (n) => ({ value: n, label: n }),
      );
      return items.length > 0 ? items : null;
    },
    handler: (args, ctx) => runTelescope(pi, ctx, args?.trim() || undefined),
  });

  // /ts alias
  pi.registerCommand("ts", {
    description: "Telescope (alias)",
    getArgumentCompletions: (prefix) => {
      const items = PROVIDER_NAMES.filter((n) => n.startsWith(prefix)).map(
        (n) => ({ value: n, label: n }),
      );
      return items.length > 0 ? items : null;
    },
    handler: (args, ctx) => runTelescope(pi, ctx, args?.trim() || undefined),
  });

  // /lk command
  pi.registerCommand("lk", {
    description: "Open leader key palette",
    handler: (_args, ctx) => openLeaderKey(pi, ctx),
  });

  // /palette alias for telescope
  pi.registerCommand("palette", {
    description: "Open command palette (alias for /telescope)",
    handler: (_args, ctx) => runTelescope(pi, ctx, "commands"),
  });
}
