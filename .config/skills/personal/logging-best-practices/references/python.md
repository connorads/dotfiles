# Python — logging-best-practices reference

Concrete guidance for implementing the wide-event / canonical-log-line pattern in Python services. Read `SKILL.md` first for the principles; this file covers *how*.

## Library choice

**Default to `structlog`.** It is the only mainstream Python logger built around structured events with first-class `contextvars` support. stdlib `logging` can be bridged through it for library logs.

- stdlib `logging` alone — OK for one-file scripts. Not enough for a service: producing JSON with contextvars requires significant custom scaffolding.
- `loguru` — pleasant for CLI tools, but its model is string-templates-with-extras rather than true structured events, and its contextvars story is weaker. Avoid for distributed services.
- `python-json-logger` — useful as a stdlib *formatter* if you cannot fully bridge through structlog (e.g. a library you cannot control).

## Baseline structlog config

This is the config worth copying into a new service. It gives pretty console output in dev (auto-detected via `isatty`) and JSON-to-stdout in prod, bridges stdlib `logging` through the same pipeline (so `uvicorn`, `sqlalchemy`, etc. render consistently), and exposes `contextvars` for request-scoped binding.

```python
# logging_setup.py
import logging.config, os, sys
import structlog
from structlog.types import EventDict, Processor

def _drop_color_message_key(_, __, event_dict: EventDict) -> EventDict:
    # Uvicorn duplicates the message under color_message; drop the duplicate.
    event_dict.pop("color_message", None)
    return event_dict

def setup_logging(env: str = os.getenv("ENV", "dev"), level: str = "INFO") -> None:
    shared: list[Processor] = [
        structlog.contextvars.merge_contextvars,          # must come first
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
        _drop_color_message_key,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]

    if env == "dev" and sys.stderr.isatty():
        renderer: Processor = structlog.dev.ConsoleRenderer()
    else:
        shared += [structlog.processors.dict_tracebacks,
                   structlog.processors.EventRenamer("message")]
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=shared + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level)),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    logging.config.dictConfig({
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"structlog": {
            "()": structlog.stdlib.ProcessorFormatter,
            "processor": renderer,
            "foreign_pre_chain": shared,
        }},
        "handlers": {"default": {
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
            "formatter": "structlog",
        }},
        "root": {"handlers": ["default"], "level": level},
        "loggers": {
            "uvicorn.access": {"handlers": ["default"], "level": "INFO", "propagate": False},
            "sqlalchemy.engine": {"level": "WARNING"},
        },
    })
```

For very hot paths (>10k events/s), swap `LoggerFactory` for `BytesLoggerFactory` and the JSON renderer for `JSONRenderer(serializer=orjson.dumps)`. This is the fastest known structlog configuration.

## Context binding — bind once, read everywhere

`structlog.contextvars` is how request/job-scoped context reaches every log call without threading it through every function signature. It works correctly for both threads and asyncio tasks.

```python
from structlog.contextvars import bind_contextvars, clear_contextvars

clear_contextvars()                                  # fresh slate per request
bind_contextvars(request_id=rid, user_id=uid, tenant_id=tid)

log = structlog.get_logger()
log.info("order.placed", order_id=oid, total_cents=total)
# -> {"event": "order.placed", "request_id": "...", "user_id": "...", "tenant_id": "...", "order_id": "...", ...}
```

Two rules that save hours of confusion:

1. `merge_contextvars` **must be the first processor** in the chain. Otherwise the bound vars are invisible to renderers.
2. `clear_contextvars()` at the *start* of each request/job. `contextvars` do not automatically reset between requests in async frameworks; stale context leaking between requests is a classic bug.

## Canonical log line — ASGI middleware

The middleware is the leverage point: it creates a per-request event dict, binds `request_id` into contextvars, lets handlers annotate via `annotate(...)`, and emits one event in `finally`. Works for FastAPI, Starlette, and anything speaking ASGI.

A vetted implementation ships with this skill at [`scripts/canonical_asgi.py`](../scripts/canonical_asgi.py) — copy it into the target project rather than re-deriving it from scratch. The file handles the subtle cases (case-insensitive header lookup, latin-1 decoding, route template extraction, correct `ContextVar` reset, inheriting `x-request-id` if present). Import it and add to the app:

```python
from canonical_asgi import CanonicalLogMiddleware, annotate

app = FastAPI()
app.add_middleware(CanonicalLogMiddleware)
```

Handlers then annotate without knowing anything about the middleware:

```python
from canonical import annotate

@app.post("/checkout")
async def checkout(req, user=Depends(current_user)):
    annotate(user_id=user.id, subscription=user.tier, feature_flag_new_checkout=True)
    cart = await load_cart(user.id)
    annotate(cart_total_cents=cart.total, cart_item_count=len(cart.items))
    ...
```

For Celery/RQ/cron jobs, use the same shape as a context manager that initialises the dict on task start and emits in `finally`.

## The `BaseHTTPMiddleware` gotcha

If you use `starlette.middleware.base.BaseHTTPMiddleware` instead of the raw ASGI class above, `contextvars` bound inside dependencies/handlers will **not be visible** in the middleware's `finally`. `BaseHTTPMiddleware` copies the context, so mutations happen on the copy and are discarded. This is FastAPI issue [#4696](https://github.com/fastapi/fastapi/issues/4696) and hits people repeatedly.

Fix: use a pure ASGI middleware class (shown above). If you cannot, stash mutations on `request.state` and re-bind from there.

## OpenTelemetry correlation

If OTel is running, inject the current span's IDs into every event. One processor does it:

```python
from opentelemetry import trace

def add_otel_context(_, __, event_dict):
    span = trace.get_current_span()
    ctx = span.get_span_context() if span else None
    if ctx and ctx.is_valid:
        event_dict["trace_id"] = format(ctx.trace_id, "032x")
        event_dict["span_id"]  = format(ctx.span_id, "016x")
        event_dict["trace_sampled"] = ctx.trace_flags.sampled
    return event_dict
```

Insert it just before the renderer. Also add `service.name`, `service.version`, `deployment.environment` as static fields. Use [OTel Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/) for field names (`http.method`, `http.route`, `http.status_code`, `db.system`, `messaging.destination.name`) so your events line up with whatever backend consumes them.

For auto-shipping logs via OTLP, `opentelemetry-instrument --logs_exporter otlp ...` and `OTEL_PYTHON_LOG_CORRELATION=true` handle the stdlib bridge. The processor above still matters for JSON-to-stdout flows.

## Exceptions

- Inside `except`: `log.exception("operation.failed", order_id=oid)` — attaches `exc_info` automatically.
- Production chain should include `structlog.processors.dict_tracebacks` so stack frames serialise as a structured array (queryable by exception type, frame, line) rather than an opaque string.
- Do not `log.error(exc); raise`. Either `log.exception` and swallow, or just raise and let the boundary (canonical middleware) record `error.class` and `error.message` once. Two events for one failure double-counts in every downstream system.

## Python-specific anti-patterns

The generic anti-patterns in `SKILL.md` apply; these are the ones that bite *specifically* in Python.

| Anti-pattern | Why it breaks | Fix |
|---|---|---|
| `log.info(f"user {uid} bought {n}")` | f-string interpolation buries fields in the message text. structlog cannot filter, group, or aggregate by them; you have lost cardinality. | `log.info("purchase.completed", user_id=uid, quantity=n)` |
| `log.info("user %s bought %s", uid, n)` | Same problem with stdlib `%`-formatting. The `args` tuple is not structured data. | Same fix — use kwargs. |
| `log.info("done", **huge_dict)` | Splats unbounded keys into the event; you lose schema control and may explode token budgets in your aggregator. | Pick the fields you actually need. Use a serialiser that returns a stable shape. |
| `print("DEBUG:", x)` left in source | No level, no JSON, no context, races with other writers to stdout. | A logger call, or remove it. |
| `log.error(exc); raise` | Two events for one failure. The boundary will log it again — now you have double stacks. | Either `log.exception(...)` and swallow, or just `raise` and let middleware record `error.class`/`error.message` once. |
| `BaseHTTPMiddleware` for canonical logging | Copies the context; contextvars bound in handlers are invisible in the middleware's `finally`. The canonical event is missing all the business fields handlers tried to add. | Use raw ASGI middleware (see `scripts/canonical_asgi.py`). Or stash fields on `request.state` and re-bind. |
| Raising `structlog.DropEvent` inside `ProcessorFormatter` | Crashes the stdlib formatter — `DropEvent` is a structlog protocol, not a stdlib one. | Drop in structlog's own processor chain, before the formatter wrapper. |
| `logging.basicConfig(...)` after OTel init | Wipes the OTel log-correlation handler. trace_id/span_id stop appearing in records. | Configure OTel and structlog *first*, leave `basicConfig` alone. |
| `logger = logging.getLogger(__name__)` per file with bespoke handlers | Each module ends up with its own format/destination; cross-module events look inconsistent. | One config at startup; modules get loggers but inherit handlers from root. |

## Sampling in Python

For head-based rate sampling or content-based drops, write a processor that raises `structlog.DropEvent`:

```python
def drop_health_checks(logger, name, event_dict):
    if event_dict.get("http.path") == "/health":
        import random
        if random.random() > 0.01:   # keep 1%
            raise structlog.DropEvent
    return event_dict
```

**Gotcha:** do not raise `DropEvent` inside `ProcessorFormatter` (i.e. the stdlib-bridge path) — it crashes the formatter. Drop in structlog's own chain, before the formatter wrapper.

For tail sampling, see [`sampling.md`](sampling.md). In short: the right home for tail sampling in Python is the OpenTelemetry Collector's `tail_sampling` processor keyed on `trace_id`, not the application.
