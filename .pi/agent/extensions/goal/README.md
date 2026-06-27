# goal

A `/goal` command for pi — set a persistent objective that's re-stated to the model
every turn, so it never drifts and **survives context compaction**. Inspired by
OpenAI Codex's `/goal`, but built as a small, cache-friendly pi extension.

## Usage

```text
/goal <objective>   set / replace the objective
/goal               show the current objective (read-only, no model turn)
/goal edit          edit the current objective in a multi-line editor
/goal pause         stop steering, keep the objective stored
/goal resume        resume steering
/goal clear         remove the objective
```

Press `Esc` to stop the agent's current work — that doesn't touch the goal. To carry
on, just send a message: the objective is still in the system prompt, so the agent
picks it back up (inspecting the current repo/worktree state rather than assuming
earlier progress).

A widget above the editor shows the active goal at all times.

## How it works

- **Persistence** — each command appends an immutable `goal` custom entry to the
  session (`pi.appendEntry`). Current state is a latest-wins fold over the current
  branch's goal entries (`reduceGoal`), so it is restored on `/resume` and reload and
  stays correct across `/fork` and `/tree` for free. `/new` starts fresh.
- **Steering** — while a goal is active, `before_agent_start` appends a fixed
  `<active_goal>` block to the system prompt. The system prompt is regenerated each
  turn and is *not* part of compactable history, which is what makes the goal
  compaction-proof.
- **Prompt caching** — the injected block is a pure function of the objective text
  (no progress counters, no token budgets, no timestamps), so it is byte-stable. pi
  caches the system prompt as its own breakpoint
  (`packages/ai/src/providers/anthropic.ts`), so the block is written to cache once
  when you set/edit the goal, then read on every subsequent turn. Putting changing
  data here would invalidate the whole prefix every turn — hence it's kept static.

## Deliberately not in v1

Steering only — no auto-continuation loop, no `goal_complete` tool, no token budget,
no `session_before_compact` hook (the system-prompt anchor already makes the goal
compaction-proof). Those belong to a later self-driving phase; Codex's evidence-based
completion-audit prompt is the natural thing to port then.

## Tests

Pure logic and the pi wiring are both covered, with no test-framework dependency
(Node's built-in runner, native TypeScript):

```sh
node --test core.test.ts index.test.ts
# or: npm test
```

- `core.test.ts` — `parseGoalCommand`, `reduceGoal` (incl. branch slices), and the
  cache-stability of `renderGoalBlock`.
- `index.test.ts` — drives `index.ts` against an in-memory fake of pi: set / pause /
  resume / clear / edit / show, branch reconstruction on `session_start`, and that
  injection depends only on the goal entry (never on chat history).

Manual smoke: `/goal ship X`, send a message, confirm the model is steered and the
goal persists after a `/compact`.
