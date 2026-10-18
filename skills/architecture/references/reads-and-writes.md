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

A projection and a policy both consume events, but only one may replay. A
projection writes a store you own and never sends commands, so you can rebuild
it from the history at any time. A policy acts on the world - sends commands,
calls other systems - and must never re-run on a rebuild. A handler that needs
both is two handlers. Key projection rows by source stream and sequence and
ignore conflicts, so a redelivered event writes nothing.

Serve reads from a read model, not from aggregate state. Exposed state becomes
a contract and freezes the write model against rule changes. Have events carry
what readers need (`balanceAfter`, `by`, `reason`), so a read model copies a
value instead of keeping a running total that drifts.

A read model is a security boundary. Authorise every read against the reader,
and re-check on every update of a live subscription, so an ownership change
ends the old owner's feed. A read model decides who may read, not which
fields: give each audience its own read model rather than filtering one by
caller. Client filters may narrow access, never widen it. Answer another
customer's resource with not-found rather than forbidden, so ids do not
reveal what exists.

To read your own write, return the write's position (stream and version) as a
receipt, and let a read that must reflect the write wait until its read model
has applied that position. The receipt is valid only for read models fed
directly by that stream; a model fed through another model needs that model's
own position.
