import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNSANDBOXED_COMMAND_TOOL_NAME } from "./escape-tool.js";
import { createSandboxBridgeController } from "./sandbox-bridge.js";

interface ForwardedStartOrTurn {
  params: {
    dynamicTools?: unknown[];
    options: {
      permissionMode?: string;
      instructions?: string;
      envVars: Record<string, string | undefined>;
      providerOptions?: {
        acpLaunchSpec?: {
          args?: string[];
        };
      };
    };
  };
}

interface InteractionRequestMsg {
  id: string | number;
  method: string;
  params: {
    payload: Record<string, unknown>;
  };
}

interface ToolResponseMsg {
  id: string | number;
  result: {
    success: boolean;
    contentItems: Array<{ type: string; text: string }>;
  };
}

function findMessageById(
  messages: Record<string, unknown>[],
  id: number,
): ToolResponseMsg | undefined {
  return messages.find((m) => m["id"] === id) as ToolResponseMsg | undefined;
}

const tempDirs: string[] = [];

function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createHarness(opts?: {
  executeCommand?: Parameters<
    typeof createSandboxBridgeController
  >[0]["executeCommand"];
}) {
  const innerReceived: Record<string, unknown>[] = [];
  const runtimeReceived: Record<string, unknown>[] = [];
  const tmp = mkTempDir("agy-bridge-test-");

  const controller = createSandboxBridgeController({
    innerBridge: {
      handleLine(line) {
        innerReceived.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
    writeRuntimeLine(line) {
      runtimeReceived.push(JSON.parse(line) as Record<string, unknown>);
    },
    executeCommand: opts?.executeCommand,
    platform: "darwin",
    homeDir: tmp,
  });

  controller.start({
    pluginId: "antigravity-sandbox",
    dataDir: tmp,
    tempDir: tmp,
  });

  return { controller, innerReceived, runtimeReceived, tmp };
}

describe("createSandboxBridgeController", () => {
  it("rewrites auto mode to sandboxed full launch with escape tool and stable profile path across turns", () => {
    const { controller, innerReceived, tmp } = createHarness();

    controller.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "thread/start",
        params: {
          threadId: "thr_1",
          cwd: tmp,
          options: {
            model: "gemini-4-neon",
            permissionMode: "auto",
            permissionScope: "workspace",
            approvalReviewer: "automatic",
            permissionEscalation: "ask",
            providerOptions: {
              acpLaunchSpec: {
                displayName: "Antigravity (Sandboxed)",
                command: "agy",
                args: ["acp", "--process-per-session"],
                env: {},
              },
              sandbox: { enabled: true },
            },
          },
          dynamicTools: [],
        },
      }),
    );

    const startMsg = innerReceived[0] as unknown as ForwardedStartOrTurn;
    expect(startMsg.params.options.permissionMode).toBe("full");
    expect(startMsg.params.options.envVars["BB_AGY_SANDBOX_MODE"]).toBe(
      "seatbelt",
    );
    const firstProfile =
      startMsg.params.options.envVars["BB_AGY_SANDBOX_PROFILE"];
    expect(firstProfile).toBeTruthy();
    expect(fs.existsSync(firstProfile!)).toBe(true);
    expect(startMsg.params.options.envVars["SHELL"]).toBe("/bin/zsh");
    expect(
      startMsg.params.options.providerOptions?.acpLaunchSpec?.args,
    ).toEqual([
      "agy",
      "acp",
      "--process-per-session",
      "--dangerously-skip-permissions",
    ]);
    expect(startMsg.params.dynamicTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: UNSANDBOXED_COMMAND_TOOL_NAME }),
      ]),
    );
    expect(startMsg.params.options.instructions).toContain(
      UNSANDBOXED_COMMAND_TOOL_NAME,
    );

    // Second turn in auto keeps the exact same profile path (no spurious session restart).
    controller.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "turn/start",
        params: {
          threadId: "thr_1",
          input: [{ type: "text", text: "hi" }],
          options: {
            model: "gemini-4-neon",
            permissionMode: "auto",
            permissionEscalation: "ask",
            providerOptions: { sandbox: { enabled: true } },
          },
        },
      }),
    );
    const turnAuto = innerReceived[1] as unknown as ForwardedStartOrTurn;
    expect(turnAuto.params.options.envVars["BB_AGY_SANDBOX_PROFILE"]).toBe(
      firstProfile,
    );

    // Switching to full flips BB_AGY_SANDBOX_MODE to "off" so ACP bridge restarts + session/loads unsandboxed.
    controller.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "turn/start",
        params: {
          threadId: "thr_1",
          input: [{ type: "text", text: "now full" }],
          options: {
            model: "gemini-4-neon",
            permissionMode: "full",
            permissionEscalation: null,
            providerOptions: { sandbox: { enabled: true } },
          },
        },
      }),
    );
    const turnFull = innerReceived[2] as unknown as ForwardedStartOrTurn;
    expect(turnFull.params.options.envVars["BB_AGY_SANDBOX_MODE"]).toBe("off");
    expect(
      turnFull.params.options.envVars["BB_AGY_SANDBOX_PROFILE"],
    ).toBeUndefined();

    controller.onClose();
    expect(fs.existsSync(firstProfile!)).toBe(false);
  });

  it("routes run_unsandboxed_command to BB interaction/request and runs only on allow_once", async () => {
    const execMock = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "unsandboxed-ok\n",
      stderr: "",
      timedOut: false,
      aborted: false,
      truncated: false,
    }));
    const { controller, innerReceived, runtimeReceived, tmp } = createHarness({
      executeCommand: execMock,
    });

    controller.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "thread/start",
        params: {
          threadId: "thr_2",
          cwd: tmp,
          options: {
            permissionMode: "auto",
            permissionEscalation: "ask",
            providerOptions: { sandbox: { enabled: true } },
          },
        },
      }),
    );

    const intercepted = controller.interceptOutboundLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 77,
        method: "item/tool/call",
        params: {
          providerThreadId: "prov_2",
          threadId: "thr_2",
          turnId: null,
          callId: "call_1",
          tool: UNSANDBOXED_COMMAND_TOOL_NAME,
          arguments: {
            command: "echo hello > ~/.config/test",
            reason: "Write config outside workspace",
          },
        },
      }),
    );
    expect(intercepted).toBe(true);
    expect(execMock).not.toHaveBeenCalled();
    expect(runtimeReceived).toHaveLength(1);
    const interactionReq =
      runtimeReceived[0] as unknown as InteractionRequestMsg;
    expect(interactionReq.method).toBe("interaction/request");
    expect(interactionReq.params.payload).toMatchObject({
      kind: "approval",
      subject: {
        kind: "command",
        command: "echo hello > ~/.config/test",
      },
      reason: "Write config outside workspace",
      availableDecisions: ["allow_once", "deny"],
    });

    // User approves once -> command executes and inner bridge gets toolCallResultSchema payload.
    controller.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: interactionReq.id,
        result: { decision: "allow_once", grantedPermissions: null },
      }),
    );

    await vi.waitFor(() => {
      expect(findMessageById(innerReceived, 77)).toBeDefined();
    });
    expect(execMock).toHaveBeenCalledTimes(1);
    const toolResp = findMessageById(innerReceived, 77)!;
    expect(toolResp.result.success).toBe(true);
    expect(toolResp.result.contentItems[0]?.text).toContain("unsandboxed-ok");
  });

  it("refuses run_unsandboxed_command on deny and auto-denies when permissionEscalation is deny", () => {
    const execMock = vi.fn();
    const { controller, innerReceived, runtimeReceived, tmp } = createHarness({
      executeCommand: execMock,
    });

    // Case 1: unattended turn (permissionEscalation: "deny")
    controller.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "thread/start",
        params: {
          threadId: "thr_unattended",
          cwd: tmp,
          options: {
            permissionMode: "auto",
            permissionEscalation: "deny",
            providerOptions: { sandbox: { enabled: true } },
          },
        },
      }),
    );

    controller.interceptOutboundLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 88,
        method: "item/tool/call",
        params: {
          providerThreadId: "prov_u",
          threadId: "thr_unattended",
          turnId: null,
          callId: "call_u",
          tool: UNSANDBOXED_COMMAND_TOOL_NAME,
          arguments: { command: "touch ~/x", reason: "test" },
        },
      }),
    );
    expect(runtimeReceived).toHaveLength(0);
    expect(execMock).not.toHaveBeenCalled();
    const unattendedResp = findMessageById(innerReceived, 88)!;
    expect(unattendedResp.result.success).toBe(false);
    expect(unattendedResp.result.contentItems[0]?.text).toContain("unattended");

    // Case 2: user clicks Deny
    controller.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "thread/start",
        params: {
          threadId: "thr_deny",
          cwd: tmp,
          options: {
            permissionMode: "auto",
            permissionEscalation: "ask",
            providerOptions: { sandbox: { enabled: true } },
          },
        },
      }),
    );
    controller.interceptOutboundLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "item/tool/call",
        params: {
          providerThreadId: "prov_d",
          threadId: "thr_deny",
          turnId: null,
          callId: "call_d",
          tool: UNSANDBOXED_COMMAND_TOOL_NAME,
          arguments: { command: "touch ~/y", reason: "test deny" },
        },
      }),
    );
    const req = runtimeReceived[0] as unknown as InteractionRequestMsg;
    controller.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        result: { decision: "deny" },
      }),
    );
    expect(execMock).not.toHaveBeenCalled();
    const denyResp = findMessageById(innerReceived, 99)!;
    expect(denyResp.result.success).toBe(false);
    expect(denyResp.result.contentItems[0]?.text).toContain("User denied");
  });
});
