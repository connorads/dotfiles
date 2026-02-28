---
name: test-coverage
description: >
  Systematically audit, improve, and enforce test coverage in any repository.
  Use when asked to improve coverage, add missing tests, set up coverage thresholds,
  audit test gaps, or wire coverage into CI/hooks. Works across ecosystems
  (TypeScript, Python, Go, Rust, etc.). Composes with the hk skill for pre-commit enforcement.
  Triggers on: test coverage, missing tests, coverage threshold, coverage report,
  untested code, coverage gap, coverage audit.
---

# Test Coverage

Audit gaps, write targeted tests, enforce thresholds — across any ecosystem.

## Mental Model

The testing pyramid encodes an economic truth: each tier tests what only it can test.

| Tier | Tests | Cost to write | Cost to run |
|------|-------|---------------|-------------|
| **Unit** | Pure functions, domain logic, validation, parsing | Low | Milliseconds |
| **Integration** | Database queries, API boundaries, access control, service interactions | Medium | Seconds |
| **Component** | Rendered UI in a real browser, user interactions, visual states | Medium | Seconds |
| **E2E** | Full user flows across the entire stack | High | Minutes |

**Coverage is a regression gate**, not a quality metric. High coverage with bad tests is worse than moderate coverage with good tests. The goal is: new code cannot silently skip tests.

**Exclusions are architecture**, not exceptions. Every exclusion documents a deliberate decision about where code is tested. An exclusion at one tier should have coverage at another.

## Decision Tree

Start here. Follow the branch that matches the current state.

```text
Is there any coverage tooling configured?
├── No → Bootstrap (below)
└── Yes
    ├── Coverage below target? → Audit & Improve (below)
    ├── Coverage adequate but not enforced? → Enforce (below)
    └── Coverage enforced, writing new code? → Write Tests for New Code (below)
```

## Bootstrap: Setting Up Coverage from Scratch

### 1. Detect the ecosystem

Check for project markers: `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `setup.py`, `*.csproj`. See [ecosystem patterns](references/ecosystem-patterns.md) for tool recommendations per language.

### 2. Create tiered configs

Each test tier gets its own configuration file with targeted include/exclude patterns. This prevents slow integration tests from blocking fast unit test feedback.

**Key principles:**

- Each tier has a separate `include` pattern matching only its source files
- Each tier has a separate coverage output directory (avoids conflicts)
- CI vs local reporter selection: text-summary locally, full HTML/JSON/LCOV in CI

**TypeScript/Vitest example structure:**

```text
vitest.unit.config.mts    → tests/unit/**/*.unit.spec.ts    → coverage/unit/
vitest.int.config.mts     → tests/int/**/*.int.spec.ts      → coverage/int/
vitest.browser.config.mts → tests/components/**/*.spec.tsx   → coverage/components/
```

**Python example:**

```bash
pytest -m unit --cov --cov-report=html:coverage/unit
pytest -m integration --cov --cov-report=html:coverage/int
```

### 3. Set initial thresholds

Run coverage once, note the baseline. Set thresholds at the current level — this prevents regression while you improve.

```text
# Example: start where you are
thresholds: { lines: 72 }  # measured baseline
```

Then ratchet up as you add tests. Never ratchet down. See [enforcement](references/enforcement.md) for the full ratcheting strategy.

### 4. Add coverage scripts

Create per-tier scripts in your project manifest:

```json
{
  "test:unit": "vitest run --config ./vitest.unit.config.mts",
  "test:unit:coverage": "vitest run --coverage --config ./vitest.unit.config.mts",
  "test:int": "vitest run --config ./vitest.int.config.mts",
  "test:int:coverage": "vitest run --coverage --config ./vitest.int.config.mts",
  "test:components": "vitest run --coverage --config ./vitest.browser.config.mts",
  "test:e2e": "playwright test",
  "test": "pnpm test:unit && pnpm test:int && pnpm test:components && pnpm test:e2e"
}
```

## Audit & Improve: Closing Coverage Gaps

### Phase 1: Audit

Run coverage for each tier and examine the output.

```bash
# Run with coverage, examine the HTML report or text output
<runner> --coverage
```

Identify three categories:

- **Untested files** — no coverage at all (highest priority)
- **Untested branches** — code paths never exercised
- **Untested functions** — declared but never called in tests

### Phase 2: Classify each gap

For every uncovered file or function, ask:

| Question | If yes | If no |
|----------|--------|-------|
| Business logic or domain rules? | Unit tests (highest priority) | Continue |
| Access control or authorisation? | Integration tests | Continue |
| Data validation or parsing? | Unit tests | Continue |
| API endpoint or mutation? | Integration tests | Continue |
| UI component with logic? | Component tests | Continue |
| Full user flow? | E2E tests | Continue |
| Can it run in the test environment? | Write tests | Document exclusion |
| Auto-generated code? | Exclude with comment | Write tests |
| Thin wrapper around tested library? | Consider excluding | Write tests |

### Phase 3: Prioritise

Triage order (highest value first):

1. Domain logic and business rules (unit)
2. Access control and authorisation (integration)
3. Data validation and input parsing (unit)
4. API endpoints and mutations (integration)
5. UI components with conditional logic (component)
6. Async/server-rendered components (E2E)
7. Configuration and wiring (tested implicitly by higher tiers)

### Phase 4: Write tests

For each gap, follow the appropriate tier's patterns. Test expected behaviour through the public API, not implementation details.

**Unit tests:** Pure input → output. No database, no network, no filesystem.

```typescript
describe('slugify', () => {
  it('converts spaces to hyphens', () => {
    expect(slugify('hello world')).toBe('hello-world')
  })
  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })
})
```

**Integration tests:** Real database, real service boundaries, no mocks for things you own.

```typescript
it('enforces access control on draft posts', async () => {
  const result = await payload.find({
    collection: 'posts',
    where: { _status: { equals: 'draft' } },
    overrideAccess: false,
    user: anonymousUser,
  })
  expect(result.docs).toHaveLength(0)
})
```

**Component tests:** Real browser, real DOM queries (accessibility-first via testing-library).

```tsx
it('renders film title and year', () => {
  render(<FilmCard film={mockFilm} />)
  expect(screen.getByText('Film Title')).toBeInTheDocument()
  expect(screen.getByText('2024')).toBeInTheDocument()
})
```

**E2E tests:** Full user flows, real navigation, real network.

```typescript
test('user can submit a form', async ({ page }) => {
  await page.goto('/submit')
  await page.fill('[name="title"]', 'My Film')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/confirmation/)
})
```

See [ecosystem patterns](references/ecosystem-patterns.md) for language-specific runner syntax and config examples.

## Enforce: Wiring Coverage into Hooks and CI

### Pre-commit (composes with hk)

If using the hk skill, add coverage test steps to `hk.pkl`:

```pkl
["test-unit"] {
  check = "scripts/quiet-on-success.sh pnpm test:unit:coverage"
}
["test-int"] {
  check = "scripts/quiet-on-success.sh pnpm test:int:coverage"
  depends = List("test-unit")
}
```

**Key principles:**

- Coverage thresholds live in the test config, not in hook config
- E2E tests are too slow for pre-commit — run in CI or manually
- Order tiers by speed: unit first (fastest fail), then integration, then components
- Wrap in quiet-on-success so passing tests produce no output

### CI

Run all tiers with coverage in CI. Upload per-tier reports separately for visibility.

```yaml
- name: Unit tests
  run: pnpm test:unit:coverage
- name: Integration tests
  run: pnpm test:int:coverage
- name: E2E tests
  run: pnpm test:e2e
```

### Ratcheting

For projects not yet at target:

1. Measure current coverage
2. Set threshold at current level
3. After each improvement, bump the threshold
4. Never lower it

See [enforcement](references/enforcement.md) for detailed CI patterns, PR checks, and ratcheting workflow.

## Write Tests for New Code

When adding features to a codebase with established coverage:

1. **Identify the tier**: What kind of code are you writing? Match to the classification table above
2. **Write tests first (TDD)**: Test the expected behaviour before implementing
3. **Run coverage locally**: `--coverage` for the relevant tier
4. **Handle exclusions**: If code genuinely cannot be tested at this tier, document why and ensure coverage exists at another tier
5. **Verify thresholds pass**: Pre-commit hooks catch regressions, but check early

### Cross-tier exclusion pattern

Every exclusion at one tier names the tier that provides coverage:

```typescript
// Unit config excludes:
// Cross-tier: Service layer - requires database runtime - tested via integration tests
"src/domain/**/service.ts",

// Integration config excludes:
// Cross-tier: React components - requires browser context - tested via component + E2E tests
"src/components/**",
```

See [coverage exclusions](references/coverage-exclusions.md) for the full exclusion taxonomy and documentation format.

## Test Organisation Patterns

### Directory structure

```text
tests/
  unit/          *.unit.spec.ts       Pure functions, domain logic
  int/           *.int.spec.ts        Database, API, access control
  components/    *.browser.spec.tsx   Rendered UI in real browser
  e2e/           *.e2e.spec.ts        Full user flows
  fixtures/      index.ts             Shared test data factories
  setup/         Per-tier setup files (DB init, browser cleanup)
```

### Naming conventions

Suffix encodes the tier — config `include` patterns use these suffixes for zero-ambiguity matching:

| Tier | Suffix | Example |
|------|--------|---------|
| Unit | `.unit.spec.ts` | `slugify.unit.spec.ts` |
| Integration | `.int.spec.ts` | `films.int.spec.ts` |
| Component | `.browser.spec.tsx` | `FilmCard.browser.spec.tsx` |
| E2E | `.e2e.spec.ts` | `auth.e2e.spec.ts` |

### Test data factories

Use factory functions with auto-incrementing counters for unique identifiers:

```typescript
let counter = 0
function createTestUser(overrides = {}) {
  counter++
  return {
    email: `test-${counter}@example.com`,
    name: `Test User ${counter}`,
    ...overrides,
  }
}
```

Counter-based (not random) for deterministic debugging. Reset between test runs if needed.

### Mock boundaries

- **Do mock**: External APIs, third-party SDKs, environment-specific runtimes
- **Do not mock**: Code you own — test through the public API
- **Database**: Use a real local database for integration tests (SQLite, test containers)
- **Browser**: Use a real browser for component tests (Playwright, Vitest browser mode)
- **Server-side imports**: Stub server-only modules when testing in browser context

## Coverage Providers: Quick Reference

| Provider | Environment | When to use | Limitations |
|----------|-------------|-------------|-------------|
| **v8** | Node.js | Unit, integration tests | Not supported in browser mode |
| **Istanbul** | Browser | Component tests | Ignore comments may not survive bundling |
| **c8** | Node.js CLI | Standalone v8 wrapper | Alternative to built-in coverage |
| **coverage.py** | Python | All tiers via pytest-cov | Requires source mapping for packages |
| **go cover** | Go | Built-in, all tiers | Per-package profiles need merging |
| **tarpaulin** | Rust | Cargo integration | May miss some async code paths |
| **llvm-cov** | Rust | Higher accuracy | Requires nightly or specific toolchain |
| **lcov** | Any | Merging multi-tier reports | Format standard, not a provider |

## Gotchas

| Issue | Fix |
|-------|-----|
| v8 undercounts arrow functions | Lower `functions` threshold or restructure code |
| Istanbul ignore comments stripped by bundler | Use file-level exclusions in config instead |
| Concurrent DB writes in integration tests | Disable parallelism, use single worker |
| Coverage directories conflict across tiers | Separate `reportsDirectory` per tier config |
| E2E tests too slow for pre-commit | Run in CI only; document in project README |
| Ignore comment used without justification | Always add a reason after the ignore directive |
| Coverage passes but tests are meaningless | Review test quality, not just the metric |
| New file added with no tests | Threshold regression catches it at commit time |
| Browser tests import server-only code | Create stub modules, alias in browser config |
| Flaky tests in pre-commit hooks | Investigate root cause; do not retry or skip |

## References

- [Ecosystem Patterns](references/ecosystem-patterns.md) — Index of per-language references:
  - [TypeScript/JS](references/ecosystems/typescript.md) | [Python](references/ecosystems/python.md) | [Go](references/ecosystems/go.md) | [Rust](references/ecosystems/rust.md) | [Merging](references/ecosystems/merging.md)
- [Coverage Exclusions](references/coverage-exclusions.md) — How to document and justify every exclusion
- [Enforcement](references/enforcement.md) — Wiring coverage into hk hooks, CI pipelines, and PR checks
