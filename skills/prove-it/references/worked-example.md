# Worked example: duplicated telemetry and proxy success

This sanitised incident shows how individually true observations can support a
false causal conclusion when their semantics and timing are unchecked.

## Initial case

During a 16-second incident window, a dashboard showed 1,000 rows:

- 300 read-only database errors;
- 700 apparent successes;
- HTTP 200 responses from the request handler;
- a vendor document describing a matching pooler failure mode.

A direct connection to the writable primary succeeded just after the last
error. The first report concluded:

> It was the pooler, not the database.

## Claim and strength

The claim names a unique cause. That needs evidence which the pooler hypothesis
predicts and the live database-state rivals do not. A symptom match alone can
make the pooler **possible** or **likely**; it cannot confirm exclusivity.

## Evidence-channel audit

The dashboard's unit was a row, not an event. Later inspection showed retries
and duplicate delivery. The 1,000 rows represented about 50 unique event IDs.
The apparent ratio of 300 failures to 700 successes therefore did not describe
1,000 independent outcomes.

HTTP 200 was also a proxy. The handler caught downstream write errors and still
returned 200. The status established handler completion, not a committed write.

These corrections change the inference without any new system event. The
provenance and semantics of existing observations changed.

## Rivals and timing

At least three explanations remained live:

1. a pooler backend attached to a read-only target;
2. a failover or maintenance interval changing database writability;
3. a database read-only state such as a resource-protection mode.

All three predict transient read-only errors across several request paths. The
vendor document raises the pooler hypothesis but does not discriminate it.

The writable-primary check landed at or after the last observed error. It says
the primary was writable then. Without a durable state history, it cannot tell
which state existed during the earlier 16-second window.

## Labelled chain

- **Observed** - read-only error rows existed in the dashboard.
- **Observed** - about 50 unique event IDs generated roughly 1,000 rows.
- **Observed** - the handler returned HTTP 200 even on caught write errors.
- **Observed** - the primary accepted a write after the incident window.
- **Inferred** - a transient connection or database state affected writes.
- **Assumed** - the pooler, rather than failover or database state, uniquely
  produced that transient condition.

The assumed final link limits the unique-cause conclusion.

## Strongest warranted report

> The incident confirms transient read-only write failures. The current
> evidence does not identify the pooler as the unique cause: dashboard rows are
> duplicate deliveries, HTTP 200 does not represent write success, and the
> writable-primary check is later than the failures. Pooler backend state,
> failover or maintenance, and database read-only protection remain live.

## Next safe discriminating observation

Correlate unique event IDs and timestamps with retained pooler target changes,
database role or recovery transitions, and resource-protection events during
the same window. If those histories do not exist, reproduce the relevant state
transition in an isolated replay with a detector that observes the committed
write, not the HTTP response.

Do not force a harmful read-only transition in production. If no comparable
history or safe replay exists, keep the causal conclusion at **unknown** while
retaining the confirmed bounded symptom claim.
