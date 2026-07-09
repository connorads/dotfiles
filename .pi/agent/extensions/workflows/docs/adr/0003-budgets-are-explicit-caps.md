# Budgets are explicit caps

Status: accepted

Workflow budgets remain Claude-compatible through optional positive `meta.budget` values, but generated workflows omit them by default. A budget is a hard output-token cap for advanced workflows, not a stability requirement or normal planning aid; missing, non-positive, or invalid budget values leave the run uncapped while the independent agent-call cap still protects against runaway loops.

## Considered Options

- **Optional explicit cap (chosen)** - preserves compatibility without making ordinary generated workflows fail because of budget accounting.
- **Display-only budgets** - simpler operationally, but scripts using `budget.remaining()` would become misleading when they expected a cap.
- **Remove budget from the UX entirely** - stable, but unnecessarily breaks a fundamental part of the Claude workflow DSL.
