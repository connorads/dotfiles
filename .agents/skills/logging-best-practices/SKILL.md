---
name: logging-best-practices
description: Design, review, or refactor logging for a service so it works as an observability primitive — the canonical wide-event / structured-log pattern. Use when the user is setting up logging for a new service, adding or auditing middleware, building a logger config (structlog, pino, winston), enabling Cloudflare Workers observability or Analytics Engine, instrumenting OpenTelemetry logs, planning sampling strategy, proposing logging schema changes, or saying things like "our logs are noisy", "we can't find anything in the logs", "improve our logging", or "add proper logging". Do NOT trigger for single casual `console.log`/`print`/`logger.info` additions during unrelated work.
references:
  - python
  - cloudflare-workers
  - sampling
---

# Logging Best Practices

Most logging code is written as if it were for a monolith circa 2010: scattered `console.log` / `logger.info` calls printing human-readable strings that tell a reader what the code *is doing*. In a distributed system under load that approach fails in predictable ways — you get 10k lines of noise per minute, no way to correlate across services, and when the incident hits you can answer "did it crash?" but not "which customers were affected, on which deploy, in which region". This skill exists to push code toward an observability primitive that actually works: **one structured, context-rich event per unit of work**.

The core ideas come from Stripe's [canonical log lines](https://stripe.com/blog/canonical-log-lines), the wide-events / observability-2.0 lineage (Charity Majors et al.), and Boris Tane's [loggingsucks.com](https://loggingsucks.com) manifesto and [logging-best-practices skill](https://github.com/boristane/agent-skills). This skill adapts and extends that work with concrete guidance for Python and Cloudflare Workers.

## When to apply

Any time logging code is being written, reviewed, or designed — whether that's a fresh service, a debug session, or "just adding a log line". The reframe matters even for single log additions: before adding `logger.info("thing happened")`, ask whether this should instead enrich a canonical event for the current request.

## When triggered, do this first

A short orchestration recipe to avoid jumping straight to "write some logger code". Skip steps that are obviously already done.

1. **Identify the runtime** so you load the correct reference. Check `package.json` / `pyproject.toml` / `wrangler.jsonc`. If it is a multi-service repo, ask which service.
2. **Audit what exists**, before proposing changes:
   - Where is the logger configured? (search for `structlog.configure`, `pino(`, `winston.createLogger`, `logging.basicConfig`, `console.log`)
   - Is there middleware or a request hook? (search for `app.use`, `add_middleware`, `Middleware`)
   - How many distinct call sites — `console.log` / `logger.info` / `print` / `log.info`? A rough count tells you whether this is greenfield, growing, or legacy-debt territory.
   - Where do logs end up? (stdout? file? a vendor SDK? Workers Logs? Logpush?)
3. **Identify the unit of work** — HTTP request, queue handler, cron tick, CLI invocation. The canonical event is per unit of work; you need to know what that is before you can wrap it.
4. **Plan the change in this order**, and confirm with the user before implementing anything large:
   - Logger configuration (one place, structured JSON to stdout, contextvars wired).
   - Canonical middleware/wrapper around the unit of work.
   - Helper for handlers to annotate the in-flight event.
   - Migration plan for existing log calls (do not delete them all at once — see "A note on retrofitting" below).
5. **Load the matching reference** before writing platform-specific code. Then implement.
6. **Verify**: hit the service (or run the script), inspect a real emitted event, confirm it has identity / environment / business / perf+outcome fields populated. If any of the four categories is missing, the work is not done.

For tiny tasks ("our health check is spamming logs"), skip the audit and go straight to step 4 — the recipe is for the common "improve our logging" ask.

## Pick the implementation reference — before writing code

Load the reference that matches the runtime **before writing any code**. The principles here are platform-agnostic; real correctness (API signatures, middleware wiring, platform quirks) lives in the references. Skipping this step is how you produce plausible-looking code that misuses the platform — `waitUntil` as a log sink on Workers, `BaseHTTPMiddleware` that silently loses contextvars in Python.

| Runtime | Reference |
|---|---|
| Python services (FastAPI, Starlette, Django, Flask, Celery, scripts) | [`references/python.md`](references/python.md) |
| Cloudflare Workers (Hono, raw fetch handler, Durable Objects, Workers AI) | [`references/cloudflare-workers.md`](references/cloudflare-workers.md) |
| Any runtime — cross-cutting sampling strategy | [`references/sampling.md`](references/sampling.md) |

For stacks not yet covered (Node/Express, Go, Rust): load the closest reference as a template. The shape of the solution (structured logger + canonical middleware + finally-emit) is the same; substitute the idiomatic library (`pino`, `slog`, `tracing`) and framework hook.

## The pattern in one place (pseudocode)

Every concrete implementation in the references is a variation of this shape. If you are tempted to skip loading a reference, re-read this block — the real code needs library-specific APIs, context-propagation mechanics, and platform pitfalls that pseudocode cannot capture.

```
# At service startup: configure the structured logger once (JSON to stdout).

# Per unit of work (HTTP request, queue message, cron tick):

on entry:
    event = {
        request_id:   new_or_inherited_id(),
        service:      "checkout",
        version:      BUILD_SHA,
        environment:  "prod",
        # + whatever environment/identity fields the platform gives you
    }
    bind_into_context(request_id = event.request_id)   # so nested logs carry it
    start = now()

    try:
        run_handler()      # handlers call annotate(user_id=..., tenant_id=..., cart_total_cents=...)
    except Exception as exc:
        event.error_class   = type(exc).__name__
        event.error_message = str(exc)
        raise              # re-raise; do NOT log-and-raise
    finally:
        event.duration_ms   = now() - start
        event.status_code   = response.status
        event.route         = route_template            # low-cardinality
        event.path          = raw_path                  # high-cardinality
        logger.info(event)                              # the one canonical event
```

## Core principles

### 1. Emit one canonical wide event per unit of work

A "unit of work" is an HTTP request, a queue message, a cron tick, a CLI invocation. Allocate an event object at entry, let middleware *and* business logic annotate it as work happens, and emit it **once** in a `finally` block at exit. The `finally` matters — you want the event even when the handler throws, because that is the case you most need to debug.

The mental shift is from "log what the code is doing" (imperative, noisy, unqueryable) to "record what happened to this request" (declarative, one row, queryable). A good canonical event answers every reasonable question about a single request in one place: identity, input, business context, perf, outcome, error.

### 2. High cardinality and high dimensionality are features, not costs

Cardinality is the number of unique values a field can take. `user_id` is high cardinality (millions). `http_method` is low cardinality (a handful). Dimensionality is the number of fields per event; 20–100 is a healthy target. Both matter because you cannot predict at write-time which dimension will be the one you need to slice by during an incident.

The old objection — "high-cardinality data is too expensive" — was true in 2012 and is not true now. Columnar stores (ClickHouse, BigQuery, the backend of every modern observability vendor) handle it fine. Design the schema as if every field will be filterable and groupable, because it will need to be.

### 3. Include the four context categories on every event

Anything less and the event cannot stand alone.

- **Identity**: `request_id` / `trace_id`, `span_id`, `service`, `version`, `deployment_id`.
- **Environment**: `region`, `instance_id`, `commit_sha`, `environment` (prod/staging), `runtime`.
- **Business**: `user_id`, `tenant_id`, `subscription_tier`, `feature_flags`, `cart_total_cents`, whatever the domain cares about. Without this, you know an error occurred; you do not know whether it was a $5 customer or a $50k customer.
- **Performance and outcome**: `duration_ms`, sub-operation timings (`db_ms`, `cache_ms`), `status_code`, `outcome` (`success`/`error`/`timeout`), `error.class`, `error.message`. Include these on every event, not just errors — that's how you build p99 dashboards for free.

### 4. Wide events and OpenTelemetry spans are the same idea

A span *is* a wide event with a start time, end time, and parent/child relationships. If OTel is in play, the canonical middleware should correlate the event with the current span: inject `trace_id` and `span_id` into the event, use OTel Semantic Conventions for field names (`http.method`, `http.route`, `http.status_code`, `db.system`), and let the collector handle shipping. This means your logs and your traces share a primary key, which is the single biggest debugging-speed win available.

If OTel is not in play, a locally-generated `request_id` propagated via `x-request-id` is the fallback. Either way, every event must carry a correlation ID.

### 5. Infrastructure in middleware, business context in handlers

Middleware owns the boring parts: starting the event, binding `request_id` into context, timing, catching exceptions, emitting in `finally`. Handlers and business logic *only* add domain fields (`user_id`, `feature_flag_X`, `cart_total`). This separation is why the canonical pattern scales — individual handlers stay clean, and any new request automatically gets the full infrastructure envelope for free.

### 6. Stable field names, JSON to stdout, two levels

Pick field names once and never rename them: `user_id` everywhere, not `userId` in one service and `uid` in another. OTel Semantic Conventions is a good baseline schema.

Output is JSON on a single line, written to stdout. The 12-factor reason is real: the app should not know or care where logs end up; a runtime, sidecar, or platform ships them.

Two log levels (`info` for canonical events, `error` for things that need paging) are almost always enough. Debug/trace/warn/notice/critical proliferate without adding query power. If you find yourself wanting a debug log, add the data as a field on the wide event instead — it's queryable and survives beyond the current terminal session.

### 7. Emit once; do not log-and-raise

An exception should produce exactly one log event: the canonical event for that request, with `error.class` and `error.message` populated. `log.error(e); raise` produces two events for one failure and doubles the stack in your aggregator. Let the boundary (middleware) record the error once.

## Anti-patterns worth rejecting on sight

| Anti-pattern | Why it breaks | Fix |
|---|---|---|
| Interpolating fields into the log message string | Buries data in an opaque string. Cannot filter or aggregate by those fields. | Pass fields as structured kwargs/properties on a structured event. |
| Scattered per-step logs with no canonical event | 6 lines of noise per request; cannot answer "which user, what outcome" in one row. | Build one event object, emit in `finally`. |
| `print(...)` / `console.log("DEBUG: ...")` left in prod | No level, no structure, no context, no destination control. | A configured logger, or remove. |
| Low-cardinality-only logging (`level`, `status`, `route`) | You cannot debug a specific user. | Always include `user_id`/`tenant_id`/`trace_id`. |
| Logging the raw path `/users/123/orders/456` | Every URL is unique; cannot group. | Log the route template (`/users/:id/orders/:id`) *and* the raw path as separate fields. |
| New logger instance per file | Inconsistent formatting, missing global context. | One logger configured at startup, imported everywhere. |
| Random-sample all requests at 1% | Drops 99% of your errors. | Tail sampling — keep errors, slow requests, VIPs, flag-enabled requests. See `references/sampling.md`. |
| Logging full request/response bodies | Secrets, PII, cost. | Redaction processor + allowlist + size cap. |
| Treating structured JSON as sufficient | Five JSON fields is not a wide event. | Aim for 20+ fields with all four context categories. |

