import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const PROVIDER_ID = "antigravity-sandbox";

export function parsePathList(raw: unknown): string[] {
  if (typeof raw !== "string") {
    return [];
  }
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      paths.push(trimmed);
    }
  }
  return paths;
}

export default function antigravitySandboxPlugin(bb: BbPluginApi): void {
  bb.settings.define({
    sandboxEnabled: {
      type: "boolean",
      label: "Enable workspace sandbox",
      description:
        "Wrap Antigravity (agy) ACP sessions in a macOS Seatbelt / Linux bwrap workspace-write sandbox in Accept Edits and Approve for me (auto) modes.",
      default: true,
    },
    extraAllowedWritePaths: {
      type: "string",
      label: "Extra writable paths",
      description:
        "One absolute path per line (or ~/...) to allow writing inside the sandbox, in addition to the workspace, linked Git worktree metadata, and thread storage.",
      experimental_multiline: true,
      default: "",
    },
    extraDeniedReadPaths: {
      type: "string",
      label: "Extra denied read paths",
      description:
        "One absolute path per line (or ~/...) to deny reading inside the sandbox, in addition to ~/.ssh, ~/.aws, ~/.gnupg, ~/.bb auth files, and ~/.local/share/agy-profiles.",
      experimental_multiline: true,
      default: "",
    },
    extraDeniedWritePaths: {
      type: "string",
      label: "Extra denied write paths",
      description:
        "One absolute path per line (or ~/...) to deny writing inside the sandbox.",
      experimental_multiline: true,
      default: "",
    },
  });

  bb.providers.register({
    id: PROVIDER_ID,
    displayName: "Antigravity (Sandboxed)",
    family: "acp",
    icon: "Shield",
    strings: {
      signInHint: "Run `agy acp --login` on the machine to sign in.",
      expiredHint:
        "Your Antigravity session expired. Run `agy acp --login`, then reload.",
      installUrl: "https://antigravity.google/docs/ide/extensions/acp",
    },
    experimental_nativeSkillRoots: {
      user: [
        "src/bb-plugins/agy-swarm/skills",
        ".gemini/antigravity-cli/skills",
      ],
      project: [],
    },
    experimental_bridgeOptions: {
      acpLaunchSpec: {
        displayName: "Antigravity (Sandboxed)",
        command: "agy",
        args: ["acp", "--process-per-session"],
        env: {},
      },
    },
    models: { scope: "host" },
    maintenance: {
      health: true,
      usage: false,
      installation: false,
    },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      fork: "none",
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh"],
    },
    composerActions: [],
    deriveProviderOptions(ctx) {
      return {
        sandbox: {
          enabled: ctx.settings.sandboxEnabled !== false,
          extraAllowedWritePaths: parsePathList(
            ctx.settings.extraAllowedWritePaths,
          ),
          extraDeniedReadPaths: parsePathList(
            ctx.settings.extraDeniedReadPaths,
          ),
          extraDeniedWritePaths: parsePathList(
            ctx.settings.extraDeniedWritePaths,
          ),
        },
      };
    },
  });
}
