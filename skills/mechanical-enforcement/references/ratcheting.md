# Mechanical Enforcement - Ratcheting a gate onto non-conforming code

The ratchet principle belongs to `SKILL.md` (Adding a new rule / Ratcheting),
which routes here for the per-tool mechanics: which tools ship a baseline
vehicle, the traps inside those vehicles, and the notes specific to complexity
gates.

## Vehicles

| Stack / tool | Baseline vehicle | Notes |
|---|---|---|
| ESLint | `eslint --suppress-all` → committed `eslint-suppressions.json` (v9.24+) | New violations still fail; `--prune-suppressions` as debt is paid. |
| dependency-cruiser | `depcruise-baseline` + `--ignore-known` | Makes graph/boundary rules adoptable on an already-tangled repo. |
| basedpyright | `--writebaseline` - the exemplar workflow in `references/python-typecheck.toml` | Count-aware per column. Prunes fixed entries only on an otherwise-clean run; with `CI=true` the mode defaults to lock and a stale baseline exits 3, so CI passes `--baselinemode=discard` on the command line (a `baselineMode` config key is rejected). pyrefly's baseline is not a vehicle because it is not count-aware; use `--suppress-errors` plus `--remove-unused-ignores` there. |
| mypy | `mypy \| mypy-baseline filter` | Single-maintainer wrapper; the only mypy ratchet that exists. |
| import-linter | exact-edge `ignore_imports` entries under `unmatched_ignore_imports_alerting = "error"` | No baseline file. Entries self-expire (a stale edge fails the run), which a dependency-cruiser baseline never does - but a wildcard edge silently absorbs every new violation it matches, so never wildcard an ignore. |
| ruff | `ruff check --select CODE --add-ignore`; expire stale ones with `--extend-select RUF100 --fix` | Bulk inline suppression, not a baseline file - scope per rule and prefer a reason on manually added suppressions. Requires Ruff 0.16+. |
| golangci-lint | `--new-from-merge-base` / `--new-from-rev` | Git-diff gating, so there is no baseline file to maintain; the flags and their CI wiring are under Complexity gates below. |
| complexipy (Python) | `--snapshot-create` → committed `complexipy-snapshot.json`, then `--snapshot-ignore` to opt out | The only per-site Python complexity baseline, keyed by (path, file, function name), so fixing one function and adding another is still caught. A passing run rewrites the snapshot merged with current results, so it ratchets down by itself. Renaming or moving a grandfathered function reads as a new violation, and the file resolves against the invocation directory, so a run from a subdirectory silently drops grandfathering. |
| lizard | `lizard -i <today's count>` | Coarse: a bare warning **count**, not a per-site baseline, so fixing one function and adding another nets zero. Use only for languages with no linter baseline. |
| Coverage (Vitest) | `coverage.thresholds.autoUpdate: true` | Self-tightening: bumps thresholds up as coverage rises. Run where the config edit can be committed, not in a gated CI job. |

Biome and oxlint have no baseline mechanism (open proposals only) - on a legacy
repo that needs one, carry the rule on the ESLint or dependency-cruiser layer
instead. Betterer, the generic snapshot-ratchet wrapper, is dormant, so avoid
it. Where no vehicle exists, fall back to severity: gate at *warning* first,
escalate to *error* after a grace window, and tighten the number release by
release.

## Traps in the vehicles

- **ESLint's `--suppress-all` records only rules configured as `error`**, so
  the common adoption order (land the rule at `warn`, tighten later) silently
  writes an empty baseline.
- **`--suppressions-location` must be passed on *every* ESLint run**, not just
  when creating the file, or ESLint reads no suppressions and the gate fires on
  legacy code.

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
  `--fail-on-new-clones`) landed after 5.0.16**, so check the current release
  before promising "no new clones" - until the flags ship, the percentage
  threshold is the only lever.
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
