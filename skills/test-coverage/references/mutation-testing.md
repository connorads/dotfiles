# Mutation Testing: Measuring Whether Tests *Detect* Bugs

Line coverage proves a test **executed** a line. Mutation testing proves a test would **fail** if that line were wrong. It is the strongest readily-automatable signal for test *quality*, and the natural next gate once coverage is high but you suspect the tests are weak.

## How it works

A mutation tool makes small, semantics-changing edits to your source (a *mutant*) — flip `>` to `>=`, `&&` to `||`, delete a statement, change a return value — then runs the test suite against each mutant.

| Outcome | Meaning |
|---------|---------|
| **Killed / caught** | At least one test failed → tests detect this defect ✅ |
| **Survived / lived / missed** | All tests passed → tests are blind to this defect ❌ |
| **Timeout** | Mutant caused an infinite loop; counted as killed |
| **No coverage** | Mutant on a line no test runs; a pure coverage gap |
| **Unviable / errored** | Mutant didn't compile; excluded from the score |

**Mutation score = detected / valid × 100** (Stryker's definition: `detected = killed + timeout`, `valid = detected + undetected`). A surviving mutant is a concrete, actionable to-do: *"here is a bug your tests won't catch — write the assertion that kills it."*

Source: [Stryker — mutant states & metrics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/).

## Why it beats coverage as a quality signal

The **oracle gap** — the difference between coverage and mutation score — is itself a diagnostic neither metric exposes alone. *High coverage + low mutation score* pinpoints files where **assertion-poor tests execute important code without checking its behaviour** ("Mind the Gap", Jain et al., [arXiv 2309.02395](https://arxiv.org/abs/2309.02395), backed by three empirical studies).

Mutation testing also changes behaviour, not just measurement. In Google's large-scale study ([Petrović et al., ICSE 2021](https://homes.cs.washington.edu/~rjust/publ/mutation_testing_practices_icse_2021.pdf)), as developers' exposure to mutants rose they wrote **more** tests (median changed test-hunks 1 vs 0 for the coverage baseline; Spearman rs=0.9 for mutation exposure vs **−0.24** for coverage — coverage exposure correlated *negatively* with new tests).

## The cardinal rule for CI: stay incremental

Naive mutation testing is O(mutants × test-suite-runtime) and will not finish on a real codebase. Google's production-scale pattern keeps it tractable and *actionable* — copy it:

1. **Mutate only changed code** (diff vs the PR base), never the whole tree.
2. **Mutate only covered lines** — a survivor on an uncovered line is just a coverage gap.
3. **One mutant per line.**
4. **Suppress unproductive mutants** (logging, equivalent-by-construction edits).
5. **Cap the surface** — Google reports **≤7 mutants per file** per changelist to avoid reviewer overload.

Run it as a **separate CI job that fires after the normal suite goes green**, not in the fast pre-commit path. Run a periodic **full** (non-incremental) pass on a schedule to catch incremental drift.

## Per-ecosystem tooling

### TypeScript / JavaScript — StrykerJS (mature, recommended)

- **CI gate:** `thresholds` config, default `{ high: 80, low: 60, break: null }`. Only `break` fails the build — score `< break` → **exit code 1**. `high`/`low` only colour the report. `break` is `null` by default (never fails), so set it explicitly.
- **Incremental:** `--incremental` tracks code/test changes and mutates only changed code while still emitting a full report (state in `reports/stryker-incremental.json`). Available since Stryker 6.2.
- Pitfall: maintainers recommend a periodic `--force` full run so the incremental cache doesn't drift.

Sources: [Stryker config](https://stryker-mutator.io/docs/stryker-js/configuration/), [incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/).

```jsonc
// stryker.config.json
{ "thresholds": { "high": 80, "low": 60, "break": 70 }, "incremental": true }
```

### Python — mutmut v3 (recommended) / cosmic-ray (alternative)

- **mutmut v3** went **pytest-only** and switched to *mutation schemata* for parallel execution, cutting runtime significantly. Git change detection is on by default (`use_git_change_detection`), giving diff-style runs. v3.5.0 added JSON stats export for CI/CD threshold-gating.
- ⚠️ The per-function source-hashing + cross-call incremental-invalidation features sit under *Unreleased* in `HISTORY.rst` — confirm they've shipped in a tagged release before relying on them.
- **cosmic-ray** remains the alternative when you need its session/DB model.
- ⚠️ A 2024 conference study ([Diallo et al., IEEE DSA 2024](https://par.nsf.gov/servlets/purl/10573281)) found MutPy and Mutatest unrunnable and pre-v3 mutmut's reporting inadequate — but it evaluated **pre-v3** mutmut on two small programs; do **not** generalise its mutmut findings to v3.

Sources: [mutmut HISTORY](https://github.com/boxed/mutmut/blob/main/HISTORY.rst), [README](https://github.com/boxed/mutmut/blob/main/README.rst).

### Rust — cargo-mutants (mature, best diff support)

The strongest diff-only story of any ecosystem.

- `--in-diff DIFF_FILE` mutates only regions overlapping the diff.
- `--in-place` reuses the build tree (faster; **incompatible with `--jobs`** and concurrent edits — use a disposable CI checkout).
- **CI gate:** **exit code 2** when uncaught/missed mutants are found → build fails. Outcomes: caught / missed / timeout / unviable.
- ⚠️ `--in-diff` matches code-under-test only, not test code: a diff that changes *only* tests generates no mutants — so it complements but never replaces periodic full runs.

Sources: [in-diff](https://mutants.rs/in-diff.html), [PR workflow](https://mutants.rs/pr-diff.html), [CI](https://mutants.rs/ci.html), [exit codes](https://mutants.rs/exit-codes.html).

```yaml
# .github/workflows — cargo-mutants on PR diff only
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- run: git diff origin/${{ github.base_ref }}.. | tee git.diff
- run: cargo mutants --no-shuffle -vV --in-diff git.diff
```

### Go — weak and fragmented (no stable 1.0 leader)

Set expectations: there is **no dominant, stable mutation tool** in Go. Pick by need:

| Tool | Diff mode | CI threshold | Notes |
|------|-----------|--------------|-------|
| **Gremlins** ([go-gremlins/gremlins](https://github.com/go-gremlins/gremlins)) | ❌ none | partial | Actively released (v0.6.0, Dec 2025) but **pre-1.0, no backward-compat guarantee**. States: KILLED/LIVED/NOT COVERED/NOT VIABLE/TIMED OUT/RUNNABLE. |
| **go-mutesting fork** ([jonbaldie](https://github.com/jonbaldie/go-mutesting)) | ✅ `--git-diff-lines` | ✅ `--min-msi`/`--min-covered-msi` (exit 4) | Only Go tool with **both** diff-only AND threshold gating. Also `--baseline` (fail only on new regressions), `--logger-github`/`--logger-gitlab`. ⚠️ **Migrating to `quality-gates/mutago`** — re-check the canonical repo. |
| **ooze** ([gtramontina/ooze](https://github.com/gtramontina/ooze)) | ❌ none | ✅ `WithMinimumThreshold` (default 1.0) | Embedded as a Go test (`//go:build mutation`), **runs the full suite per mutant** — expensive, run on a dedicated CI path. |

For Go, prefer the jonbaldie/mutago fork chain if you need diff-based CI gating; otherwise treat mutation testing as a periodic manual audit rather than a per-PR gate.

## Wiring into hk and CI

Mutation testing is too slow for the fast pre-commit path. Keep it in CI (or a manual/scheduled hk step), diff-scoped, after the suite passes:

```pkl
// hk.pkl — manual/scheduled only, never in the default pre-commit group
["mutation"] {
  check = "scripts/quiet-on-success.sh cargo mutants --no-shuffle --in-diff git.diff"
  depends = List("test-unit")  // no point mutating if tests are red
}
```

Keep the boundary the rest of this skill uses: **thresholds live in the tool's own config / flags** (`break`, `--min-msi`, `WithMinimumThreshold`, exit-code checks), not in `hk.pkl`. hk runs the command and checks the exit code.

## Pitfalls

| Pitfall | Mitigation |
|---------|------------|
| Full-tree runs never finish | Diff-only + covered-only + cap per file |
| **Equivalent mutants** (semantically identical, can't be killed) | Suppression rules; accept score <100%; don't chase the last few |
| Incremental cache drift | Schedule a periodic full `--force` run |
| Survivors on uncovered lines | That's a *coverage* gap — fix with a test that runs the line first |
| Go ecycle immaturity | Don't gate PRs on a pre-1.0 tool; audit periodically instead |
| Treating mutation score as a vanity KPI | It's a worklist of missing assertions, not a target to game (see Goodhart note in SKILL.md) |
