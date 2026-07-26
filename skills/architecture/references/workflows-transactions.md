# Workflows, Transactions, Idempotency

Read this when an operation spans aggregates or services, needs retries,
compensation, or coordination, or when concurrent writers could clobber each
other.

An aggregate is both the consistency boundary and the unit of persistence: route
all changes through its root, and update only one aggregate per transaction.
Link aggregates by id, never by embedding one in another. When an operation
seems to need two aggregates atomically, suspect a missing entity (model the
operation itself) or use eventual consistency. Across services, prefer async
events to distributed transactions, with an explicit recovery path — reconcile
or compensate. Eventual consistency is not optional consistency; it must still
converge.

Use a plain call or a single database transaction for simple single-boundary
operations. Reach for a saga or durable workflow when the process needs retries,
compensation, idempotency, resumability, timers, human approval, or coordination
across services and multiple transaction boundaries. Both buy ACD, not ACID - you
get atomicity, consistency, and durability (plus resumability and compensation),
but not isolation, so intermediate states stay visible; design the
countermeasures the `event-driven-architecture` skill's `topology.md` lists
(semantic locks, a `pending` status, re-reads).

Do not hold a database transaction open across network calls or long-running
work. Any command, job, or step that may be retried needs an explicit
idempotency strategy — idempotency key, natural unique constraint, deduplication
record, state-machine guard, or transactional outbox/inbox (see
`event-driven-architecture` for the outbox/inbox mechanism and idempotent
consumers). Do not rely on "probably safe" repeated side effects.

Concurrency control is distinct from idempotency: idempotency makes a retry safe;
concurrency control stops two simultaneous writers clobbering each other — the
lost update. Hold the consistency boundary under concurrent writes by versioning
the aggregate (optimistic locking): bump a version on write, let one transaction
commit, and make the loser reload and retry. Reach for pessimistic locks
(`SELECT ... FOR UPDATE`) when conflicts are frequent and a retry is expensive,
minding deadlocks; raising the isolation level to `SERIALIZABLE` lets the database
enforce the rule but is slower, so prefer a targeted version check. Pick by
conflict rate and the cost of a lost update.

Make the transaction boundary safe by default: the only path that commits is
total success plus an explicit commit, and any exception or early exit rolls
back. Design the default to change nothing and require a positive act to persist.
