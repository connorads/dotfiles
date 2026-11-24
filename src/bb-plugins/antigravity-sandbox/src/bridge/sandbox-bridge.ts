import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ProviderBridgeContext,
  ProviderBridgeDefinition,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  pendingInteractionResolutionSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import {
  ensureSandboxExecWrapper,
  generateSeatbeltProfile,
  gitWritableRootsForWorkspace,
} from "../sandbox/index.js";
import {
  executeUnsandboxedCommand,
  formatUnsandboxedCommandOutput,
  SANDBOX_GUIDANCE_INSTRUCTIONS,
  UNSANDBOXED_COMMAND_TOOL_NAME,
  UNSANDBOXED_COMMAND_TOOL_SPEC,
  unsandboxedCommandArgsSchema,
  type UnsandboxedCommandResult,
} from "./escape-tool.js";

const DEFAULT_AGY_LAUNCH_SPEC = {
  displayName: "Antigravity (Sandboxed)",
  command: "agy",
  args: ["acp", "--process-per-session"],
  env: {} as Record<string, string>,
};

const sandboxOptionsSchema = z
  .object({
    enabled: z.boolean().default(true),
    extraAllowedWritePaths: z.array(z.string()).default([]),
    extraDeniedReadPaths: z.array(z.string()).default([]),
    extraDeniedWritePaths: z.array(z.string()).default([]),
    extraSeatbeltRules: z.array(z.string()).default([]),
  })
  .default({
    enabled: true,
    extraAllowedWritePaths: [],
    extraDeniedReadPaths: [],
    extraDeniedWritePaths: [],
    extraSeatbeltRules: [],
  });

type SandboxSettings = z.infer<typeof sandboxOptionsSchema>;

interface ThreadSandboxState {
  cwd: string;
  sandboxActive: boolean;
  permissionEscalation: "ask" | "deny";
  sandboxSettings: SandboxSettings;
  additionalWorkspaceWriteRoots: string[];
  envVars: Record<string, string>;
  profilePath: string | null;
  profileHash: string | null;
}

interface PendingEscapeApproval {
  innerRequestId: string | number;
  threadId: string;
  command: string;
  cwd: string;
  envVars: Record<string, string>;
  abortController: AbortController;
}

export interface SandboxBridgeDependencies {
  innerBridge: ProviderBridgeDefinition;
  writeRuntimeLine: (line: string) => void;
  executeCommand?: typeof executeUnsandboxedCommand;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

const jsonRpcMessageSchema = z
  .object({
    jsonrpc: z.literal("2.0").optional(),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string().optional(),
    params: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

const toolCallInterceptParamsSchema = z
  .object({
    providerThreadId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    turnId: z.union([z.string().min(1), z.null()]).optional(),
    callId: z.string().min(1),
    tool: z.string().min(1),
    arguments: z.unknown(),
  })
  .passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === "string") {
      out[key] = val;
    }
  }
  return out;
}

function dedupePush(items: readonly string[], extra: string): string[] {
  return items.includes(extra) ? [...items] : [...items, extra];
}

function appendSandboxGuidance(instructions: unknown): string {
  const existing = typeof instructions === "string" ? instructions.trim() : "";
  if (existing.includes(UNSANDBOXED_COMMAND_TOOL_NAME)) {
    return existing;
  }
  return existing.length > 0
    ? `${existing}\n\n${SANDBOX_GUIDANCE_INSTRUCTIONS}`
    : SANDBOX_GUIDANCE_INSTRUCTIONS;
}

function injectEscapeTool(dynamicTools: unknown): Record<string, unknown>[] {
  const existing = Array.isArray(dynamicTools)
    ? dynamicTools.filter(isRecord)
    : [];
  if (existing.some((tool) => tool["name"] === UNSANDBOXED_COMMAND_TOOL_NAME)) {
    return existing;
  }
  return [
    ...existing,
    {
      name: UNSANDBOXED_COMMAND_TOOL_SPEC.name,
      description: UNSANDBOXED_COMMAND_TOOL_SPEC.description,
      inputSchema: UNSANDBOXED_COMMAND_TOOL_SPEC.inputSchema,
    },
  ];
}

function buildToolCallResponseLine(
  id: string | number,
  success: boolean,
  text: string,
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      success,
      contentItems: [{ type: "inputText", text }],
    },
  });
}

export function createSandboxBridgeController(
  deps: SandboxBridgeDependencies,
) {
  const platform = deps.platform ?? process.platform;
  const homeDir = deps.homeDir ?? os.homedir();
  const runCommand = deps.executeCommand ?? executeUnsandboxedCommand;

  let bridgeTempDir = os.tmpdir();
  let wrapperPath: string | null = null;
  let approvalSeq = 0;

  const threads = new Map<string, ThreadSandboxState>();
  const pendingApprovals = new Map<string, PendingEscapeApproval>();
  const activeCommandsByThread = new Map<string, Set<AbortController>>();

  function ensureWrapper(): string {
    if (wrapperPath === null) {
      wrapperPath = ensureSandboxExecWrapper(bridgeTempDir);
    }
    return wrapperPath;
  }

  function trackAbortController(
    threadId: string,
    controller: AbortController,
  ): void {
    let set = activeCommandsByThread.get(threadId);
    if (!set) {
      set = new Set();
      activeCommandsByThread.set(threadId, set);
    }
    set.add(controller);
  }

  function untrackAbortController(
    threadId: string,
    controller: AbortController,
  ): void {
    const set = activeCommandsByThread.get(threadId);
    if (!set) return;
    set.delete(controller);
    if (set.size === 0) {
      activeCommandsByThread.delete(threadId);
    }
  }

  function abortThreadWork(threadId: string): void {
    for (const [approvalId, pending] of pendingApprovals) {
      if (pending.threadId !== threadId) continue;
      pendingApprovals.delete(approvalId);
      pending.abortController.abort();
      deps.innerBridge.handleLine(
        buildToolCallResponseLine(
          pending.innerRequestId,
          false,
          "Unsandboxed command cancelled because the turn stopped.",
        ),
      );
    }
    const controllers = activeCommandsByThread.get(threadId);
    if (controllers) {
      for (const controller of controllers) {
        controller.abort();
      }
      activeCommandsByThread.delete(threadId);
    }
  }

  function cleanupThreadProfile(state: ThreadSandboxState): void {
    if (state.profilePath) {
      try {
        fs.unlinkSync(state.profilePath);
      } catch {
        // Ignore already-deleted profile.
      }
      state.profilePath = null;
      state.profileHash = null;
    }
  }

  function cleanupAll(): void {
    for (const threadId of threads.keys()) {
      abortThreadWork(threadId);
    }
    for (const state of threads.values()) {
      cleanupThreadProfile(state);
    }
    threads.clear();
  }

  function ensureProfileFile(state: ThreadSandboxState): string | null {
    if (platform !== "darwin") {
      return null;
    }
    const gitWritableRoots = gitWritableRootsForWorkspace(state.cwd);
    const content = generateSeatbeltProfile({
      cwd: state.cwd,
      gitWritableRoots,
      additionalWorkspaceWriteRoots: state.additionalWorkspaceWriteRoots,
      extraAllowedWritePaths: state.sandboxSettings.extraAllowedWritePaths,
      extraDeniedReadPaths: state.sandboxSettings.extraDeniedReadPaths,
      extraDeniedWritePaths: state.sandboxSettings.extraDeniedWritePaths,
      extraSeatbeltRules: state.sandboxSettings.extraSeatbeltRules,
      homeDir,
      tempDir: bridgeTempDir,
    });
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    if (
      state.profileHash === hash &&
      state.profilePath !== null &&
      fs.existsSync(state.profilePath)
    ) {
      return state.profilePath;
    }
    cleanupThreadProfile(state);
    fs.mkdirSync(bridgeTempDir, { recursive: true, mode: 0o700 });
    const nextPath = path.join(
      bridgeTempDir,
      `bb-agy-sb-${hash}.sb`,
    );
    fs.writeFileSync(nextPath, content, { encoding: "utf8", mode: 0o600 });
    state.profilePath = nextPath;
    state.profileHash = hash;
    return nextPath;
  }

  function rewriteSessionStartOrTurn(
    message: Record<string, unknown>,
    method: string,
  ): string {
    const params = isRecord(message["params"]) ? { ...message["params"] } : null;
    if (!params) {
      return JSON.stringify(message);
    }
    const threadId =
      typeof params["threadId"] === "string" ? params["threadId"] : null;
    const rawOptions = isRecord(params["options"])
      ? { ...params["options"] }
      : null;
    if (!threadId || !rawOptions) {
      return JSON.stringify(message);
    }

    const isSessionStart =
      method === "thread/start" ||
      method === "thread/resume" ||
      method === "thread/fork";

    const existing = threads.get(threadId);
    const cwd =
      typeof params["cwd"] === "string"
        ? params["cwd"]
        : existing?.cwd ?? process.cwd();

    const providerOptions = isRecord(rawOptions["providerOptions"])
      ? { ...rawOptions["providerOptions"] }
      : {};

    const parsedSandbox = sandboxOptionsSchema.safeParse(
      providerOptions["sandbox"],
    );
    const sandboxSettings = parsedSandbox.success
      ? parsedSandbox.data
      : existing?.sandboxSettings ?? sandboxOptionsSchema.parse(undefined);

    const additionalWorkspaceWriteRoots =
      providerOptions["additionalWorkspaceWriteRoots"] !== undefined
        ? readStringArray(providerOptions["additionalWorkspaceWriteRoots"])
        : existing?.additionalWorkspaceWriteRoots ?? [];

    const requestedMode = rawOptions["permissionMode"];
    const sandboxActive =
      requestedMode !== "full" &&
      sandboxSettings.enabled &&
      platform === "darwin";

    const permissionEscalation: "ask" | "deny" =
      rawOptions["permissionEscalation"] === "deny" ? "deny" : "ask";

    const baseEnv = readStringRecord(rawOptions["envVars"]);

    const state: ThreadSandboxState = existing ?? {
      cwd,
      sandboxActive,
      permissionEscalation,
      sandboxSettings,
      additionalWorkspaceWriteRoots,
      envVars: baseEnv,
      profilePath: null,
      profileHash: null,
    };
    state.cwd = cwd;
    state.sandboxActive = sandboxActive;
    state.permissionEscalation = permissionEscalation;
    state.sandboxSettings = sandboxSettings;
    state.additionalWorkspaceWriteRoots = additionalWorkspaceWriteRoots;
    state.envVars = baseEnv;
    threads.set(threadId, state);

    const nextEnv: Record<string, string> = { ...baseEnv };
    if (sandboxActive) {
      const profilePath = ensureProfileFile(state);
      nextEnv["BB_AGY_SANDBOX_MODE"] = "seatbelt";
      if (profilePath) {
        nextEnv["BB_AGY_SANDBOX_PROFILE"] = profilePath;
      }
      if (platform === "darwin") {
        nextEnv["SHELL"] = "/bin/zsh";
      }
    } else {
      nextEnv["BB_AGY_SANDBOX_MODE"] = "off";
      delete nextEnv["BB_AGY_SANDBOX_PROFILE"];
    }
    rawOptions["envVars"] = nextEnv;

    // Rewrite permissionMode to "full" before forwarding to stock ACP bridge:
    // the OS Seatbelt profile enforces workspace isolation when sandboxActive,
    // and agy needs --dangerously-skip-permissions to avoid nested sandbox-exec.
    rawOptions["permissionMode"] = "full";
    if ("permissionScope" in rawOptions) {
      rawOptions["permissionScope"] = "full";
    }
    if ("approvalReviewer" in rawOptions) {
      rawOptions["approvalReviewer"] = null;
    }
    if ("permissionEscalation" in rawOptions) {
      rawOptions["permissionEscalation"] = null;
    }

    if (isSessionStart) {
      const rawSpec = isRecord(providerOptions["acpLaunchSpec"])
        ? providerOptions["acpLaunchSpec"]
        : DEFAULT_AGY_LAUNCH_SPEC;
      const baseCommand =
        typeof rawSpec["command"] === "string" && rawSpec["command"].length > 0
          ? rawSpec["command"]
          : DEFAULT_AGY_LAUNCH_SPEC.command;
      const baseArgs = readStringArray(rawSpec["args"]);
      const effectiveArgs = dedupePush(
        baseArgs.length > 0 ? baseArgs : DEFAULT_AGY_LAUNCH_SPEC.args,
        "--dangerously-skip-permissions",
      );
      const specEnv = readStringRecord(rawSpec["env"]);
      const displayName =
        typeof rawSpec["displayName"] === "string"
          ? rawSpec["displayName"]
          : DEFAULT_AGY_LAUNCH_SPEC.displayName;

      providerOptions["acpLaunchSpec"] = {
        ...rawSpec,
        displayName,
        command: ensureWrapper(),
        args: [baseCommand, ...effectiveArgs],
        env: specEnv,
      };
      rawOptions["providerOptions"] = providerOptions;

      if (sandboxSettings.enabled) {
        params["dynamicTools"] = injectEscapeTool(params["dynamicTools"]);
      }
      if (sandboxActive) {
        rawOptions["instructions"] = appendSandboxGuidance(
          rawOptions["instructions"],
        );
      }
    } else {
      rawOptions["providerOptions"] = providerOptions;
    }

    params["options"] = rawOptions;
    return JSON.stringify({ ...message, params });
  }

  async function runAndReplyToInnerBridge(args: {
    innerRequestId: string | number;
    threadId: string;
    command: string;
    cwd: string;
    envVars: Record<string, string>;
    abortController: AbortController;
  }): Promise<void> {
    trackAbortController(args.threadId, args.abortController);
    try {
      const result: UnsandboxedCommandResult = await runCommand({
        command: args.command,
        cwd: args.cwd,
        env: args.envVars,
        signal: args.abortController.signal,
      });
      const formatted = formatUnsandboxedCommandOutput(result);
      deps.innerBridge.handleLine(
        buildToolCallResponseLine(
          args.innerRequestId,
          formatted.success,
          formatted.text,
        ),
      );
    } catch (error) {
      deps.innerBridge.handleLine(
        buildToolCallResponseLine(
          args.innerRequestId,
          false,
          `Failed to execute unsandboxed command: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    } finally {
      untrackAbortController(args.threadId, args.abortController);
    }
  }

  function handleApprovalResponse(
    approvalId: string,
    message: z.infer<typeof jsonRpcMessageSchema>,
  ): void {
    const pending = pendingApprovals.get(approvalId);
    if (!pending) return;
    pendingApprovals.delete(approvalId);

    if (message.error !== undefined) {
      deps.innerBridge.handleLine(
        buildToolCallResponseLine(
          pending.innerRequestId,
          false,
          "Unsandboxed command approval request was cancelled or failed.",
        ),
      );
      return;
    }

    const parsed = pendingInteractionResolutionSchema.safeParse(message.result);
    const approved =
      parsed.success &&
      "decision" in parsed.data &&
      (parsed.data.decision === "allow_once" ||
        parsed.data.decision === "allow_for_session");

    if (!approved) {
      deps.innerBridge.handleLine(
        buildToolCallResponseLine(
          pending.innerRequestId,
          false,
          "User denied unsandboxed execution of this command. Do not retry or circumvent this denial.",
        ),
      );
      return;
    }

    void runAndReplyToInnerBridge({
      innerRequestId: pending.innerRequestId,
      threadId: pending.threadId,
      command: pending.command,
      cwd: pending.cwd,
      envVars: pending.envVars,
      abortController: pending.abortController,
    });
  }

  /**
   * Inspects an outbound line written by the inner ACP bridge.
   * Returns `true` if intercepted (must NOT be written to runtime stdout),
   * or `false` if it should pass straight through to BB runtime.
   */
  function interceptOutboundLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      return false;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return false;
    }
    const message = jsonRpcMessageSchema.safeParse(raw);
    if (
      !message.success ||
      message.data.id === undefined ||
      message.data.method !== BRIDGE_INBOUND_REQUEST_METHODS.toolCall
    ) {
      return false;
    }
    const params = toolCallInterceptParamsSchema.safeParse(message.data.params);
    if (
      !params.success ||
      params.data.tool !== UNSANDBOXED_COMMAND_TOOL_NAME
    ) {
      return false;
    }

    const innerRequestId = message.data.id;
    const threadId = params.data.threadId ?? params.data.providerThreadId;
    const state = threads.get(threadId);
    const parsedArgs = unsandboxedCommandArgsSchema.safeParse(
      params.data.arguments,
    );
    if (!parsedArgs.success) {
      deps.innerBridge.handleLine(
        buildToolCallResponseLine(
          innerRequestId,
          false,
          `Invalid ${UNSANDBOXED_COMMAND_TOOL_NAME} arguments: ${parsedArgs.error.message}`,
        ),
      );
      return true;
    }

    const effectiveCwd = parsedArgs.data.cwd ?? state?.cwd ?? process.cwd();
    const envVars = state?.envVars ?? {};

    if (state && !state.sandboxActive) {
      void runAndReplyToInnerBridge({
        innerRequestId,
        threadId,
        command: parsedArgs.data.command,
        cwd: effectiveCwd,
        envVars,
        abortController: new AbortController(),
      });
      return true;
    }

    if (state?.permissionEscalation === "deny") {
      deps.innerBridge.handleLine(
        buildToolCallResponseLine(
          innerRequestId,
          false,
          "Unsandboxed command escalation is disabled for unattended turns.",
        ),
      );
      return true;
    }

    const approvalId = `antigravity-sandbox-approval-${++approvalSeq}`;
    pendingApprovals.set(approvalId, {
      innerRequestId,
      threadId,
      command: parsedArgs.data.command,
      cwd: effectiveCwd,
      envVars,
      abortController: new AbortController(),
    });

    deps.writeRuntimeLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: approvalId,
        method: BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest,
        params: {
          providerThreadId: params.data.providerThreadId,
          ...(params.data.threadId !== undefined
            ? { threadId: params.data.threadId }
            : {}),
          turnId: params.data.turnId ?? null,
          payload: {
            kind: "approval",
            subject: {
              kind: "command",
              itemId: params.data.callId,
              command: parsedArgs.data.command,
              cwd: effectiveCwd,
              actions: [
                { type: "unknown", command: parsedArgs.data.command },
              ],
              sessionGrant: null,
            },
            reason: parsedArgs.data.reason,
            availableDecisions: ["allow_once", "deny"],
          },
        },
      }),
    );
    return true;
  }

  function start(context: ProviderBridgeContext): void {
    bridgeTempDir = context.tempDir;
    ensureWrapper();
    deps.innerBridge.start?.(context);
  }

  function handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      deps.innerBridge.handleLine(line);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      deps.innerBridge.handleLine(line);
      return;
    }
    const parsed = jsonRpcMessageSchema.safeParse(raw);
    if (!parsed.success) {
      deps.innerBridge.handleLine(line);
      return;
    }

    // Intercept BB runtime's response to our synthetic interaction/request.
    if (
      parsed.data.method === undefined &&
      typeof parsed.data.id === "string" &&
      pendingApprovals.has(parsed.data.id)
    ) {
      handleApprovalResponse(parsed.data.id, parsed.data);
      return;
    }

    const method = parsed.data.method;
    if (
      method === "thread/start" ||
      method === "thread/resume" ||
      method === "thread/fork" ||
      method === "turn/start"
    ) {
      deps.innerBridge.handleLine(
        rewriteSessionStartOrTurn(parsed.data, method),
      );
      return;
    }

    if (method === "thread/stop" || method === "thread/discard") {
      const threadId =
        isRecord(parsed.data.params) &&
        typeof parsed.data.params["threadId"] === "string"
          ? parsed.data.params["threadId"]
          : null;
      if (threadId) {
        abortThreadWork(threadId);
        if (method === "thread/discard") {
          const state = threads.get(threadId);
          if (state) {
            cleanupThreadProfile(state);
            threads.delete(threadId);
          }
        }
      }
      deps.innerBridge.handleLine(line);
      return;
    }

    deps.innerBridge.handleLine(line);
  }

  function onClose(): void {
    cleanupAll();
    deps.innerBridge.onClose?.();
  }

  function onSigterm(): void {
    cleanupAll();
    deps.innerBridge.onSigterm?.();
  }

  function onSigint(): void {
    cleanupAll();
    deps.innerBridge.onSigint?.();
  }

  return {
    start,
    handleLine,
    interceptOutboundLine,
    onClose,
    onSigterm,
    onSigint,
  };
}
