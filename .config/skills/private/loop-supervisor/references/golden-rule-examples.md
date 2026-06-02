# Golden Rule Examples

The golden rule is the one-line frame for the supervisor — what's
inside its domain and what's outside. It's load-bearing: every
ambiguous judgement call during supervision should trace back to it.

Use these as seed material for the interview. Offer 2–3 as prompts
and let the user adapt one, or write their own.

## By project shape

### Autonomous research / hypothesis-driven loops

> Operate the harness. Fixing a broken runner or freeing a stuck
> hypothesis is your job. Writing probes, forming hypotheses,
> interpreting results is the inner loop's job.

*Source: hackmonty. The clean harness/research split made
supervision predictable — when a question came up, the rule
answered it.*

### Source-port / long-running multi-lane projects

> Keep lanes balanced and worktrees clean. Unblock the autonomy loop
> from harness and isolation bugs. Writing game logic, reverse-
> engineering the original, and deciding what to port next is the
> inner loop's job.

*Source: KC-style source-port work. The big failure modes are
lane thrashing and worktree corruption, both harness concerns.*

### Build-green / CI-driven loops

> Keep the build gate green and the runner healthy. Fix flakes,
> missing dependencies, and infra races. The inner loop chooses
> what to build, fix, or refactor.

*Good for loops aimed at a specific passing-test or passing-build
milestone.*

### Task-loop / backlog execution

> Keep the loop consuming the backlog without tripping over infra
> or state. Marking items blocked, fixing runner errors, and nudging
> rhythm is your job. Implementing tasks is the inner loop's job.

*Good default for `/task-loop`-scaffolded projects that just need
to run a backlog to completion.*

## By authority stance

### Escalate-only

> Watch the loop. When anything looks wrong, stop it and tell me.
> Don't try to fix anything yourself.

*Pair with escalate-only authority. Suitable for first-ever
supervision of a new project.*

### Autonomous

> Keep the loop making progress. Fix anything that stops it,
> implement anything it can't, commit when the project's conventions
> say so. Use judgement on what I'd want. Flag anything surprising
> in your final message.

*Pair with autonomous authority. Suitable for mature projects where
the supervisor is essentially a second pair of hands.*

## Patterns across all of them

Every good golden rule says two things:

1. **What's yours** — usually some variant of "harness", "infra",
   "loop rhythm", "unblock"
2. **What's theirs** — usually some variant of "the actual work",
   "domain decisions", "the research / code / content"

If the rule only says what's yours, the supervisor will drift into
loop-domain work when things get hard. If it only says what's
theirs, the supervisor won't know when it's allowed to act.

Keep it one sentence. The moment it becomes a paragraph, it stops
being a *rule* and starts being a *policy* — and policies get
skimmed, not internalised.
