import { StringEnum, Type } from "@mariozechner/pi-ai";
import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { formatSearchResults, searchWeb } from "./core.mjs";

const webSearchTool = defineTool({
  name: "web_search",
  label: "Web Search",
  description:
    "Search the public web and return likely source URLs. Use this for discovery; fetch chosen pages separately with bash/curl when you need the full contents.",
  promptSnippet: "Search the public web for likely source URLs via Exa or Brave.",
  promptGuidelines: [
    "Use this tool to discover URLs first; use bash/curl for page fetches and follow-up extraction.",
    "Prefer separate web_search calls for unrelated topics so results stay easy to inspect.",
  ],
  parameters: Type.Object({
    query: Type.String({ description: "Search query." }),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 10,
        description: "Maximum number of results to return. Default 5.",
      })
    ),
    provider: Type.Optional(
      StringEnum(["exa", "brave"] as const, {
        description:
          "Optional provider override. Defaults to Exa when EXA_API_KEY is set, otherwise Brave when BRAVE_SEARCH_API_KEY or BRAVE_API_KEY is set.",
      })
    ),
  }),
  async execute(_toolCallId, params, signal) {
    const result = await searchWeb({
      limit: params.limit,
      provider: params.provider,
      query: params.query,
      signal,
    });

    return {
      content: [{ type: "text", text: formatSearchResults(result) }],
      details: {
        provider: result.provider,
        resultCount: result.results.length,
        results: result.results,
      },
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(webSearchTool);
}
