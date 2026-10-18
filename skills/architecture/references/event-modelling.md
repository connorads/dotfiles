# Event Modelling

Read this when turning requirements into a domain model for a core domain:
naming commands, events, rejections and aggregates, or deciding what reacts to
what. The output is a set of building blocks plus a persistence choice per
aggregate; event sourcing is one option, not the default.

The vocabulary follows Event Modeling (Dymitruk) and the Decider pattern
(Chassaing), on top of Wlaschin's workflows (command in, events out).
alchemy's `alchemy-domain` skill is a worked, event-sourced example.

## The Building Blocks

| Block | What it is | Name shape |
|---|---|---|
| Event | a fact the business records | past tense: `MoneyWithdrawn` |
| Command | a request to change something; can be refused | `<Verb><Noun>`: `WithdrawMoney` |
| Rejection | one way a command is refused | the reason: `InsufficientFunds` |
| Aggregate | the rules that must hold in one transaction; decides commands | the thing: `Account` |
| Read model (view) | the answer to one question, keyed by what it is about | the question: `AccountSummary` |
| Policy | "whenever X, do Y": event in, command out | the reaction: `FraudReview` |
| Process (saga) | a reaction with steps, waits or undo | the process: `ExecuteTransfer` |
| External system | a port for a system outside the model, in the domain's words | the capability: `FraudCheck` |
| Projection | writes a store you own from events | the store: `Ledger` |

## Method

Work in order. Do not settle a noun before the process around it exists.

1. Write the requirements as sentences in the business's words. Send contested
   or vague words to the `distilling-domain-language` skill first.
2. List the facts. Each past-tense statement the business cares about is an
   event. Give it what a later reader needs (`balanceAfter`, `by`, `reason`),
   so readers copy values instead of recomputing them. Never name it after a
   field change: `AccountUpdated` and `BalanceSet` hide the business fact.
3. Find the decisions. Name the command behind each event, then ask what can
   refuse it. Each answer is a rejection carrying its evidence
   (`InsufficientFunds { balance, requested }`): the fields a client needs to
   explain the refusal.
4. Draw consistency boundaries. Group the commands whose rules must be checked
   together in one transaction; that group is an aggregate, keyed by an id.
   Its state holds only what its decisions need. For a rule that spans
   instances (uniqueness, a deadline racing a decision), use the recipes in
   `workflows-transactions.md`; never a cross-aggregate transaction.
5. Answer the questions. Each screen or report is a read model keyed by its
   subject. One read model may fold events from several aggregates, and one
   event may route to several keys (a transfer appears on both accounts).
   Audience and security rules are in `reads-and-writes.md`.
6. Find the reactions. Each "whenever X, do Y" is a policy. A policy has no
   caller, so it acts as a named system actor and the history says who acted.
7. Find the processes. A reaction with several steps, waits or undo is a
   process, keyed by the aggregate it is about and started by a policy. The
   saga shape is in `event-driven-architecture`'s `topology.md`.
8. Find what is outside. Calls to other systems are ports declared in the
   domain's words. Writes to stores outside the model are projections.
9. Decide who sees what. Group commands and reads by audience. The edge
   authenticates; the decision authorises (below).
10. Choose persistence per aggregate. Store state by default. Event-source an
    aggregate only where its history is the requirement (SKILL.md, Workflows
    as Pipelines).

## The Decide Function

Write each aggregate's behaviour as a decider: a pure
`decide(command, state, now) -> events | rejection`. This holds with stored
state too: the shell loads state, calls `decide`, applies the events to the
state and saves it in one transaction.

- Pass `now` in. Time rules then test with a fixed instant instead of a clock.
- Return an empty list for "accepted, nothing to record" (freezing an
  already-frozen account). A repeated command then succeeds without a special
  idempotency branch.
- Model state as a lifecycle union (`Unopened | Open | Closed`), and let every
  id start in the initial state. The first accepted command opens it, so
  "create" and "update" need no separate paths and "not found" disappears.
- Authorise inside `decide`, against the actor and the current state. The edge
  establishes who is asking; only the current state knows whether they own the
  thing now.
- A rule that must hold at commit belongs in `decide`. A policy runs after the
  commit, so a rule placed there can already be broken.

### If This Aggregate Is Event-Sourced

- Add `evolve(state, event) -> state`. It applies a fact and never decides;
  current state is the fold of `evolve` over the history.
- An impossible transition in `evolve` is a bug in `decide`. Throw, and let the
  commit roll back; never patch the state.
- Compute the reply from the state after the events, and store it under the
  command id, so a retried command returns the identical reply.
- Commit the events, the new version, the reply and the outbox rows in one
  write (the transactional outbox, see `event-driven-architecture`).

## Smells

- A command that changes two aggregates. Split it, and connect the parts with a
  policy or a process.
- An event named after a field change.
- A rejection without evidence.
- A read model that filters its rows by caller. Give each audience its own.
- A policy that waits for a result. Start a process and react to its events.
- An invariant enforced in a policy. Move it into `decide`.

## Layout Option

Where the repo has no convention for event-modelled code, one block per file
named `<Noun>.<kind>.ts` reads well: `WithdrawMoney.command.ts` holds the
command, its events and the rejections only it returns. A piece moves to its
own file once a second command uses it. Folders are subdomains, and the domain
package imports no infrastructure. The repo's existing convention still wins
(SKILL.md, Adapt First).

Testing this model is in the `testing` skill's `event-model-testing.md`.
