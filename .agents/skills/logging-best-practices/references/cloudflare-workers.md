# Cloudflare Workers — logging-best-practices reference

Concrete guidance for implementing the wide-event / canonical-log-line pattern on Cloudflare Workers. Read `SKILL.md` first for the principles; this file covers *how*.

## Retrieval first — trust live docs over this file

Cloudflare's observability surface changes weekly: limits, `wrangler` config shape, billing status of beta features (native tracing), and which OTLP transports are supported all shift. **Before writing code or citing a specific number, fetch the current docs.** Treat this reference as the *shape of the solution*, not the source of truth for API details.

| Retrieve from | For |
|---|---|
| `developers.cloudflare.com/workers/observability/` | Current config keys, sampling rates, per-plan limits, retention |
| `developers.cloudflare.com/analytics/analytics-engine/` | `writeDataPoint` signature, blob/double/index limits, sampling semantics, `_sample_interval` |
| `node_modules/wrangler/config-schema.json` (or `npx wrangler types`) | Allowed `observability.*` and `analytics_engine_datasets` fields in the installed Wrangler |
| `developers.cloudflare.com/changelog/` | Recent deprecations, new OTLP destinations, billing changes |
| `@cloudflare/workers-types` | Types for `Request.cf`, `AnalyticsEngineDataset`, `TraceItem` (for Tail Workers) |

If this file and the live docs disagree, **trust the docs** — especially for numeric limits, billing/beta status, supported OTLP formats, and exact config-key names. Numbers in this file are illustrative; use them to understand tradeoffs (e.g. "AE is sampled, Workers Logs is not"), not to hard-code thresholds.

## The five observability primitives — pick deliberately

Workers offer distinct primitives that are often conflated. The right answer is usually "enable all five, use each for what it's good at".

| Primitive | Best for | Cardinality | Retention | Query |
|---|---|---|---|---|
| **Workers Logs** | Canonical wide events (human-readable, per-request) | Unlimited | 3–7d | Dashboard Query Builder |
| **Analytics Engine** | High-cardinality numeric metrics (per-tenant, per-route timings) | Unlimited via index | 3 months | SQL API |
| **Native Traces (OTel)** | Spans across handlers, fetch, bindings, DOs | — | Backend-dependent | OTLP backend (Honeycomb, Axiom, Sentry, Grafana) |
| **Tail Workers** | Guaranteed shipping, redaction, aggregation | — | — | Custom Worker |
| **Logpush** | Bulk archive to R2/S3/SIEM | — | — | Downstream |

**Recommended default for a new Worker**: Workers Logs + native Traces + one Analytics Engine dataset, enabled together in `wrangler.jsonc`.

## Enable Workers Logs

Minimum Wrangler 3.78.6.

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "logs": { "invocation_logs": true },
    "traces": {
      "enabled": true,
      "destinations": ["honeycomb-prod"],   // configured in CF dashboard
      "head_sampling_rate": 0.1
    }
  }
}
```

Per-environment: `[env.staging.observability]`. Head sampling decides at request entry and keeps *all* logs in that invocation or drops *all* of them — this preserves trace coherence.

## The key behaviour: `console.log` auto-indexes JSON

Workers Logs detects when `console.log` is called with an object and indexes every field for dashboard filtering, aggregation, and alerting with **unlimited cardinality**. String-concatenated logs produce a single opaque blob that cannot be queried.

```ts
//  Bad — one indexed string, no queryable fields
console.log("user " + userId + " bought " + sku + " for " + amountCents);

//  Good — wide event, every field filterable in Query Builder
console.log({
  msg: "purchase",
  user_id: userId,
  tenant_id: tenantId,
  sku,
  amount_cents: amountCents,
  currency: "GBP",
  cart_size: cart.length,
  ab_variant: "checkout_v3",
  duration_ms: Date.now() - start,
});
```

This is the wide-event pattern on Workers — emit one of these per request at the end of the handler. Limits as of writing: 256 KB per log (then truncated with `$cloudflare.truncated = true`), 20M logs/month included on paid, 5B/day before account-wide sampling kicks in.

## The canonical-event middleware (Hono)

This is the piece of code that, once added to a Worker, upgrades its observability from "bad" to "good". Attach it once; every request gets a wide event for free.

```ts
import { Hono } from "hono";

type Env = { Bindings: { AE: AnalyticsEngineDataset } };
const app = new Hono<Env>();

app.use("*", async (c, next) => {
  const start = Date.now();
  const cf = c.req.raw.cf ?? {};
  const rayId = c.req.header("cf-ray");
  c.set("ray_id", rayId);       // accessible downstream via c.get

  let err: unknown;
  try { await next(); }
  catch (e) { err = e; throw e; }
  finally {
    const duration_ms = Date.now() - start;
    const event = {
      msg: "http.request",
      ray_id: rayId,
      method: c.req.method,
      route:  c.req.routePath,                    // /users/:id — low cardinality
      path:   new URL(c.req.url).pathname,        // /users/123 — high cardinality
      status: c.res.status,
      duration_ms,
      colo: cf.colo,
      country: cf.country,
      asn: cf.asn,
      user_id:   c.get("user_id"),
      tenant_id: c.get("tenant_id"),
      error: err instanceof Error
        ? { name: err.name, message: err.message }
        : undefined,
    };
    console.log(event);                           // → Workers Logs

    // Wide-event metric → Analytics Engine (index by tenant for sampling fairness)
    c.env.AE.writeDataPoint({
      indexes: [c.get("tenant_id") ?? "anon"],
      blobs:   [c.req.routePath, c.req.method, String(c.res.status), cf.colo ?? "", cf.country ?? ""],
      doubles: [duration_ms],
    });
  }
});
```

Handlers annotate via `c.set("user_id", ...)` early in the request; the middleware picks them up in `finally`. Do not use Hono's built-in `logger()` middleware for production — it is dev-time sugar and emits an unstructured string.

## Always-include Cloudflare context

Every wide event on Workers should carry these, because they are the fields that actually let you debug Cloudflare-specific issues (a bad POP, a noisy ASN, a specific region failing).

```ts
function cfContext(req: Request) {
  const cf = req.cf ?? {};
  return {
    ray_id:        req.headers.get("cf-ray"),          // canonical request ID
    client_ip:     req.headers.get("cf-connecting-ip"),
    colo:          cf.colo,                            // LHR, IAD — the POP
    country:       cf.country,
    asn:           cf.asn,
    as_org:        cf.asOrganization,
    tls_version:   cf.tlsVersion,
    http_protocol: cf.httpProtocol,                    // HTTP/2, HTTP/3
    bot_score:     cf.botManagement?.score,
  };
}
```

`cf-ray` is Cloudflare's native request ID (`<hex>-<colo>`). Use it as the correlation key when OTel is not available.

## Analytics Engine — for high-cardinality metrics

Analytics Engine is the right place for per-tenant / per-user timing and count metrics. It uses **weighted adaptive sampling per index value** so rare tenants are preserved while hot ones get downsampled.

```ts
// wrangler.jsonc
{ "analytics_engine_datasets": [ { "binding": "AE", "dataset": "app_events" } ] }

// Worker
env.AE.writeDataPoint({
  indexes: [tenantId],                                    // EXACTLY ONE, ≤ 96 bytes
  blobs:   [route, method, country, colo, String(status), variant],
  doubles: [durationMs, cpuMs, bytesOut, subrequestCount],
});
```

Limits at time of writing: up to 20 blobs, up to 20 doubles, exactly one index (multiple = silently dropped), 16 KB total blob payload, 250 datapoints per invocation, 3-month retention.

**Index choice matters.** The index is what sampling fairness is keyed by. Pick a stable grouping column (`tenant_id`, `customer_id`, `api_key_hash`), *not* a per-request ID like `request_id` — that defeats the sampling benefit.

**Query with `sum(_sample_interval)`, not `count()`.** Every row carries `_sample_interval` (inverse of sample rate); ignoring it gives you wrong numbers for high-traffic indexes.

## Native OpenTelemetry traces

Cloudflare ships automatic tracing as of 2025 (open beta, check current billing status). Spans are emitted for handler invocations, `fetch()`, cache, KV/R2/D1/Queues/DO bindings — no instrumentation code required. W3C `traceparent` propagates automatically across service bindings, subrequests, and Durable Objects.

Current limitations: OTLP/JSON only (not protobuf), so Datadog/Elastic APM do not work without an intermediary. When the workload needs custom spans or protobuf, use [`@microlabs/otel-cf-workers`](https://github.com/evanderkoogh/otel-cf-workers) instead — it requires `compatibility_flags = ["nodejs_compat"]` and gives full OTel SDK control.

When OTel is configured, logs exported via OTLP share the trace ID automatically — backends like Honeycomb/Sentry/Axiom will link traces and logs for you.

## Pitfalls unique to Workers

- **`waitUntil` is unreliable for log flushing.** It gives up to 30s of post-response runtime but is best-effort — if the Worker throws, queued work may be dropped. For billing-critical or audit logs, use a Tail Worker or push to Cloudflare Queues from inside the handler. `console.log` itself does not need `waitUntil`; invocation logs flush via the runtime lifecycle.
- **No filesystem, no long-lived process.** No rotating log files. Everything goes through `console.log`, Analytics Engine, Tail Worker, or Logpush.
- **Isolate reuse.** Module-scope state persists across requests in the same isolate. Per-request state at module scope leaks between users; always scope to the request.
- **Subrequest budget.** 50 free / 1000 paid-bundled / unlimited unbound. Direct HTTP log shipping from the Worker eats this — prefer Workers Logs, Analytics Engine, or Tail Workers which do not count.
- **CPU time limit.** Serialising huge objects into a log call can blow the CPU budget. Cap event size.
- **WebSocket handlers.** `console.log` during a long-lived WebSocket may not appear in `wrangler tail` until the socket closes; prefer Workers Logs or synchronous pushes for visibility.
- **Field naming is forever.** Workers Logs indexes by exact JSON path. Renaming `userId` → `user_id` mid-flight splits your dashboard. Pick once.

## Tail Workers — when you need guaranteed delivery

A Tail Worker runs once per invocation of a producer Worker, *after* the producer finishes, and receives its logs/exceptions/outcome as input. It runs regardless of whether the producer threw — which makes it the right tool for guaranteed shipping and for centralised redaction before egress.

```ts
// tail-worker/src/index.ts
export default {
  async tail(events, env, ctx) {
    for (const e of events) {
      // e.scriptName, e.outcome ("ok" | "exception" | "exceededCpu" | ...)
      // e.logs: { level, message, timestamp }[]
      // e.exceptions: { name, message, timestamp }[]
      // e.event (FetchEventInfo etc.)
      await ship(redact(e), env);
    }
  }
} satisfies ExportedHandler;

// producer wrangler.jsonc
// { "tail_consumers": [{ "service": "tail-worker" }] }
```

Request URLs and headers are redacted by default — call `getUnredacted()` if the Tail Worker needs them.

## Sampling on Workers

Head sampling via `head_sampling_rate` is the simplest lever. For outcome-based tail sampling (keep errors, slow requests, VIP tenants — see `sampling.md`), the pragmatic patterns on Workers are:

1. In-handler keep-rule: always emit to Analytics Engine; `console.log` only when `status >= 400`, `duration_ms > threshold`, or tenant is flagged important.
2. Tail Worker filter: emit everything from the producer, let the Tail Worker decide what to ship downstream.
3. For OTel traces, configure tail sampling in the collector (or at the backend like Honeycomb's Refinery) rather than the Worker.

