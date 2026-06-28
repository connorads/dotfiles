#!/usr/bin/env node
// HTTP proxy that sits in front of the AI Gateway on sandbox workers.
//
// Two modes, picked by which UPSTREAM env var is set:
//
//   ANTHROPIC_UPSTREAM_BASE_URL  → Anthropic mode. Strips
//     `eager_input_streaming` from tool schemas in outgoing JSON bodies
//     so requests routed to Bedrock don't get rejected with
//     "Extra inputs are not permitted".
//
//   OPENAI_UPSTREAM_BASE_URL     → OpenAI mode. Transparent forwarder for
//     Codex-CLI traffic. No body mutation needed today.
//
// The Claude Agent SDK / Codex CLI talks to us via ANTHROPIC_BASE_URL or
// OPENAI_BASE_URL set to http://127.0.0.1:PROXY_PORT (or .../v1 for OpenAI).
//
// Env:
//   PROXY_PORT                     (default 8787)
//   ANTHROPIC_UPSTREAM_BASE_URL    real gateway URL for Anthropic
//   OPENAI_UPSTREAM_BASE_URL       real gateway URL for OpenAI

import http from "node:http";

const PORT = Number(process.env.PROXY_PORT ?? 8787);

const ANTHROPIC_UPSTREAM = (process.env.ANTHROPIC_UPSTREAM_BASE_URL || "").replace(/\/$/, "");
const OPENAI_UPSTREAM = (process.env.OPENAI_UPSTREAM_BASE_URL || "").replace(/\/$/, "");

if (!ANTHROPIC_UPSTREAM && !OPENAI_UPSTREAM) {
  console.error("proxy: neither ANTHROPIC_UPSTREAM_BASE_URL nor OPENAI_UPSTREAM_BASE_URL is set");
  process.exit(1);
}

const MODE = OPENAI_UPSTREAM ? "openai" : "anthropic";
const UPSTREAM = OPENAI_UPSTREAM || ANTHROPIC_UPSTREAM;

function stripEager(v) {
  if (Array.isArray(v)) {
    for (const x of v) stripEager(x);
    return;
  }
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) {
      if (k === "eager_input_streaming") {
        delete v[k];
        continue;
      }
      stripEager(v[k]);
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = Buffer.concat(chunks);

    if (MODE === "anthropic" && body.length) {
      const ct = (req.headers["content-type"] || "").toLowerCase();
      if (ct.includes("application/json")) {
        try {
          const json = JSON.parse(body.toString("utf8"));
          stripEager(json);
          body = Buffer.from(JSON.stringify(json));
        } catch {
          // not valid JSON — pass through
        }
      }
    }

    // Forward headers but drop hop-by-hop + content-length (recomputed on re-encode)
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (lk === "host" || lk === "content-length" || lk === "connection") continue;
      headers[k] = v;
    }

    const url = UPSTREAM + req.url;
    const up = await fetch(url, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
    });

    for (const [k, v] of up.headers.entries()) {
      const lk = k.toLowerCase();
      if (lk === "content-encoding" || lk === "transfer-encoding" || lk === "connection") continue;
      res.setHeader(k, v);
    }
    res.statusCode = up.status;

    if (up.body) {
      const reader = up.body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    console.error("proxy error:", err?.stack ? err.stack : err);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "text/plain");
    }
    try {
      res.end(`proxy error: ${err?.message ? err.message : String(err)}`);
    } catch {}
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`request-proxy listening on 127.0.0.1:${PORT}, mode=${MODE}, upstream=${UPSTREAM}`);
});

// Keep the process alive even if the parent exits (nohup behavior).
process.on("SIGHUP", () => {});
