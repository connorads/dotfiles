- `inspect` / `layout` (layout sweep + motion sidecar) → `check` (same flags: `--samples`, `--at`, `--at-transitions`, `--tolerance`, `--strict`).

Migrate scripts by replacing the sequence with the single `check` invocation; scaffolded projects' `pnpm check` already points there.
