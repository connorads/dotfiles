# Observability

Read this when designing a new system boundary, or when production behaviour is
hard to debug from the current logs.

Design system boundaries with observability in mind:

- structured logs over free-text logs
- operation names
- relevant entity IDs
- request/correlation IDs
- timing and outcome at HTTP, database, queue, and external-service boundaries

The core should decide what happened. The shell should record it with the
context needed to debug production behaviour.

Across a message boundary the same discipline needs trace context propagated in
message headers rather than carried on a call stack; the
`event-driven-architecture` skill's "Reaching Out" covers async tracing (W3C Trace
Context, OTel messaging conventions).

Log structure, wide events, and per-language mechanics are the
`logging-best-practices` skill's territory; this file owns only the
design-the-boundary rule.
