# Mechanical Enforcement - Ratcheting a gate onto non-conforming code

The ratchet principle belongs to `SKILL.md` (Adding a new rule / Ratcheting),
which routes here for the per-tool mechanics: which tools ship a baseline
vehicle, the traps inside those vehicles, and the notes specific to complexity
gates.

## Vehicles

| Stack / tool | Baseline vehicle | Notes |
|---|---|---|
| ESLint | `eslint --suppress-all` → committed `eslint-suppressions.json` (v9.24+) | Counts per (file, rule), not per site, so deleting one violation and writing a fresh one of the same rule in the same file nets zero and passes. A new rule, a new file and a raised count still fail; `--prune-suppressions` as debt is paid. Verified 2026-09-03 against eslint 10.9.1. |
| dependency-cruiser | `depcruise-baseline` + `--ignore-known` | Makes graph/boundary rules adoptable on an already-tangled repo. Entries are module-precise (`from` module plus rule name), so moving or renaming a grandfathered module reads as a new violation. TypeScript < 7 only - see `references/architecture-boundaries.md`, Transitive architecture tests. |
| basedpyright | `--writebaseline` - the exemplar workflow in `references/python-typecheck.toml` | Count-aware per column. Prunes fixed entries only on an otherwise-clean run; with `CI=true` the mode defaults to lock and a stale baseline exits 3, so CI passes `--baselinemode=discard` on the command line (a `baselineMode` config key is rejected). pyrefly's baseline is not a vehicle because it is not count-aware; use `--suppress-errors` plus `--remove-unused-ignores` there. |
| mypy | `mypy \| mypy-baseline filter` | Single-maintainer wrapper; the only mypy ratchet that exists. |
| import-linter | exact-edge `ignore_imports` entries under `unmatched_ignore_imports_alerting = "error"` | No baseline file. Entries self-expire (a stale edge fails the run), which a dependency-cruiser baseline never does - but a wildcard edge silently absorbs every new violation it matches, so never wildcard an ignore. |
| ruff | `ruff check --select CODE --add-ignore`; expire stale ones with `--extend-select RUF100 --fix` | Bulk inline suppression, not a baseline file - scope per rule and prefer a reason on manually added suppressions. Requires Ruff 0.16+. |
| golangci-lint | `--new-from-merge-base` / `--new-from-rev` | Git-diff gating, so there is no baseline file to maintain; the flags and their CI wiring are under Complexity gates below. |
| complexipy (Python) | `--snapshot-create` → committed `complexipy-snapshot.json`, then `--snapshot-ignore` to opt out | The only per-site Python complexity baseline, keyed by (path, file, function name), so fixing one function and adding another is still caught. A passing run rewrites the snapshot merged with current results, so it ratchets down by itself. Renaming or moving a grandfathered function reads as a new violation, and the file resolves against the invocation directory, so a run from a subdirectory silently drops grandfathering. |
| lizard | `lizard -i <today's count>` | Coarse: a bare warning **count**, not a per-site baseline, so fixing one function and adding another nets zero. Use only for languages with no linter baseline. |
| knip | per-issue-type severity in the `rules` key (`"error"` / `"warn"` / `"off"`) | No baseline file exists. `"warn"` keeps a type in the report and out of the exit code, so adopt type by type; `"off"` drops it from the report as well. `--max-issues N` counts what survives `--include` and `--production` filtering, so a per-category budget takes one scoped run each, and a number tuned in one mode does not hold in the other. The non-numeric `--max-issues` fail-open and its version floor: `references/typescript.md`, Dead code (knip). Verified 2026-09-03 against knip 6.33.0. |
| Coverage (Vitest) | `coverage.thresholds.autoUpdate: true` | Self-tightening: bumps thresholds up as coverage rises. Run where the config edit can be committed, not in a gated CI job. |

Biome, oxlint and `tsc` have no baseline mechanism at all (open proposals
only), so a strict compiler flag has no ratchet vehicle in TypeScript. The
ESLint and dependency-cruiser rows carry lint and graph rules rather than
compiler flags, and neither tool runs on TypeScript 7 without the side-by-side
TypeScript 6 alias (`references/typescript.md`, Type checking), so on an
all-oxc repo neither is reachable. Betterer, the generic snapshot-ratchet
wrapper, is dormant, so avoid it. Where no vehicle exists, fall back to
severity: gate at *warning* first, escalate to *error* after a grace window,
and tighten the number release by release.

## Traps in the vehicles

- **ESLint's `--suppress-all` records only rules configured as `error`**, so
  the common adoption order (land the rule at `warn`, tighten later) silently
  writes an empty baseline.
- **`--suppressions-location` must be passed on *every* ESLint run**, not just
  when creating the file, or ESLint reads no suppressions and the gate fires on
  legacy code.
- **A partially paid entry exits `2`, not `1`.** Clearing one of two suppressed
  violations leaves the count stale, and ESLint reports "There are suppressions
  left that do not occur anymore" and exits 2 - so a CI step that reads 1 as
  "lint failed" and anything else as a crash misreports paid-down debt as
  tooling breakage. Re-run with `--prune-suppressions`.
- **Entries for deleted files never expire.** The unused-suppression check only
  sees files the run actually lints, so a suppressed file that is deleted leaves
  its entry behind at exit 0 and the baseline grows stale in silence. Prune on a
  schedule rather than waiting for a failure.

## Complexity gates

- **On the all-oxc stack** (no baseline, above) a complexity rule's levers are
  severity, glob scoping (`src/**` first, then widen) and the release-by-release
  tightening. Do not add an ESLint layer to a complexity rule purely to reach
  `--suppress-all`.
- **Ruff has no complexity baseline and no per-rule severity**, so adopting the
  family is all-or-nothing on a legacy tree. Compare a committed
  `ruff check --statistics` snapshot in CI, or carry the gate on complexipy,
  which does ship a baseline.
- **jscpd's clone baseline (`--baseline`, `--update-baseline`,
  `--fail-on-new-clones`) is absent at 5.1.0**, so the percentage threshold is
  the only lever. Read the installed package version, not `jscpd --version`,
  which self-reports `cpd 5.0.16` from the 5.1.0 package. Verified 2026-09-03;
  the release-age quarantine holds back 5.1.2, so recheck the flags there.
- **Go's git-diff filter in full**:
  `golangci-lint run --new-from-merge-base=origin/main --whole-files`.
  `--whole-files` matters because a complexity finding is reported at the
  function **signature** line, so editing the middle of a long function
  otherwise hides it; the flag help text claims it requires `--new-from-rev`,
  which is stale - no such validation exists in the code. `actions/checkout`
  defaults to `fetch-depth: 1`, which leaves no merge base and makes the filter
  silently see nothing, so set `fetch-depth: 0` and name a remote-tracking ref.
  Keep the filter on the CI command line rather than the committed config, so
  local runs still see the whole tree.
