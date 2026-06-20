# Backlog Format

The canonical markdown template for a task backlog.

## Template

```markdown
# <Backlog Title>

<One-line description of the work stream.>

## Status Legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete

## Reference

| Resource | Location |
|----------|----------|
| **<Doc name>** | `<path or URL>` |
| **<Tool/skill>** | `<name or path>` |
| **<Input source>** | `<path, URL, or description>` |

## Decisions

Durable decisions that apply across all tasks:

- **<Category>**: <decision>
- **<Category>**: <decision>

## How to Use This File

Each task follows this pattern. Complete **all** steps:

1. **Read context** — read the files listed in the task
2. **Make changes** — follow the "What to do" instructions
3. **Verify** — follow the verification steps
4. **Commit** — single coherent commit

---

## <Phase Name>

<Optional phase description.>

### [ ] **<ID>: <Title>** | **Size: <XS|S|M|L>** | **Deps: <IDs or none>**

**Problem:** <What's wrong or missing — the why.>

**What to do:**

1. <Concrete step with file path>
2. <Concrete step>
3. <Concrete step>

**Verification:**

- <Exact command or check>
- <What the output should look like>

**Files:** `<path>`, `<path>`

**Acceptance criteria:** <Observable outcome.> Tests pass.

---

## Dependency Graph

\```text
<ID> (<description>) ──── <ID> (<description>)
                      ├── <ID> (<description>)
                      └── <ID> (<description>)
\```

## Priority Order

**Phase 1 — <Theme>:**

- <ID>, <ID>, <ID>

**Phase 2 — <Theme>:**

- <ID>, <ID>
```

## Notes

- Every task gets an `[ ]` checkbox for tracking
- Task IDs use a short prefix grouping related tasks (e.g. CC = cross-cutting,
  AU = auth, DB = database, UI = user interface)
- The reference table links to docs and tools that help execute tasks
- The decisions section prevents repeating context across tasks
- The dependency graph shows which tasks unblock others
- Priority order groups tasks into execution phases
- Verification can be global (in "How to Use") or per-task or both
- Per-task verification overrides or extends global rules
