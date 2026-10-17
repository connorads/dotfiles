import type { CallToolResult, Tool } from "@modelcontextprotocol/client";

type BbContentPart = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type BbToolResult = { content: BbContentPart[]; isError?: boolean };

const PREFIX = "executor_";
const MAX_NAME = 64;

/** Provider tool names must match ^[a-zA-Z0-9_-]{1,64}$. */
export function bbToolName(upstream: string): string {
  return (PREFIX + upstream.replace(/[^a-zA-Z0-9_-]/g, "_")).slice(0, MAX_NAME);
}

export type ToolBinding = { bbName: string; upstream: Tool };

/** Pairs each upstream tool with its BB name; drops later duplicates. */
export function bindTools(tools: readonly Tool[]): { bindings: ToolBinding[]; skipped: string[] } {
  const seen = new Set<string>();
  const bindings: ToolBinding[] = [];
  const skipped: string[] = [];
  for (const upstream of tools) {
    const bbName = bbToolName(upstream.name);
    if (seen.has(bbName)) {
      skipped.push(upstream.name);
      continue;
    }
    seen.add(bbName);
    bindings.push({ bbName, upstream });
  }
  return { bindings, skipped };
}

/**
 * Executor returns each value twice: as `structuredContent` and as its JSON
 * text. Send the structured value once to save tokens.
 */
export function toBbResult(result: CallToolResult): BbToolResult {
  if (result.isError) {
    return { content: [{ type: "text", text: textOf(result) || "Executor reported an error with no message." }], isError: true };
  }
  if (result.structuredContent !== undefined) {
    return { content: [{ type: "text", text: JSON.stringify(result.structuredContent) }] };
  }
  const content = result.content.map(toBbPart);
  return { content: content.length > 0 ? content : [{ type: "text", text: "(empty result)" }] };
}

export function errorResult(message: string): BbToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function toBbPart(part: CallToolResult["content"][number]): BbContentPart {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "image") return { type: "image", data: part.data, mimeType: part.mimeType };
  return { type: "text", text: JSON.stringify(part) };
}

function textOf(result: CallToolResult): string {
  return result.content
    .map((part) => (part.type === "text" ? part.text : JSON.stringify(part)))
    .join("\n");
}
