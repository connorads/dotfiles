import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatSearchResults,
  getProviderApiKey,
  resolveProvider,
  searchWeb,
  _resetConfigCache,
} from "./core.mjs";

test("resolveProvider honours explicit provider", () => {
  const provider = resolveProvider("brave", { EXA_API_KEY: "exa", BRAVE_API_KEY: "brave" });
  assert.equal(provider, "brave");
});

test("resolveProvider prefers Exa, then Brave", () => {
  assert.equal(resolveProvider(undefined, { EXA_API_KEY: "exa" }), "exa");
  assert.equal(resolveProvider(undefined, { BRAVE_SEARCH_API_KEY: "brave" }), "brave");
});

test("searchWeb calls Exa directly and normalises results", async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      async json() {
        return {
          results: [
            {
              title: "Example result",
              url: "https://example.com/article",
              text: "Alpha beta gamma",
            },
          ],
        };
      },
    };
  };

  const result = await searchWeb({
    query: "example query",
    env: { EXA_API_KEY: "exa-key" },
    fetchImpl,
    limit: 3,
    provider: "exa",
  });

  assert.equal(request.url, "https://api.exa.ai/search");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["x-api-key"], "exa-key");
  assert.deepEqual(JSON.parse(request.init.body), {
    query: "example query",
    numResults: 3,
    contents: {
      text: {
        maxCharacters: 300,
      },
    },
  });
  assert.deepEqual(result, {
    provider: "exa",
    results: [
      {
        title: "Example result",
        url: "https://example.com/article",
        snippet: "Alpha beta gamma",
      },
    ],
  });
});

test("searchWeb calls Brave directly and normalises results", async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      async json() {
        return {
          web: {
            results: [
              {
                title: "Brave result",
                url: "https://example.com/brave",
                description: "Primary snippet",
                extra_snippets: ["Secondary snippet"],
              },
            ],
          },
        };
      },
    };
  };

  const result = await searchWeb({
    query: "brave query",
    env: { BRAVE_SEARCH_API_KEY: "brave-key" },
    fetchImpl,
    limit: 2,
    provider: "brave",
  });

  assert.equal(request.init.method, "GET");
  assert.equal(request.init.headers["X-Subscription-Token"], "brave-key");
  const url = new URL(request.url);
  assert.equal(url.origin, "https://api.search.brave.com");
  assert.equal(url.pathname, "/res/v1/web/search");
  assert.equal(url.searchParams.get("q"), "brave query");
  assert.equal(url.searchParams.get("count"), "2");
  assert.deepEqual(result, {
    provider: "brave",
    results: [
      {
        title: "Brave result",
        url: "https://example.com/brave",
        snippet: "Primary snippet",
      },
    ],
  });
});

test("formatSearchResults renders numbered output", () => {
  const text = formatSearchResults({
    provider: "exa",
    results: [
      {
        title: "Result one",
        url: "https://example.com/one",
        snippet: "Snippet one",
      },
      {
        title: "Result two",
        url: "https://example.com/two",
      },
    ],
  });

  assert.match(text, /Provider: Exa/);
  assert.match(text, /1\. Result one/);
  assert.match(text, /https:\/\/example.com\/one/);
  assert.match(text, /Snippet one/);
  assert.match(text, /2\. Result two/);
});

test("searchWeb errors clearly when no provider key is configured", async () => {
  await assert.rejects(
    () => searchWeb({ query: "missing keys", env: {} }),
    /Missing API key for Exa/
  );
});

test("getProviderApiKey prefers env var over config file", () => {
  _resetConfigCache();
  const key = getProviderApiKey("exa", { EXA_API_KEY: "from-env" });
  assert.equal(key, "from-env");
});

test("getProviderApiKey ignores empty env vars", () => {
  _resetConfigCache();
  const key = getProviderApiKey("exa", { EXA_API_KEY: "" });
  assert.equal(key, undefined);
});

test("error message mentions both env var and config file", async () => {
  _resetConfigCache();
  await assert.rejects(
    () => searchWeb({ query: "test", env: {} }),
    /EXA_API_KEY.*environment variable|"exaApiKey".*web-search\.json/s
  );
});
