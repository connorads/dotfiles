import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 5;
const EXA_TEXT_MAX_CHARACTERS = 300;

const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");
let cachedConfig = null;

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  if (!existsSync(CONFIG_PATH)) { cachedConfig = {}; return cachedConfig; }
  try {
    cachedConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch (err) {
    console.error(`[web-search] failed to parse ${CONFIG_PATH}: ${err.message}`);
    cachedConfig = {};
  }
  return cachedConfig;
}

/** @internal Reset cached config (for tests). */
export function _resetConfigCache() {
  cachedConfig = null;
}

function normalizeKey(v) {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export const PROVIDERS = {
  exa: {
    label: "Exa",
    envVars: ["EXA_API_KEY"],
    configKey: "exaApiKey",
    async search({ query, limit, apiKey, fetchImpl, signal }) {
      const response = await fetchImpl("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          query,
          numResults: limit,
          contents: {
            text: {
              maxCharacters: EXA_TEXT_MAX_CHARACTERS,
            },
          },
        }),
        signal,
      });

      const json = await readJsonResponse(response, "Exa");
      return {
        provider: "exa",
        results: normaliseExaResults(json),
      };
    },
  },
  brave: {
    label: "Brave",
    envVars: ["BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY"],
    configKey: "braveApiKey",
    async search({ query, limit, apiKey, fetchImpl, signal }) {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(limit));
      url.searchParams.set("result_filter", "web");
      url.searchParams.set("text_decorations", "false");

      const response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal,
      });

      const json = await readJsonResponse(response, "Brave");
      return {
        provider: "brave",
        results: normaliseBraveResults(json),
      };
    },
  },
};

export function resolveProvider(provider, env = process.env) {
  if (provider) {
    if (!(provider in PROVIDERS)) {
      throw new Error(`Unsupported provider '${provider}'. Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`);
    }
    return provider;
  }

  if (getProviderApiKey("exa", env)) {
    return "exa";
  }

  if (getProviderApiKey("brave", env)) {
    return "brave";
  }

  return "exa";
}

export function getProviderApiKey(provider, env = process.env) {
  const providerDef = PROVIDERS[provider];
  const fromEnv = providerDef.envVars
    .map((name) => normalizeKey(env[name]))
    .find(Boolean);
  if (fromEnv) return fromEnv;
  return normalizeKey(loadConfig()[providerDef.configKey]);
}

export async function searchWeb({
  env = process.env,
  fetchImpl = fetch,
  limit = DEFAULT_LIMIT,
  provider,
  query,
  signal,
}) {
  const resolvedProvider = resolveProvider(provider, env);
  const apiKey = getProviderApiKey(resolvedProvider, env);
  if (!apiKey) {
    const p = PROVIDERS[resolvedProvider];
    const envVars = p.envVars.join(" or ");
    throw new Error(
      `Missing API key for ${p.label}. Either:\n` +
      `  1. Set ${envVars} environment variable\n` +
      `  2. Add "${p.configKey}" to ${CONFIG_PATH}`
    );
  }

  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Query must be a non-empty string.");
  }

  return await PROVIDERS[resolvedProvider].search({
    apiKey,
    fetchImpl,
    limit: normaliseLimit(limit),
    query: query.trim(),
    signal,
  });
}

export function formatSearchResults({ provider, results }) {
  const providerLabel = PROVIDERS[provider]?.label ?? provider;
  if (!Array.isArray(results) || results.length === 0) {
    return `Provider: ${providerLabel}\nNo results.`;
  }

  return [`Provider: ${providerLabel}`, ...results.map(formatResult)].join("\n\n");
}

function formatResult(result, index) {
  const lines = [`${index + 1}. ${result.title}`, result.url];
  if (result.snippet) {
    lines.push(result.snippet);
  }
  return lines.join("\n");
}

function normaliseLimit(limit) {
  if (!Number.isInteger(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, limit));
}

async function readJsonResponse(response, providerLabel) {
  if (response.ok) {
    return await response.json();
  }

  const detail = await readErrorDetail(response);
  throw new Error(`${providerLabel} search failed: ${response.status}${detail ? ` ${detail}` : ""}`.trim());
}

async function readErrorDetail(response) {
  try {
    const json = await response.json();
    const detail = json?.error?.detail ?? json?.error?.message ?? json?.message;
    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail.trim();
    }
  } catch {
    // fall through to text
  }

  try {
    const text = await response.text();
    if (typeof text === "string" && text.trim().length > 0) {
      return text.trim();
    }
  } catch {
    // ignore
  }

  return "";
}

function normaliseExaResults(json) {
  return (json?.results ?? [])
    .map((result) => {
      const url = toNonEmptyString(result?.url);
      if (!url) {
        return null;
      }
      return {
        title: toNonEmptyString(result?.title) ?? url,
        url,
        snippet: firstNonEmptyString([
          result?.text,
          ...(Array.isArray(result?.highlights) ? result.highlights : []),
        ]),
      };
    })
    .filter(Boolean);
}

function normaliseBraveResults(json) {
  return (json?.web?.results ?? [])
    .map((result) => {
      const url = toNonEmptyString(result?.url);
      if (!url) {
        return null;
      }
      return {
        title: toNonEmptyString(result?.title) ?? url,
        url,
        snippet: firstNonEmptyString([
          result?.description,
          ...(Array.isArray(result?.extra_snippets) ? result.extra_snippets : []),
        ]),
      };
    })
    .filter(Boolean);
}

function firstNonEmptyString(values) {
  for (const value of values) {
    const text = toNonEmptyString(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function toNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
