import {
  createAgentSession,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type ExtensionContext,
  type ModelRegistry,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { Check, Convert } from "typebox/value";

import { toJsonValue, type AgentOptions, type JsonValue } from "./domain.ts";
import { resolveRequestedModel, thinkingLevelForEffort } from "./model-select.ts";
import { errorMessage } from "./prelude.ts";
import type { AgentRunner, AgentRunResult } from "./runtime.ts";

/**
 * Total structured-output solicitations before failing: the initial prompt plus
 * up to four repair prompts. `terminate` ends the turn on capture when it is the
 * only call in the batch, but this bounded loop plus prose extraction remain the
 * fallback when the model batches the tool call with other work.
 */
const MAX_STRUCTURED_OUTPUT_RETRIES = 5;

/** Session events that count as agent progress for the stall watchdog. */
const PROGRESS_EVENT_TYPES = new Set([
  "turn_start",
  "message_update",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

/** Pi SDK-backed AgentRunner. */
export class PiAgentRunner implements AgentRunner {
  private readonly cwd: string;
  private readonly model: ExtensionContext["model"];
  private readonly modelRegistry: ModelRegistry;

  constructor(cwd: string, model: ExtensionContext["model"], modelRegistry: ModelRegistry) {
    this.cwd = cwd;
    this.model = model;
    this.modelRegistry = modelRegistry;
  }

  async run(
    prompt: string,
    options: AgentOptions & { readonly signal: AbortSignal; readonly onProgress?: () => void },
  ): Promise<AgentRunResult> {
    const capture: StructuredCapture = { called: false };
    // createAgentSession enables read/bash/edit/write by default, so only the
    // schema tool needs to be supplied here.
    const customTools: ToolDefinition[] = [];
    if (options.schema !== undefined) customTools.push(createStructuredOutputTool(options.schema, capture));

    // Unknown model/effort throws before the session exists: the agent call
    // fails (a parallel slot becomes null) rather than running on the wrong tier.
    const model = options.model !== undefined ? resolveRequestedModel(this.modelRegistry, options.model) : this.model;
    const thinkingLevel = options.effort !== undefined ? thinkingLevelForEffort(options.effort) : undefined;

    const agentDir = getAgentDir();
    const { session } = await createAgentSession({
      cwd: this.cwd,
      agentDir,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.create(this.cwd, agentDir),
      customTools,
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });

    const onProgress = options.onProgress;
    const unsubscribe = onProgress
      ? session.subscribe((event) => {
          if (PROGRESS_EVENT_TYPES.has(event.type)) onProgress();
        })
      : undefined;
    let removeAbortListener: (() => void) | undefined;
    try {
      if (options.signal.aborted) throw new Error("Subagent was aborted");
      const onAbort = () => void session.abort();
      options.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => options.signal.removeEventListener("abort", onAbort);

      await session.prompt(buildPrompt(prompt, options, options.schema !== undefined));
      if (options.signal.aborted) throw new Error("Subagent was aborted");

      let value: JsonValue;
      if (options.schema !== undefined) {
        value = await resolveStructuredOutput(session, capture, options.schema, options.signal);
      } else {
        const text = lastAssistantText(session.messages);
        if (!text.trim()) throw new Error("Subagent produced no assistant output");
        value = text;
      }

      const { tokens } = session.getSessionStats();
      return {
        value,
        outputTokens: tokens.output,
      };
    } finally {
      unsubscribe?.();
      removeAbortListener?.();
      session.dispose();
    }
  }
}

interface StructuredCapture {
  called: boolean;
  value?: JsonValue;
}

function createStructuredOutputTool(schema: JsonValue, capture: StructuredCapture): ToolDefinition {
  return {
    name: "structured_output",
    label: "Structured Output",
    description: "Return the structured value required by the workflow schema.",
    parameters: asSchema(schema),
    async execute(_toolCallId, params) {
      const value = toJsonValue(params);
      if (value === undefined) throw new Error("structured_output arguments must be JSON data");
      capture.called = true;
      capture.value = value;
      return {
        content: [{ type: "text", text: "Structured output captured." }],
        details: { captured: true },
        // End the turn on capture when structured_output is the only call in
        // the batch; the repair loop covers the batched-call case.
        terminate: true,
      };
    },
  };
}

async function resolveStructuredOutput(
  session: StructuredSession,
  capture: StructuredCapture,
  schema: JsonValue,
  signal: AbortSignal,
): Promise<JsonValue> {
  if (capture.called && capture.value !== undefined) return capture.value;
  try {
    session.setActiveToolsByName(["structured_output"]);
  } catch {
    // Repair prompt still helps when active-tool narrowing is unavailable.
  }
  // The initial prompt already counts as one solicitation, so allow up to
  // MAX_STRUCTURED_OUTPUT_RETRIES - 1 repair prompts.
  for (let attempt = 0; attempt < MAX_STRUCTURED_OUTPUT_RETRIES - 1 && !capture.called; attempt += 1) {
    if (signal.aborted) throw new Error("Subagent was aborted");
    await session.prompt(
      "You did not call the structured_output tool. Call structured_output now as your only action, with the required fields filled in. Do not write prose.",
    );
  }
  if (capture.called && capture.value !== undefined) return capture.value;

  const extracted = extractValidatedJson(lastAssistantText(session.messages), schema);
  if (extracted !== undefined) return extracted;
  throw new Error(
    `agent({schema}): StructuredOutput retry cap (${MAX_STRUCTURED_OUTPUT_RETRIES}) exceeded with no valid output`,
  );
}

function buildPrompt(prompt: string, options: AgentOptions, structured: boolean): string {
  const parts = [
    options.phase ? `Workflow phase: ${options.phase}` : undefined,
    options.label ? `Task label: ${options.label}` : undefined,
    prompt,
  ].filter(Boolean);
  if (structured) {
    parts.push(
      [
        "Final output contract:",
        "- Your final action MUST be a structured_output tool call.",
        "- The structured_output arguments are the return value of this subagent.",
        "- Do not emit a prose final answer instead of structured_output.",
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

function lastAssistantText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "assistant") continue;
    if (typeof message.content === "string") return message.content;
    if (!Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part): part is { readonly type: "text"; readonly text: string } =>
        isRecord(part) && part.type === "text" && typeof part.text === "string",
      )
      .map((part) => part.text)
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

function extractValidatedJson(text: string, schema: JsonValue): JsonValue | undefined {
  const block = findJsonBlock(text);
  if (!block) return undefined;
  try {
    const parsed = JSON.parse(block) as unknown;
    const converted = Convert(asSchema(schema), parsed);
    if (Check(asSchema(schema), converted)) return toJsonValue(converted);
  } catch (error) {
    console.warn(`[workflow] structured output prose extraction failed: ${errorMessage(error)}`);
  }
  return undefined;
}

function findJsonBlock(text: string): string | undefined {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fence?.[1]) return fence[1].trim();
  const start = text.search(/[{[]/u);
  if (start === -1) return undefined;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

function asSchema(value: JsonValue): TSchema {
  return value as unknown as TSchema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface StructuredSession {
  readonly messages: readonly unknown[];
  prompt(text: string): Promise<void>;
  setActiveToolsByName(names: string[]): void;
}
