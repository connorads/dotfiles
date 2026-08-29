# Observability

Read this when designing a new system boundary, or when production behaviour is
hard to debug from the current logs.

Before a boundary ships, answer: how will I know if this breaks? If answering
needs a field the event does not carry, add the field now.

Decide the unit of work first - HTTP request, queue message, cron tick, CLI
invocation. The shell composes one wide structured event per unit of work and
emits it once at exit or error; boundary instrumentation *enriches* that event
rather than emitting its own line, so one row answers a question instead of a
join across five. On it: operation name, entity IDs, request/correlation ID,
build version, and timing plus outcome for each HTTP, database, queue and
external-service call. Prefer adding a field to aggregating in the
application - sampling drops whole events and is reversible; pre-aggregating
into a counter destroys the question you did not think to ask.

The core should decide what happened. The shell should record it with the
context needed to debug production behaviour. For that to work the core must
return *why*, not only *what*: the decision value names the rule that fired and
the inputs that drove it - the limit hit, the values compared - so the event
explains the outcome without a debugger. Keep that vocabulary small and stable;
it is what you group by. A core returning a bare `Rejected` has put the
explanation somewhere the shell cannot reach.

Across a message boundary the same discipline needs trace context propagated in
message headers rather than carried on a call stack; the
`event-driven-architecture` skill's "Reaching Out" covers async tracing (W3C Trace
Context, OTel messaging conventions).

Log structure, wide events, and per-language mechanics are the
`logging-best-practices` skill's territory; this file owns only the
design-the-boundary rule.
