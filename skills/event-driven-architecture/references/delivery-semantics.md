# Delivery, Redelivery, And Failure

## The Three Semantics, And The Myth

- **At-most-once** - fire and forget. A message can be lost, never duplicated.
  Fine for a metric tick; wrong for anything that matters.
- **At-least-once** - retried until acknowledged. Never lost, sometimes
  duplicated. The default of every real broker, and what you design for.
- **Exactly-once delivery** - not achievable end-to-end. Two parties over an
  unreliable channel can never both be certain a message arrived (the Two
  Generals problem). But note what that does *not* prove: Two Generals is about
  certainty of acknowledgement, not the impossibility of exactly-once
  *processing*. Jay Kreps (Kafka's co-creator) calls citing it as such a category
  error, and Confluent's official position is titled "Exactly-once Semantics is
  Possible."

What you actually engineer is **effectively-once processing** - at-least-once
delivery plus a consumer that ignores duplicates - and that is a synonym for
Kafka's "exactly-once *processing*" (EOS terminology), a real and defended term,
not a softer euphemism for a broken promise. Tyler Treat's canonical rebuttal
agrees on the substance: Kafka did not solve Two Generals; it achieves
exactly-once processing in a closed system. What EOS does *not* do is reach past
that boundary: Kafka's EOS and SQS FIFO dedup hold only *inside their own
boundary* - Kafka-to-Kafka, within the dedup window. The moment your consumer
writes to an external database, calls an API, or sends an email, that external
effect needs its own idempotency. The broker cannot make your side effects
exactly-once for you.

## Idempotent Consumers

The whole game on the consumer side. A duplicate delivery must produce the same
result as the first, with no extra side effect. Ways to get there, cheapest
first:

- **Natural idempotency** - the operation is already safe to repeat (set status
  to `shipped`, upsert by key). No dedup needed. Reach for this first.
- **Unique constraint** - a natural business key the database rejects on the
  second insert.
- **State-machine guard** - the entity refuses a transition it's already made.
- **Dedup by message id** - record processed ids (the inbox, see
  `reliable-publication.md`) when there's no natural key.

Dedup by a business/message key, not by delivery metadata - the same logical
event redelivered must carry the same key.

## Poison Messages And Dead Letters

Some messages will never succeed: malformed payload, a referenced record that no
longer exists, a bug. Retried blindly, one such **poison message** blocks the
queue or spins forever.

- **Retry cap** - give up after N attempts rather than retrying unboundedly.
- **Dead-letter queue (DLQ)** - move the exhausted message to a side channel for
  inspection and manual or automated replay. The queue keeps flowing; nothing is
  silently dropped.
- **Classify the failure** - a *transient* failure (timeout, 503, lock
  contention) deserves a retry; a *permanent* one (validation error, 400) should
  go straight to the DLQ. Retrying a permanent failure just wastes attempts
  before the inevitable dead-letter.

## Backoff

Retry with **exponential backoff plus jitter**, not a tight loop. Backoff stops
you hammering a struggling downstream; jitter stops a fleet of consumers
retrying in lockstep and synchronising into a thundering herd. A fixed-interval
retry does both wrong.

## Ordering

Global ordering across a distributed queue is expensive and usually
unnecessary. What you almost always want is **per-key ordering** - all events
for one order, one account, one aggregate, in order - with different keys free to
process in parallel.

- A **partitioned log** (Kafka) gives per-partition order; route by a key
  (order id) so one entity's events land on one partition. Parallelism is then
  capped at the partition count, and one slow message causes **head-of-line
  blocking** for its partition.
- A **competing-consumer queue** (RabbitMQ/SQS standard) maximises throughput by
  handing messages to whichever consumer is free - which *reorders* them. SQS
  FIFO restores per-group order at the cost of throughput.

You cannot have unbounded per-key ordering *and* unbounded fan-out parallelism
at once. Pick the ordering scope you actually need - usually per-key - and size
partitions/consumers around it.

## Backpressure

A fast producer and a slow consumer need a release valve, or the queue grows
without bound until something falls over. Bound the queue and apply backpressure
(block or shed) rather than buffering infinitely. Load levelling - the queue
absorbing a spike so the consumer drains it steadily - is a feature; an unbounded
backlog hiding a permanently-too-slow consumer is a failure in disguise.
