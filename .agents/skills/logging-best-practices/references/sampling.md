# Sampling — logging-sucks reference

Cross-platform sampling strategy. Read `SKILL.md` first. This file covers *why* naive random sampling is wrong and what to do instead.

## The problem with head-based random sampling

Head sampling decides at request entry: flip a coin, if it's heads keep all logs for this request, otherwise drop them. At 1% head-sampling, you keep 1% of errors. You keep 1% of slow requests. You keep 1% of the requests that broke for your biggest customer. At scale, 1% is often enough for dashboards — but it is catastrophic for debugging, which is exactly when you need the logs.

Head sampling has one genuine virtue: it is cheap and it preserves trace coherence (every log in a kept request is kept together). Use it as a *prefilter* for bulk volume reduction, not as the whole strategy.

## Tail sampling — decide based on outcome

Tail sampling makes the keep/drop decision *after* the request completes, when the outcome is known. The rules that matter in practice:

1. **Always keep errors.** 100% of `status >= 500`, 100% of unhandled exceptions, 100% of explicit `outcome = "error"`.
2. **Always keep slow requests.** Requests above the p99 latency threshold — these are the ones that build the tail of your latency distribution and expose cascading slowness.
3. **Always keep VIPs.** Enterprise customers, internal staff, flagged debug users. One angry enterprise customer with missing logs costs more than a month of storage.
4. **Always keep feature-flag-enabled requests.** When a flag is at 1% rollout, you need 100% visibility into that 1% to evaluate it, not 1%-of-1%.
5. **Randomly sample the rest at 1–5%.** This fills in the normal-case baseline for dashboards.

This keeps cardinality where it matters (the failures, the outliers, the important users) and trims it where it does not (the boring successful p50).

## A keep-rule sketch (language-agnostic)

```
function shouldKeep(event):
    if event.status_code >= 500:                     return true
    if event.outcome == "error":                     return true
    if event.duration_ms > P99_THRESHOLD_MS:         return true
    if event.user.tier in ("enterprise", "internal"):return true
    if event.feature_flags has any experimental:     return true
    return random() < 0.05
```

Apply this in the `finally` of the canonical middleware — that is the moment when you have the full event and can make an outcome-aware decision.

## Where to implement it

Three sensible homes, from closest-to-the-code to furthest:

1. **In-app, in the canonical middleware.** The event is already assembled; gating the `logger.info(event)` call on a keep-rule function is cheap and works everywhere. Downside: you pay the CPU to assemble events you then drop. Usually fine.

2. **In a sidecar / Tail Worker / OTel Collector.** The application emits everything; a downstream process filters before shipping to the expensive tier. This is where outcome-based tail sampling actually belongs when you have distributed tracing — the [OTel Collector's `tail_sampling` processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor) can key on `trace_id` and hold spans until all spans of a trace arrive, then make a whole-trace decision. On Cloudflare, a Tail Worker does the same job.

3. **At the backend (Honeycomb Refinery, vendor-side rules).** Useful when operational control of the collector is awkward. Same shape of rules, just run further from the app.

Combine freely: app-side drops the `/health` noise, the collector does outcome-based keep-rules, the backend does long-tail downsampling. The rules compose.

## Python

Head-based / content-based drops belong in a structlog processor that raises `structlog.DropEvent`:

```python
import random, structlog

def drop_health_checks(_, __, event_dict):
    if event_dict.get("http.path") == "/health" and random.random() > 0.01:
        raise structlog.DropEvent
    return event_dict
```

Place *before* the formatter-wrapper processor. Raising `DropEvent` inside `ProcessorFormatter` (the stdlib-bridge path) crashes the formatter; drop in structlog's own chain.

For tail sampling in Python, the real home is the OpenTelemetry Collector with `tail_sampling` keyed on `trace_id`. Let the app emit everything; push the decision downstream.

## Cloudflare Workers

Three practical layers:

- **`observability.head_sampling_rate`** in `wrangler.jsonc` — platform-level head sampling. Whole invocations kept/dropped together, trace coherence preserved.
- **In the canonical middleware** — only `console.log` the wide event when a keep-rule matches; always `writeDataPoint` to Analytics Engine (AE's own sampling handles volume there with fairness).
- **In a Tail Worker** — producer emits everything; the Tail Worker filters before shipping to an external backend. This is the right home for expensive outcome-aware rules that shouldn't run on every hot-path invocation.

## What you lose when sampling — and how to mitigate

The fundamental risk is losing the one event that would have told you what broke. Two mitigations that matter:

- **Sample by trace, not by span.** If you keep 5% of traces, you keep every span of those traces; you do not get fragmented half-traces that look like bugs. This is why the OTel Collector tail processor keys on `trace_id`.
- **Always keep errors, always keep outliers, always keep VIPs.** This is the single biggest difference between "sampling works" and "sampling silently breaks debugging".

## Rule of thumb

Start without tail sampling — emit everything. Add tail sampling only when log volume or cost forces it. When you add it, add keep-rules first (errors, slow, VIPs, flags), then random sampling of the remainder. Never flip the order: a 5% random sampler without keep-rules is worse than no sampler at all, because it produces a false sense of observability.
