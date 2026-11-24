import { spawn } from "node:child_process";
import { z } from "zod";

export const UNSANDBOXED_COMMAND_TOOL_NAME = "run_unsandboxed_command";

export const UNSANDBOXED_COMMAND_TOOL_SPEC = {
  name: UNSANDBOXED_COMMAND_TOOL_NAME,
  description:
    "Run a single shell command outside the workspace sandbox after explicit user approval. Use ONLY when a command inside the workspace sandbox failed with Operation not permitted and genuinely requires access outside the workspace (such as editing ~/.config, another repository, or installing a global tool).",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The exact shell command to run outside the sandbox.",
      },
      reason: {
        type: "string",
        description:
          "Concise explanation of why this command requires unsandboxed access.",
      },
      cwd: {
        type: "string",
        description:
          "Optional working directory for the command (defaults to the thread workspace).",
      },
    },
    required: ["command", "reason"],
    additionalProperties: false,
  },
} as const;

export const SANDBOX_GUIDANCE_INSTRUCTIONS = [
  "You are running inside a workspace-write sandbox. Files inside your workspace, linked Git worktree metadata, temp directories, standard caches, and the `bb` CLI work normally.",
  `If a shell command fails with "Operation not permitted" because it genuinely needs write or read access outside the workspace, call \`${UNSANDBOXED_COMMAND_TOOL_NAME}\` with the exact command and reason so the user can approve that single command; do not invent workarounds or thrash.`,
].join(" ");

export const unsandboxedCommandArgsSchema = z
  .object({
    command: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    cwd: z.string().trim().min(1).optional(),
  })
  .strict();

export type UnsandboxedCommandArgs = z.infer<typeof unsandboxedCommandArgsSchema>;

export interface UnsandboxedCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export function executeUnsandboxedCommand(args: {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}): Promise<UnsandboxedCommandResult> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = args.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const shell = process.platform === "darwin" ? "/bin/zsh" : "/bin/sh";
  const shellArgs =
    process.platform === "darwin" ? ["-lc", args.command] : ["-c", args.command];

  return new Promise((resolve) => {
    if (args.signal?.aborted) {
      resolve({
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "Command cancelled before starting.",
        timedOut: false,
        aborted: true,
        truncated: false,
      });
      return;
    }

    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...args.env };
    delete childEnv["BB_AGY_SANDBOX_MODE"];
    delete childEnv["BB_AGY_SANDBOX_PROFILE"];

    const child = spawn(shell, shellArgs, {
      cwd: args.cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (totalBytes >= maxOutputBytes) {
        truncated = true;
        return;
      }
      const remaining = maxOutputBytes - totalBytes;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      if (chunk.length > remaining) {
        truncated = true;
      }
      totalBytes += slice.length;
      const text = slice.toString("utf8");
      if (target === "stdout") stdout += text;
      else stderr += text;
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    const killChild = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore already-exited child.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, timeoutMs);

    const onAbort = () => {
      aborted = true;
      killChild();
    };
    args.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        aborted,
        truncated,
      });
    };

    child.on("error", (error) => {
      stderr += `${stderr ? "\n" : ""}${error.message}`;
      finish(1, null);
    });
    child.on("close", (code, signal) => {
      finish(code, signal);
    });
  });
}

export function formatUnsandboxedCommandOutput(
  result: UnsandboxedCommandResult,
): { success: boolean; text: string } {
  const parts: string[] = [];
  if (result.aborted) {
    parts.push("Command cancelled.");
  } else if (result.timedOut) {
    parts.push("Command timed out.");
  } else if (result.signal) {
    parts.push(`Command terminated by signal ${result.signal}.`);
  } else {
    parts.push(`Exit code: ${result.exitCode ?? 1}`);
  }
  if (result.stdout.trim().length > 0) {
    parts.push(`stdout:\n${result.stdout.trimEnd()}`);
  }
  if (result.stderr.trim().length > 0) {
    parts.push(`stderr:\n${result.stderr.trimEnd()}`);
  }
  if (result.truncated) {
    parts.push("[output truncated]");
  }
  const success =
    !result.aborted &&
    !result.timedOut &&
    result.signal === null &&
    result.exitCode === 0;
  return { success, text: parts.join("\n\n") };
}
