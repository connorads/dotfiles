# Reads And Writes

Read this when query shapes fight the domain model, someone proposes CQRS or a
read replica, or reporting needs are distorting the write side.

Separate reads from writes. At the call level, a function either changes state or
answers a question, never both (command-query separation). Within one bounded
context whose read and write needs diverge - never as a system-wide architecture
(Young) - the same split is CQRS: the write model is shaped by invariants, not by
how screens query it - a domain model is not a data model - so reads need not
travel through the aggregate. CQRS in that original sense is cheap: two models
where there was one, query handlers reading the same store directly and sharing
its transactions; most contexts stop there. The last resort is the *second
store*, not the split: a separately-fed denormalised view - keyed for the query,
kept fresh from the domain events the write side already emits - means owning
staleness and rebuilds, so reach for it only when the read shape genuinely
diverges or a performance wall demands it. A read model must be rebuildable
from the write side on demand - if it cannot be, it is a second source of
truth, not a projection; fix a bad one by rebuilding a corrected copy in
parallel and cutting readers over. This is an in-process read model fed
by your own events; a consumer in another service keeping its own replica from
your published events is event-carried state transfer - a different thing with
its own contract, see `event-driven-architecture`.
