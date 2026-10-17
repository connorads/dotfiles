import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { SdkHttpError, UnauthorizedError } from "@modelcontextprotocol/client";
import { parseConfig } from "./src/config.ts";
import { CallCancelledError, ExecutorConnection } from "./src/connection.ts";
import { bindTools, errorResult, toBbResult } from "./src/tools.ts";

const MAX_INSTRUCTIONS = 4096;

/** `fetch` lets tests serve Executor in-process. */
export function createPlugin(options: { fetch?: typeof fetch } = {}) {
  return (bb: BbPluginApi) => load(bb, options);
}

export default createPlugin();

async function load(bb: BbPluginApi, options: { fetch?: typeof fetch }) {
  const settings = bb.settings.define({
    url: {
      type: "string",
      label: "MCP endpoint",
      description: "Use https://mcp.executor.sh/org/<org>/mcp with a full-account key.",
      default: "https://mcp.executor.sh/mcp",
    },
    token: {
      type: "string",
      label: "API key",
      description: "An Executor API key limited to that organization.",
      secret: true,
    },
  });

  const values = await settings.get();
  const parsed = parseConfig({ url: values.url, token: values.token ?? "" });
  if (!parsed.ok) {
    bb.status.needsConfiguration(parsed.message);
    return;
  }

  const connection = new ExecutorConnection(parsed.config, options);
  bb.onDispose(() => connection.close());

  let upstreamTools;
  let serverInstructions;
  try {
    upstreamTools = await connection.listTools();
    serverInstructions = await connection.instructions();
  } catch (error) {
    bb.status.needsConfiguration(connectFailure(parsed.config.url, error));
    return;
  }

  const { bindings, skipped } = bindTools(upstreamTools);
  if (skipped.length > 0) bb.log.warn(`skipped tools whose BB names collide: ${skipped.join(", ")}`);

  for (const { bbName, upstream } of bindings) {
    bb.agents.registerTool({
      name: bbName,
      description: upstream.description ?? upstream.title ?? upstream.name,
      parameters: upstream.inputSchema as Record<string, unknown>,
      presentation: { label: { pending: `Running Executor ${upstream.name}`, completed: `Ran Executor ${upstream.name}` } },
      async execute(params, ctx) {
        try {
          const result = await connection.callTool(upstream.name, asArguments(params), ctx.signal);
          return toBbResult(result);
        } catch (error) {
          if (error instanceof CallCancelledError) return errorResult(error.message);
          return errorResult(`Executor ${upstream.name} failed: ${describe(error)}`);
        }
      },
    });
  }

  const toolNames = bindings.map((b) => b.bbName);
  const instructions = agentInstructions(serverInstructions);
  bb.agents.configure(() => ({ tools: toolNames, skills: [], instructions }));
  bb.log.info(`registered ${toolNames.length} Executor tools`);
}

function agentInstructions(server: string | undefined): string {
  const lead = "Executor tools carry the `executor_` prefix in this thread.";
  const text = server ? `${lead}\n\n${server}` : lead;
  if (text.length <= MAX_INSTRUCTIONS) return text;
  const note = "\n\n[Truncated. Call executor_skills for the full guide.]";
  return text.slice(0, MAX_INSTRUCTIONS - note.length) + note;
}

function asArguments(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
}

function connectFailure(url: URL, error: unknown): string {
  if (error instanceof SdkHttpError && error.status === 403) {
    return "The API key cannot use this organization. Use a key limited to it, or put /org/<org>/mcp in `url`.";
  }
  if (error instanceof UnauthorizedError) return describe(error);
  return `Could not reach Executor at ${url.origin}: ${describe(error)}`;
}

function describe(error: unknown): string {
  if (error instanceof UnauthorizedError) return "Executor rejected the API key. Set a valid `token`.";
  return error instanceof Error ? error.message : String(error);
}
