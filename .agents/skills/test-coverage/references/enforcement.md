# Enforcing Coverage: Hooks, CI, and PR Checks

Two enforcement points prevent coverage regression: pre-commit hooks (fast feedback) and CI (comprehensive checks).

## Pre-commit Hooks (hk)

If using the [hk skill](../../hk/SKILL.md), coverage tests are added as hk steps.

### Coverage steps in hk.pkl

```pkl
steps {
  ["format"] = new Group {
    steps {
      // Linting and formatting steps first (auto-fix, re-stage)
    }
  }
  ["validate"] = new Group {
    steps {
      ["typecheck"] {
        check = "pnpm tsc --noEmit"
      }
      ["test-unit"] {
        check = "scripts/quiet-on-success.sh pnpm test:unit:coverage"
      }
      ["test-int"] {
        check = "scripts/quiet-on-success.sh pnpm test:int:coverage"
        depends = List("test-unit")  // no point running slow tests if fast ones fail
      }
      ["test-components"] {
        check = "scripts/quiet-on-success.sh pnpm test:components"
        depends = List("test-unit")
      }
    }
  }
}
```

### Key principles

**Thresholds live in test configs, not hk.pkl.** hk runs the command and checks the exit code. The test runner's own threshold config determines pass/fail. This keeps the single source of truth in the test config.

**E2E tests are excluded from pre-commit.** They are too slow (minutes vs seconds). Document this clearly:

```markdown
<!-- In project README or CLAUDE.md -->
**Run manually before PR:**

- `pnpm test:e2e` — E2E tests (not in pre-commit)
- `pnpm build` — catches static generation errors
```

**Order tiers by speed.** Unit tests run first (fastest feedback). Integration and component tests depend on unit tests passing — no point running expensive tests if cheap ones fail.

**Wrap in quiet-on-success.** Passing tests produce no output. Only failures are visible. This keeps commit output clean. See hk skill's `assets/quiet-on-success.sh`.

### Stash-aware testing

hk with `stash = "git"` stashes unstaged changes before running hooks:

- Coverage is measured against **staged changes only**
- Partial staging works correctly (only committed code is tested)
- Unstaged new files do not inflate or deflate coverage
- After hooks complete, unstaged changes are restored

This means coverage thresholds apply to what you're actually committing, not your entire working tree.

### Python equivalent

```pkl
["test-unit"] {
  check = "scripts/quiet-on-success.sh pytest -m unit --cov --cov-fail-under=100"
}
["test-int"] {
  check = "scripts/quiet-on-success.sh pytest -m integration --cov --cov-fail-under=100"
  depends = List("test-unit")
}
```

### Go equivalent

```pkl
["test-unit"] {
  check = "scripts/quiet-on-success.sh scripts/check-coverage.sh 95"
}
```

Where `scripts/check-coverage.sh` runs `go test -coverprofile` and checks the threshold.

### Skipping during development

```bash
# Skip specific test steps (hk feature)
HK_SKIP_STEPS=test-unit,test-int,test-components git commit -m "wip: not ready yet"
```

Use sparingly. Document any skip in the commit message so reviewers know tests were bypassed.

---

## CI Pipeline

CI runs all tiers including E2E. This is the comprehensive check gate before merge.

### GitHub Actions: TypeScript/JavaScript

```yaml
name: Test Coverage
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v3

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm tsc --noEmit

      - name: Unit tests with coverage
        run: pnpm test:unit:coverage

      - name: Integration tests with coverage
        run: pnpm test:int:coverage

      - name: Component tests with coverage
        run: pnpm test:components

      - name: E2E tests
        run: pnpm test:e2e

      - name: Upload coverage
        if: always()
        uses: codecov/codecov-action@v4
        with:
          files: >-
            coverage/unit/lcov.info,
            coverage/int/lcov.info,
            coverage/components/lcov.info
          flags: unit,integration,components
          fail_ci_if_error: false
```

### GitHub Actions: Python

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v3

      - name: Install dependencies
        run: pip install -e ".[test]"

      - name: Unit tests
        run: pytest -m unit --cov --cov-report=xml:coverage/unit.xml --cov-fail-under=100

      - name: Integration tests
        run: pytest -m integration --cov --cov-report=xml:coverage/int.xml --cov-fail-under=100

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: coverage/unit.xml,coverage/int.xml
```

### GitHub Actions: Go

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod

      - name: Unit tests
        run: go test -coverprofile=coverage/unit.out ./...

      - name: Integration tests
        run: go test -tags=integration -coverprofile=coverage/int.out ./...

      - name: Check coverage threshold
        run: |
          TOTAL=$(go tool cover -func=coverage/unit.out | grep total | awk '{print $3}' | tr -d '%')
          echo "Coverage: ${TOTAL}%"
          if (( $(echo "$TOTAL < 90" | bc -l) )); then
            echo "::error::Coverage ${TOTAL}% below 90% threshold"
            exit 1
          fi
```

### GitHub Actions: Rust

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable

      - name: Install tarpaulin
        run: cargo install cargo-tarpaulin

      - name: Tests with coverage
        run: cargo tarpaulin --out xml --fail-under 90

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: cobertura.xml
```

---

## PR Coverage Checks

### Codecov configuration

```yaml
# codecov.yml
coverage:
  status:
    project:
      default:
        target: auto    # Don't let coverage drop from current level
        threshold: 1%   # Allow 1% variance for measurement noise
    patch:
      default:
        target: 90%     # New code in the PR must be 90%+ covered

flags:
  unit:
    paths:
      - src/utilities/
      - src/domain/
    carryforward: true
  integration:
    paths:
      - src/
    carryforward: true
  components:
    paths:
      - src/components/
    carryforward: true
```

### Manual enforcement (no third-party service)

For teams that prefer not to use Codecov/Coveralls:

```bash
#!/usr/bin/env bash
# scripts/check-coverage-threshold.sh
# Usage: ./scripts/check-coverage-threshold.sh coverage/unit/coverage-summary.json 100

SUMMARY_FILE="$1"
THRESHOLD="${2:-100}"

COVERAGE=$(jq '.total.lines.pct' "$SUMMARY_FILE")

if (( $(echo "$COVERAGE < $THRESHOLD" | bc -l) )); then
  echo "Coverage ${COVERAGE}% below threshold ${THRESHOLD}%"
  exit 1
fi

echo "Coverage ${COVERAGE}% meets threshold ${THRESHOLD}%"
```

Add to CI:

```yaml
- name: Check unit coverage threshold
  run: ./scripts/check-coverage-threshold.sh coverage/unit/coverage-summary.json 100
```

---

## Ratcheting Strategy

For projects not yet at their target threshold.

### The ratcheting workflow

1. **Measure current coverage**: Run coverage, note the baseline
2. **Set threshold at current level**: This prevents regression immediately

   ```typescript
   thresholds: {
     lines: 72,  // baseline measured 2024-03-01
   }
   ```

3. **Improve incrementally**: Add tests as you touch code (boy scout rule)
4. **Bump threshold after each improvement**:

   ```typescript
   thresholds: {
     lines: 78,  // ratcheted 2024-03-15: added auth + validation tests
   }
   ```

5. **Never lower the threshold**: If a commit lowers coverage, fix it — add tests for the new code or adjust exclusions

### Ratcheting rules

- **Ratchet on merge, not on PR.** Set the threshold to the new level after a coverage-improving PR merges.
- **Document each ratchet.** The comment on the threshold line should include the date and what was added.
- **Set a target date.** "100% by end of Q2" gives the team a goal to work toward.
- **Protect against gaming.** Deleting tested code raises the percentage but doesn't improve quality. Review PRs that significantly change coverage.

### Automated ratcheting (advanced)

```bash
#!/usr/bin/env bash
# scripts/ratchet-coverage.sh
# After tests pass, update threshold to current level

CURRENT=$(jq '.total.lines.pct' coverage/unit/coverage-summary.json)
CURRENT_INT=${CURRENT%.*}  # truncate to integer

# Update vitest config threshold
sed -i "s/lines: [0-9]*/lines: $CURRENT_INT/" vitest.unit.config.mts

echo "Ratcheted coverage threshold to ${CURRENT_INT}%"
```

Run after merge to main, not on every commit.

---

## Composition: test-coverage + hk Skills

When both skills are loaded:

| Concern | Owner | Location |
|---------|-------|----------|
| What to test | test-coverage | Test files, fixture factories |
| Coverage thresholds | test-coverage | Test runner config files |
| Hook wiring | hk | `hk.pkl` |
| Step ordering | hk | `depends` in `hk.pkl` |
| Output formatting | hk | `quiet-on-success.sh` |
| CI pipeline | test-coverage | `.github/workflows/` |
| Exclusion docs | test-coverage | Config file comments |

**Boundary rule:** test-coverage never edits `hk.pkl`. hk never edits test runner configs. Each skill owns its domain.

When setting up a new project:

1. Use test-coverage to establish the test architecture (tiers, configs, thresholds)
2. Use hk to wire the coverage commands into pre-commit hooks
3. Use test-coverage to set up CI coverage reporting
4. Both skills reference `scripts/quiet-on-success.sh` — hk owns the file, test-coverage documents its usage
