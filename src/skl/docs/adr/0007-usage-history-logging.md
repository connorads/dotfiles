# Usage-history logging: JSONL of successful loads + `skl history`

## Context

`skl` fires through the tmux popup (`prefix + Alt+s`), so atuin never sees the
invocation, and `skl-pick` runs fzf with no history file. There is zero evidence of
skill usage anywhere - curation of the ~115-skill catalogue is vibes. To curate (promote,
demote, cull) we need to know which skills are actually loaded, how often, and when last.

## Decision

Log every **successful** load - one JSONL line per skill, appended at the two success
points in `loadRefs` (after `injectPointer` succeeds, and after the batch clipboard write
succeeds for `--copy`). Record shape (`schema_version: 1`, ISO-8601 UTC `ts`, matching
the papercut convention):

```json
{"schema_version":1,"ts":"2026-07-16T10:00:00.000Z","source":"vendor","name":"grilling","mode":"inject","target":"%3","submit":false}
```

- **File**: `${XDG_STATE_HOME:-~/.local/state}/skl/history.jsonl` - machine-local state,
  deliberately untracked by dotfiles (`~/.local/state` has no un-ignore pattern). Usage
  data is per-machine telemetry, not configuration.
- **Best-effort, never fatal**: an append failure prints a single
  `skl: history write failed (...)` warning to stderr and does not change the exit code.
  The load itself succeeded; curation data is not worth failing it for.
- **`SKL_HISTORY_FILE`** overrides the path - the test seam, and the only new ambient
  read (added to `shell/env.ts` alongside `xdgStateHome()` and `now()`; the core stays
  clock- and env-free, taking `ts` as a parameter).
- **`skl history`** is the minimal readout: parse the file (skipping blank/malformed
  lines - the file accretes across schema changes and interrupted writes), group by
  `source/name`, print `count  ref  last <date>` sorted by count desc then ref asc.
  It needs neither config nor discovery, so it runs before both.

## Considered Options

- **fzf `--history` on the picker**: rejected. It records *typed queries*, not
  selections, and misses the CLI and `--stdin` paths entirely - the wrong data twice
  over.
- **Shell-glue logging in `skl-pick`**: rejected. Only covers the popup; direct
  `skl <ref>` and agent-driven `--stdin` loads would be invisible. The CLI's success
  points see every path.
- **Track the log in dotfiles**: rejected. It is per-machine usage telemetry with
  unbounded growth, not configuration; syncing it across machines would interleave
  unrelated histories.
- **SQLite**: rejected for v1. JSONL is append-only (crash-safe enough for telemetry),
  zero-dep, greppable, and trivially summarised in the pure core.

## Consequences

- Curation decisions can cite counts and recency (`skl history`) instead of vibes.
- The log grows unbounded, but at one small line per load that is years of headroom;
  rotation can come later if it ever matters.
- Records are per-machine; a cross-machine view would need manual concatenation.
- The `history` verb shadows a bare skill named "history" (same precedence as
  `list`/`preview`/`inline`); such a skill needs `skl load history` or a qualified ref.
