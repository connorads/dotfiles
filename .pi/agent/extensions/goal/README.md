# goal

A `/goal` command for pi — set a persistent objective that's re-stated to the model
every turn (so it never drifts and **survives context compaction**) and, by default,
**self-drives**: the agent keeps working toward the objective each turn until it's
complete, blocked, or out of budget. Inspired by OpenAI Codex's `/goal`, built as a
small, cache-friendly, dependency-free pi extension.

## Usage

```text
/goal <objective>                 set a self-driving objective (auto-continuation ON)
/goal <objective> --steer-only    set a steer-only objective (v1: anchor only, no loop)
/goal <objective> --tokens 200k   cap the self-driving token budget (e.g. 200k, 1.5m, 50000)
/goal <objective> --max-iterations 25   cap the number of auto-continuations
/goal                             show the current objective (read-only, no model turn)
/goal status                      show objective + status + remaining budget (read-only)
/goal edit                        edit the current objective in a multi-line editor
/goal pause                       stop steering and self-driving, keep the objective stored
/goal resume                      resume (resets the budget/iteration runway)
/goal clear                       remove the objective
```

Flags can appear anywhere in the argument; everything else is the objective text.
`--budget` is an alias for `--tokens`; `--max-iter` for `--max-iterations`;
`--no-auto`/`--steer` for `--steer-only`. Launch pi with `--no-auto` to make new goals
steer-only by default (a budget flag or `--auto` still opts an individual goal in).

While a goal self-drives the model is given two tools:

- `update_goal{status:"complete"|"blocked", summary}` — the only way the model ends the
  loop early. `complete` requires the evidence-based completion audit to pass; `blocked`
  requires the 3-consecutive-turn blocked audit. A `complete` whose own summary admits
  unfinished work (failing tests, TODOs, "partial", "not done") is rejected.
- `get_goal{}` — read the objective, status, and remaining token/iteration budget.

Press `Esc` to stop the agent — that **pauses** a self-driving goal (the aborted turn is
not counted). Sending your own message also pauses it (you've taken over); `/goal resume`
hands control back to the loop with a fresh runway.

A widget above the editor shows the objective, status, and budget at all times.

## How it works

- **Persistence / event sourcing** — every command and observation appends an immutable
  `goal` custom entry to the session (`pi.appendEntry`): `set` (carrying the resolved
  mode), `edit`, `pause`, `resume`, `clear`, `progress` (per-turn token metering), and
  `status` (lifecycle transitions with a structured reason). Current state is a
  latest-wins fold over the current branch's entries (`reduceGoal`). Because the budget,
  iteration, and no-progress counters live in this log, they stay correct **by
  construction** across reload, compaction, `/fork`, and `/tree` — there is no parallel
  in-memory store to drift.
- **Steering (the anchor)** — while a goal is active, `before_agent_start` appends a fixed
  `<active_goal>` block to the system prompt. The system prompt is regenerated each turn
  and is *not* compactable history, which is what makes the goal compaction-proof. The
  anchor is a pure function of `(objective, mode kind)` only — no counters — so it is
  byte-stable and written to the prompt cache once, then read every turn. Auto mode adds
  the static completion/blocked audit here; steer mode is exactly the v1 anchor.
- **Self-driving (the loop)** — after each run (`agent_end`) the engine meters the turn,
  folds the new state, and runs a pure truth table (`decideContinuation`) to decide
  whether to queue a follow-up "continuation" message (`sendUserMessage`, `followUp`) that
  triggers the next turn. The volatile budget countdown + update_goal nudge are injected
  per-turn into the live message list via the `context` event (never the cached system
  prompt), so the cache prefix stays stable.
- **Guard set** — the runtime imposes no recursion cap; the stop condition is entirely
  ours, so the loop bakes in the full set: a token **budget** (one wrap-up turn, then
  stop), a **max-iteration** backstop, a **no-progress** guard (3 consecutive low-output
  turns), a **context-full** guard (95%), a **cooldown** between turns, an in-flight
  **dedup** flag, and **error classification** (transient → keep going under the caps;
  fatal → mark blocked). Terminal/abort/human signals always beat the caps.

### Decided defaults

| Knob | Default | Override |
|---|---|---|
| Token budget | `200_000` | `--tokens` |
| Max iterations | `25` | `--max-iterations` |
| No-progress | output `<50` tokens × `3` turns | — |
| Context-full pause | `95%` | — |
| Continuation cooldown | `~2s` | — |
| Auto vs steer | auto | `--steer-only`, or global `--no-auto` |

### Lifecycle & edge cases

- **Esc mid-loop** → pause `interrupted`; the aborted turn isn't metered or continued.
- **Human message mid-loop** → pause `human_takeover`; our own continuations
  (`source: "extension"`) and `/goal` commands never trip it.
- **Budget exhausted** → one `budget_limited` wrap-up turn (with the codex budget-limit
  message), then the loop stops; the model may still `update_goal complete` if genuinely done.
- **`/goal resume`** → resets the runway (tokens/iteration/no-progress → 0) and re-kicks.
- **Compaction** → no special handling; the anchor + tail re-inject the objective/status
  every post-compaction turn.
- **`/fork` / `/tree`** → counters come from the branch's entries; `session_tree` also
  drops any stale in-flight continuation.

## Design (ADR notes)

- **Functional core / imperative shell.** Every decision is a pure function in
  [`core.ts`](./core.ts) (`reduceGoal`, `decideContinuation`, `decideCompletion`, the
  parsers, the renderers, the metering). All pi I/O, the clock, and timers sit behind a
  port.
- **A domain-named port, not a structural `Pick`.** The loop depends on
  [`GoalRuntime`](./runtime.ts) — verbs like `record`, `sendContinuation`,
  `contextPercent`, `now`, `sleep` — so it is tested against a type-honest in-memory fake
  with **no `as` cast**. Rejected alternatives: a flag-bag of booleans on the engine (hides
  illegal states) and `Pick<ExtensionAPI, …>` (couples the engine to pi's surface and the
  cast that comes with faking it). The real adapter (`createPiRuntime`) is the only place
  that touches `pi`/`ctx`, the clock, and `setTimeout`.
- **Illegal states unrepresentable.** `mode` is a tagged union so a steer-only goal has
  *nowhere* to hold a budget/iteration counter; `status` and `GoalEvent` are discriminated
  unions; a new event variant is a compile error via `assertNever`.
- **Parse, don't cast.** `parseGoalEvent` validates every persisted entry (replacing v1's
  `entry.data as GoalEvent`) and migrates a v1 `set` with no mode to steer-only — so an
  existing goal never starts self-driving by surprise on upgrade.
- **Plain JSON Schema tool params (one documented cast).** The `update_goal`/`get_goal`
  tools pass plain JSON Schema objects rather than importing TypeBox. pi's validator
  (`pi-ai` `validation.js`) has an explicit branch for schemas without TypeBox metadata, so
  this keeps the extension's **only runtime dependency `./core.ts`** (pi and typebox are
  type-only imports, erased) and keeps the test suite free of any dependency. The single
  `as unknown as TSchema` cast at the pi boundary carries a `// SAFETY:` note; it's verified
  against the real validator in the load smoke.
- **Completion is codex-faithful + a backstop.** The completion/blocked audit prompt is
  ported from `openai/codex` (`codex-rs/ext/goal/templates/goals/continuation.md`); the
  decision lives in `decideCompletion` (core), and the tool's `execute` only translates a
  rejection into pi's error channel by throwing.

## Tests

Pure logic, properties, and the pi wiring are all covered with **no test-framework
dependency** (Node's built-in runner, native TypeScript):

```sh
node --test core.test.ts index.test.ts
# or: pnpm test
```

- `core.test.ts` — parsing (incl. invalid-vs-absent option results and old-shape rejection
  in `parseGoalEvent`), `reduceGoal` (mode init, progress/no-progress, resume reset, branch
  slices), the full `decideContinuation` truth table + precedence, `decideCompletion` ±,
  metering + `classifyError`, anchor byte-stability and tail content, plus seeded
  **property-based** tests (zero-dep mulberry32) for the reduce invariants, options
  round-trip, and decision precedence.
- `index.test.ts` — the engine driven against a type-honest fake `GoalRuntime` (set →
  continuation; budget wrap-up then stop; no-progress → stuck; max-iter; context-full;
  abort; fatal → blocked; human takeover; dedup; update_goal accept/reject; steer-only;
  anchor/tail presence; resume; session_tree), plus a pi+ctx fake that drives the real
  adapter and command/tool registration end-to-end.

Live smoke: `/goal --tokens 1k "tiny task"` → watch one continuation, the budget wrap-up
turn, then a clean stop; confirm `/goal status`, Esc-pauses, a human message yields, and
`--steer-only` never loops.
