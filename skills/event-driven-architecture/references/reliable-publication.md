# Publishing Without Losing The Event

## The Dual-Write Problem

You commit to the database, then publish to the broker. Two systems, two steps,
no shared transaction. If the process dies between them - or the broker is
briefly down - the database says the order was placed and no one was ever told.
Publish first and the mirror bug appears: the broker has an event for a write
that rolled back.

This is the dual-write problem, and it is the reason the patterns below exist.
Any "write then publish" (or "publish then write") sequence has it.

Two-phase commit (2PC/XA) across the DB and broker technically closes the gap.
Some brokers support producer participation in 2PC - Kafka's KIP-939 adds it (a
`transaction.two.phase.commit.enable` property plus
`prepareTransaction()`/`completeTransaction()`), aimed squarely at this
dual-write problem. The durable objection is structural: even where supported,
2PC couples DB and broker availability and adds synchronous overhead, so the
outbox usually still wins. Treat it as a last resort.

## Transactional Outbox

Write the event to an **outbox table in the same database transaction** as the
state change. One commit, both or neither. A separate relay then reads the
outbox and publishes to the broker, marking rows done.

The commit is now atomic. Publication is decoupled and retried until it sticks -
which means the consumer sees **at-least-once** delivery, so it must be
idempotent (see `delivery-semantics.md`).

Two ways to run the relay:

- **Polling publisher** - a worker polls the outbox on an interval. Simple, no
  extra infrastructure, works anywhere. Adds latency and DB load; needs a claim
  strategy so two workers don't publish the same row.
- **Change data capture (CDC)** - tail the database transaction log (e.g.
  Debezium) and stream new outbox rows out. Lower latency, no polling load, but
  more infrastructure and operational weight.

"Poll first, reach for CDC when polling hurts" is a simplicity call, not field
consensus - the pattern's own authority (Morling / Debezium) defaults the
*opposite* way, objecting that polling "hammers your database even when empty" and
needs locking so instances don't double-process, while capture happens "with a
very low overhead in near-realtime"; the 2024 *Revisiting the Outbox Pattern* drops
the outbox table entirely for Postgres logical decoding. Weigh it as a real
trade-off: polling buys zero infrastructure on any datastore (latency bounded by
the interval); CDC buys lower load and latency and no relay concurrency, at the
cost of replication-slot / WAL weight.

## Kafka Transactions vs Outbox

In a Kafka shop the live alternative to an outbox is **Kafka transactions (EOS)**
plus idempotent DB writes - the consume-transform-produce loop committing consumer
offset and produced records atomically. No outbox table, no relay. The honest
limit: EOS spans a **single Kafka cluster** only. The moment an external side
effect is in scope - a DB row, an API call - it does *not* close the dual-write
gap, so you are back to idempotent writes or an outbox. Both outbox and EOS leave
the consumer at at-least-once; EOS holds only inside its boundary (see
`delivery-semantics.md`).

## Durable Execution And The Outbox

A durable-execution engine can subsume the outbox, but only where its journal is
**co-transactional with your data**. DBOS writes the step checkpoint and the
business update in the same database transaction - "both ... are durably recorded" -
so the outbox row *becomes* the workflow-status insert and there is no relay.
Temporal, Restate, Step Functions, Cloudflare Workflows and Vercel keep a
*separate* journal, so they **relocate** the dual-write (your DB <-> the engine's
journal) rather than remove it, and close it exactly as the outbox's consumer side
does: the activity is retried at-least-once and must be idempotent. So the
marketing - Restate: "you no longer need a separate ... transactional outbox" -
holds only inside the engine's boundary, the same caveat this skill makes about
Kafka EOS. The reusable framing: the outbox turns an atomicity problem into an
idempotency problem, and durable execution takes the atomicity half only.

## Inbox / Idempotent Receiver

The outbox's counterpart on the consumer side. Record each processed message id
in an **inbox table**, in the same transaction as the work it triggers. On
redelivery, the id is already there - skip it. This is how a consumer turns
at-least-once delivery into effectively-once processing without relying on the
broker's guarantees.

You don't always need a dedicated inbox: a natural unique constraint or a
state-machine guard that makes the operation idempotent does the same job. Use
the inbox when there's no natural key to dedupe on.

## Publish After Commit

Whatever raises the integration event, publish it *after* the state is durably
committed, not before. Publishing inside the transaction risks announcing a fact
that then rolls back. The outbox enforces this for you - the row isn't visible to
the relay until the transaction commits.

## Listen To Yourself

A variant worth knowing: the service publishes its event to the broker first,
then updates its *own* state when it consumes its own event back. The broker
becomes the single source of ordering and durability, removing the dual write
entirely. Different consistency model - the service's own state is now eventually
consistent with its published events - so it fits some domains and not others.
Not a default; a tool for when broker-as-source-of-truth suits the design.

## Don't Reach For The Outbox By Reflex

The outbox is the right default for reliable cross-service publication, but it is
not free: a table, a relay, dedup on every consumer, more moving parts to
operate. If the event doesn't cross a boundary, or a lost notification is
genuinely harmless, or the consumer can reconcile from a periodic read, you may
not need it. Match the machinery to the cost of a lost message, not to a habit of
always chasing the strongest guarantee.
