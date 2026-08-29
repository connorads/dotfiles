# Workflows, Transactions, Idempotency

Read this when an operation spans aggregates or services, needs retries,
compensation, or coordination, or when concurrent writers could clobber each
other.

An aggregate is both the consistency boundary and the unit of persistence: route
all changes through its root, and update only one aggregate per transaction.
Link aggregates by id, never by embedding one in another. When an operation
seems to need two aggregates atomically, suspect a missing entity (model the
operation itself) or use eventual consistency. Across services, prefer async
events to distributed transactions, with an explicit recovery path - reconcile
or compensate. Eventual consistency is not optional consistency. Name the
forcing condition before choosing it - most systems can just linearise, and it
is cheaper. Then state the staleness bound you promise and measure it
("eventually" is not a bound), and say which value wins; convergence alone does
not say what it converges to.

Use a plain call or a single database transaction for simple single-boundary
operations. Reach for a saga or durable workflow when the process needs retries,
compensation, idempotency, resumability, timers, human approval, or coordination
across services and multiple transaction boundaries. Both buy ACD, not ACID - you
get atomicity, consistency, and durability (plus resumability and compensation),
but not isolation, so intermediate states stay visible; design the
countermeasures the `event-driven-architecture` skill's `topology.md` lists
(semantic locks, a `pending` status, re-reads). And compensation posts a new
fact rather than undoing one, so anything a reader, customer or downstream
system already acted on stays acted on - decide up front what the irreversible
cases cost: the refund, the correcting entry, the apology.

Do not hold a database transaction open across network calls or long-running
work. Any command, job, or step that may be retried needs an explicit
idempotency strategy - an idempotency key, a natural unique constraint, a
deduplication record, or a state-machine guard. The dedup record must commit in
the same transaction as the effect it guards; written separately it is itself a
dual write, and a crash between the two reproduces the duplicate. A
transactional outbox is a different fix for a different problem - it makes the
state change and the published event commit atomically; the inbox is the
idempotency half. No broker's "exactly-once" reaches your side effects: it
covers that broker's own writes, so every external call carries its own key
(see `event-driven-architecture` for outbox/inbox mechanics and idempotent
consumers). Do not rely on "probably safe" repeated side effects.

Concurrency control is distinct from idempotency: idempotency makes a retry safe;
concurrency control stops two simultaneous writers clobbering each other - the
lost update. Hold the consistency boundary under concurrent writes by versioning
the aggregate (optimistic locking): bump a version on write, let one transaction
commit, and make the loser reload and retry. A version check defends one
aggregate, not an invariant spanning two: both writers touch different
aggregates, both checks pass, the rule breaks (write skew). Nothing conflicts,
so no lock sees it - either materialise the invariant so one row or aggregate
owns it (a unique constraint, a booked-slot row, a counter), or run the
conflicting reads and writes in one serialisable transaction. Reach for
pessimistic locks (`SELECT ... FOR UPDATE`) when conflicts are frequent and a
retry is expensive, minding deadlocks; serialisable snapshot isolation is
optimistic and cheap at low contention, detecting write skew without the cost
the word suggests. Pick by conflict rate and the cost of a lost update.

Across processes, split the requirement first: an efficiency lock (a double run
wastes work) can be approximate; a correctness lock (a double write corrupts
data) cannot - a GC pause or slow network expires the lease while the holder
still believes it holds it, and more lock replicas do not help. Make the
resource reject stale holders: issue a monotonically increasing fencing token
with the lock and check it on every write (Kleppmann).

Make the transaction boundary safe by default: the only path that commits is
total success plus an explicit commit, and any exception or early exit rolls
back. Design the default to change nothing and require a positive act to persist.
