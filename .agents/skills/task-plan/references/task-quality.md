# Task Quality Heuristics

Reference material for decomposing input into high-quality tasks.

## The Four Tests

### The one-iteration test

Can a fresh agent session complete this task in one loop iteration (~30 min)?

**Split if:**

- The task requires exploring unfamiliar code AND making changes AND
  writing tests — that's three phases of work
- The task touches more than 5-6 files across different concerns
- The task requires multiple rounds of comparison against a reference
  (design mockup, spec, existing behaviour)

**Don't split if:**

- The task is conceptually one thing even if it touches several files
  (e.g. adding a field to model + API handler + UI + test)

### The one-commit test

Does this task produce exactly one coherent commit?

**Split if:**

- A reviewer would want to see this as two separate diffs
- The commit message would need "and" connecting unrelated things
- Renames/moves are mixed with content changes (git rename detection breaks)

**Merge if:**

- Two tasks would produce commits that can't stand alone
- A "setup" task has no value without its first consumer
- The overhead of two separate iterations exceeds the work

### The cold-start test

Could an agent with zero session memory execute this task?

Every task should include:

- **File paths** that will be read and modified
- **Current state** — what exists now (not just what should change)
- **Exact steps** — not "fix the layout" but "change the grid from
  2 columns to 3 at the md breakpoint in `ProductGrid.tsx`"
- **Verification commands** — not "check it works" but "run `npm test`
  and verify the endpoint returns 200 with a valid payload"
- **Reference material** — links to docs, design files, API specs

The test: if you deleted the problem description and only kept "what to do",
could the agent still execute correctly? If yes, the context is sufficient.

### The revert test

Could `git revert <commit>` be applied cleanly?

**Fails when:**

- A task adds code that another task in the same batch depends on
- A task partially implements something that needs a follow-up to work
- A task changes a shared interface without updating all callers

## Size Estimation

| Size | Time | Scope | Examples |
|------|------|-------|---------|
| XS | < 10 min | Single file, mechanical change | Fix a typo, rename a constant, update a config value |
| S | 10-20 min | 1-3 files, straightforward | Add a field to a model, extract a helper function, fix a CSS layout issue |
| M | 20-40 min | 3-6 files, some design decisions | Add a new API endpoint with handler + tests, implement a form with validation |
| L | 40+ min | Many files or significant complexity | New feature end-to-end: model + API + UI + tests + documentation |

**If a task is L, ask:** can it be split into an M foundation + S additions?

## Common Splitting Patterns

**By concern:** schema change (+ types + migration) in one task, component
that uses the schema in the next.

**By layer boundary:** extract a reusable component first, then use it in
the new feature.

**By data flow:** seed/content changes separate from component/layout changes
when they're independently verifiable.

**By risk:** regression-protection snapshot tests first, then the refactor
that might break things.

## Common Merging Patterns

**Setup + first use:** don't create a task that only adds infrastructure
with no consumer. Merge it with the first task that uses it.

**Rename + update:** renames should include all reference updates in one
commit (otherwise the build breaks between commits).

**Config + verify:** adding a config field and verifying it works should
be one task, not two.

## Anti-Patterns

**Too granular:** "Add import statement" is not a task. If the overhead
of reading the backlog, updating state files, and committing exceeds
the actual work, the task is too small.

**Too vague:** "Fix the layout" gives an agent nothing to work with.
Include file paths, current state, what's wrong, and what correct
looks like.

**Missing verification:** "Make the change" without "and verify by running
X" means the agent might commit broken code and mark the task done.

**Missing file paths:** Forces the agent to spend iteration time on
codebase exploration instead of execution.

**Horizontal layers:** "Add all schema changes" then "add all components"
means nothing is demoable until everything is done. Prefer vertical
slices that deliver one complete feature path.
