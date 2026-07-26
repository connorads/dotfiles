# Reads And Writes

Read this when query shapes fight the domain model, someone proposes CQRS or a
read replica, or reporting needs are distorting the write side.

Separate reads from writes. At the call level, a function either changes state or
answers a question, never both (command-query separation). At system scale the
same split is CQRS: the write model is shaped by invariants, not by how screens
query it — a domain model is not a data model — so reads need not travel through
the aggregate. Default to the same store and repository for both. Reach for a
separate read model — a denormalised view keyed for the query, kept fresh from
the domain events the write side already emits — only when the read shape
genuinely diverges or a performance wall demands it. This is an in-process read
model fed by your own events; a consumer in another service keeping its own
replica from your published events is event-carried state transfer — a different
thing with its own contract, see `event-driven-architecture`. Treat CQRS as a
last resort, not a default: splitting read-only views out from command handlers
captures most of the benefit without a second store.
