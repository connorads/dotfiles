# Worked example: the ticket that sounds calibrated but bullshits

A fictionalised composite of a real agent-drafted ticket. Every sentence is
individually sourced and measured in tone; the defects are in the chain
between the sentences. Read the draft, then the audit, then the rewrite.

## The draft

> **Title:** Integration status endpoints hang up to ~55s: no timeout on
> OAuth refresh
>
> **Problem.** `GET /api/integrations/alpha/status` effectively hangs on
> most calls: p50 53.2s / p95 71.8s (n=110-370 depending on window), while
> the handler child span is p75 152ms. Siblings show the same tail shape:
> `beta/status` p95 46.8s, `gamma/status` p95 55.9s (`delta/status` is
> clean at p95 108ms).
>
> **Evidence.** Call path: `status.ts:11` → `refreshAccessToken` → no
> timeout anywhere on the chain. Verified per-trace: one http.server span
> ran 72.0s with the route handler occupying only the final 168ms - the
> stall is pre-handler/platform-side and intermittent (warm instances stall
> too), so a timeout is the containment, not the root cause. Mechanism not
> fully proven; whatever it is, an unbounded upstream call turns it into a
> ~60s user-visible hang.
>
> **Fix.** Explicit timeouts (~5s) on the OAuth refresh and status-check
> calls. Return a degraded status rather than hanging the screen.

## The audit

**1. The evidence contradicts the fix; a bridging hedge joins them.** The
draft's strongest observation - handler occupied the final 168ms of a 72s
span - places the stall *before* the handler. But `refreshAccessToken` runs
*inside* the handler path, so a timeout on it cannot contain a pre-handler
stall, and "return a degraded status" never executes on a request that
hasn't reached the handler. The title's cause is disconfirmed by the body's
own evidence. The sentence doing the smoothing is "Mechanism not fully
proven; whatever it is, an unbounded upstream call turns it into a hang" -
a hedge shaped like honesty, bridging two claims the evidence puts in
tension. Apply the test: resolve the uncertainty either way and the
argument dies (pre-handler stall → the fix is irrelevant; in-handler stall
→ the trace claim was wrong). That is a bridging hedge, not a marking one.

**2. The unused contrast.** `delta/status` clean at p95 108ms sits in the
draft's own Problem section. If the stall were platform-side, the clean
sibling on the same page fan-out disconfirms it - so the mechanism is
route-specific but outside the instrumented handler span (module init,
middleware, an uninstrumented wrapper: unknown). The discriminating
evidence was in hand and the discrimination never ran.

**3. Basis inflation.** "Verified per-trace" is one trace. "Warm instances
stall too" has no stated basis. "~5s" has no derivation. None fatal alone;
together they are the texture of confidence exceeding evidence.

## The rewrite

> **Title:** Integration status endpoints hang ~55s on most calls
>
> **Status:** measured from APM spans (7-14d windows); one full trace read;
> call path traced in code, not executed; no fix validated.
>
> **Observed.**
>
> - `alpha/status` p50 53.2s / p95 71.8s (n=110-370 by window); handler
>   child span p75 152ms. `beta` and `gamma` share the tail shape;
>   `delta/status` is clean at p95 108ms.
> - In the one trace read end-to-end, the 72.0s http.server span had the
>   handler in its final 168ms.
> - No timeout exists anywhere on the refresh call chain (`status.ts:11` →
>   `refreshAccessToken`), read from code.
>
> **Two mechanisms are live, and they disagree about the fix.**
>
> 1. The stall is outside the instrumented handler span (platform queueing,
>    module init, middleware, an uninstrumented wrapper). Supported by the
>    trace; but the clean `delta` sibling on the same fan-out cuts against
>    anything platform-wide - whatever stalls is route-specific.
> 2. The stall is the un-timed-out refresh call, and the "handler child
>    span" simply does not wrap it. Supported by the code path; contradicted
>    by the trace only if the span instrumentation covers the refresh -
>    unverified either way.
>
> **Spike first.**
>
> - [ ] Establish what the handler child span wraps. If it excludes the
>       refresh call, mechanism 2 is back in play.
> - [ ] Instrument or log around `refreshAccessToken`; one day of data
>       splits the mechanisms.
> - [ ] Explain the clean sibling: what does `delta/status` not do that the
>       stalling three do?
>
> **Fix, conditional.** Under mechanism 2, a timeout on the refresh call
> bounds the hang (threshold from p99 of healthy refresh calls, currently
> unmeasured). Under mechanism 1, handler-level timeouts change nothing and
> the fix moves to wherever the spike locates the stall. Timeouts on the
> chain are cheap hygiene either way, but they are not the fix until
> mechanism 2 is confirmed.

The rewrite contains strictly less certainty and strictly more information:
the reader knows what was done, what discriminates the hypotheses, and what
the fix depends on. Nothing in it needs softening later, because nothing in
it overclaims now.
