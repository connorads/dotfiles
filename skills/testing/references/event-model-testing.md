# Event Model Testing

Read this when testing aggregates, policies, processes (sagas) or read models
built from commands and events (the `architecture` skill's
`references/event-modelling.md`), whether the aggregates are event-sourced or
store state.

## The Shape

Write each test as given / when / then in the domain's own words (Young's
event-sourced specifications; the "specifications" of Event Modeling):

- **Given** the prior facts, as events.
- **When** one command arrives.
- **Then** these events were recorded, or this rejection was returned with its
  evidence, and this reply came back.

For a state-stored aggregate, build "given" by sending earlier commands
through the public decision, not by writing a state literal. Commands survive a
change to the state's shape; a literal breaks on every refactor.

Test an aggregate through a stable public pure function when it has one.
Otherwise use its public command interface. Do not expose internals just for tests.
Test policies, processes and read models through an in-memory composition of
the whole model, with owned stores in memory and external systems faked.

## Make The Harness Strict

Choose a harness that checks business outcomes in the story's named aggregates.
For example, expecting `PaymentDeclined` must also catch an unexpected
`OrderShipped`. Exclude logs and internal steps. Build or choose one that:

- fails on unexpected business events, unasserted rejections and process defects;
- treats a "then" with no events as "nothing new was recorded";
- lets "given" events reach read models but never trigger policies, so setup
  has no side effects;
- runs every policy, process and projection after "when" until the model
  settles;
- keeps each external call pending until the test answers it, fails on a call
  left unanswered unless the test asserts that it remains pending, and requires
  a tag to answer one of several pending calls.
  The test then chooses the order and the failures;
- owns the clock: commands take its time, and moving it fires due scheduled
  commands and process timers. Test a deadline one tick before it and at it.

For a payment race, hold the provider response, cancel the order, then release
the response. Check that the order stays cancelled and the payment reaches the
required outcome, such as a refund. Test the reverse order too. A timeout does
not prove the provider stopped. Use the test clock to check any promised deadline.

For resumable work, interrupt the worker after an external action succeeds but
before completion is saved. Restart it. Check the business effect happens once
and the workflow finishes. The request may repeat; a payment must not charge
the customer twice. Test this through the runtime that owns recovery.

## What To Cover

- Every command: the happy path, each rejection, each authorisation case
  (owner, another customer, staff).
- Every policy: its reaction, and its reaction when the command it sends is
  rejected.
- Every process: completion, each failure with its compensation, and each
  wait (a signal arriving, a timeout firing).
- Every read model: its state after the events it folds.

Compare whole events and rejections, evidence fields included, so the evidence
a client relies on is part of the contract under test.

Test a process by its outcome - the events its steps recorded and how the run
ended - never by its internal steps. Step-level assertions break on every
reordering that leaves the outcome intact.

## Layers Above

Keep business-rule combinations in cheap tests. Test behaviour introduced by
outer boundaries through those boundaries, including authentication and
authorisation. Avoid repeating the whole rule matrix.

- **API**: host the model in memory with the real authentication middleware,
  and drive it through the API client. This checks authentication, read
  authorisation and live reads.
- **Wire and deployment**: one test over the real protocol, and one end-to-end
  flow against the deployed stack. `scenario-testing.md` owns their design.
