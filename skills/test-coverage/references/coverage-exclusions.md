# Coverage Exclusions: Documentation and Justification

Every exclusion is a claim: "this code is tested elsewhere or genuinely untestable." Every claim needs evidence. Undocumented exclusions are technical debt.

## Exclusion Categories

### 1. Runtime-incompatible code

Code requiring a specific runtime not available in the test environment (e.g. Cloudflare Workers, browser APIs, iOS native, edge runtime).

```typescript
exclude: [
  // Runtime: Cloudflare middleware - requires workerd runtime - tested via E2E on preview deploys
  'src/middleware.ts',
  // Runtime: Server-only auth utilities - requires next/headers - tested via E2E
  'src/utilities/auth.ts',
]
```

**Justification test:** Can this code physically execute in the test harness? If not, this is a valid exclusion.

### 2. Auto-generated code

Migrations, type definitions, codegen output, ORM-generated files.

```typescript
exclude: [
  // Generated: Database migrations - auto-generated SQL, schema tested via integration tests
  'src/migrations/**',
  // Generated: Type definitions - auto-generated from schema, no runtime logic
  'src/payload-types.ts',
]
```

**Justification test:** Was this file created by a tool, not a human? Does modifying it manually get overwritten on next generation?

### 3. Framework configuration

Entry points, config files that wire dependencies together but contain no business logic.

```typescript
exclude: [
  // Config: Framework wiring - tested implicitly via collection integration tests
  'src/payload.config.ts',
  // Config: Next.js app layout - structural wrapper, no logic
  'src/app/layout.tsx',
]
```

**Justification test:** Does this file only compose other modules without conditional logic? If you removed it, would integration tests fail (proving implicit coverage)?

### 4. Cross-tier delegation

Code excluded from one tier because it is covered at a different tier. This is the most common and most important category.

```typescript
// Unit config excludes:
exclude: [
  // Cross-tier: Service layer - requires database runtime - tested via integration tests
  'src/domain/**/service.ts',
]

// Integration config excludes:
exclude: [
  // Cross-tier: React components - requires browser context - tested via component + E2E tests
  'src/components/**',
  // Cross-tier: Server actions - requires Next.js runtime - tested via E2E
  'src/actions/**',
]
```

**Justification test:** Is there a specific test file at the other tier that exercises this code? Can you name it?

### 5. Third-party wrappers

Thin wrappers around well-tested libraries that add no custom logic.

```typescript
exclude: [
  // Upstream: shadcn/ui components - well-tested library, no custom logic added
  'src/components/ui/button.tsx',
  'src/components/ui/input.tsx',
  // Upstream: cn() utility - re-export of clsx + tailwind-merge
  'src/utilities/cn.ts',
]
```

**Justification test:** Does this file add conditional logic beyond the library's API? If yes, it needs tests. If it's a pure re-export or thin config wrapper, exclusion is valid.

### 6. Async server components

Framework-specific: components that fetch data at render time and cannot be rendered in a unit/component test environment.

```typescript
exclude: [
  // Async: Server component - uses await getPayload() at render time
  // Cannot render in Vitest browser mode - coverage via E2E tests for /films page
  'src/components/blocks/FilmGridBlock.tsx',
  // Async: Layout with auth check - reads cookies at render time - E2E tests
  'src/app/(frontend)/layout.tsx',
]
```

**Justification test:** Does this component use `async/await` at the top level or call server-only APIs during render? Can it be split into an async data-fetching shell and a pure presentational component (which can be tested)?

## Exclusion Comment Format

Use a consistent format for all exclusion comments:

```text
// <Category>: <What it is> - <Why untestable here> - <Where tested instead>
```

**Examples:**

```typescript
// Runtime: Cloudflare middleware - requires workerd - E2E on preview deploys
// Generated: Payload types - auto-generated, no logic - implicit via int tests
// Cross-tier: React components - browser context needed - component + E2E tests
// Upstream: shadcn/ui Button - no custom logic - tested in library
// Async: FilmGridBlock - server component with data fetch - E2E /films page
// Config: payload.config.ts - framework wiring - implicit via collection int tests
```

This format enables automated auditing:

```bash
# List all exclusion comments across config files
grep -rn "// Runtime:\|// Generated:\|// Cross-tier:\|// Upstream:\|// Async:\|// Config:" \
  vitest.*.config.* jest.config.* pyproject.toml
```

## Inline Ignore Comments

For individual lines of genuinely unreachable defensive code.

### v8

```typescript
/* v8 ignore next */
const fallback = value ?? 'default' // defensive: value always defined after init
```

### Istanbul

```typescript
/* istanbul ignore next -- defensive null check, ref always set after mount */
if (!ref.current) return
```

### Python

```python
if TYPE_CHECKING:  # pragma: no cover
    from typing import Protocol

# pragma: no cover — defensive branch, enum is exhaustive
raise AssertionError(f"Unexpected status: {status}")
```

### Rust

```rust
// tarpaulin: skip next line — defensive unwrap, value always Some after builder
let value = optional.unwrap();
```

### Rules for inline ignores

1. **Always include a justification** after the ignore directive — explain why the code is unreachable
2. **Prefer restructuring** to eliminate the unreachable branch (e.g. use exhaustive pattern matching)
3. **Review during coverage audits** — ignored lines may become testable after refactoring
4. **Never ignore entire functions** — if a function needs ignoring, it likely belongs in an exclusion category above
5. **Count them** — a codebase with many inline ignores has a smell; investigate patterns

## Auditing Exclusions

Run this audit periodically (quarterly or when coverage config changes).

### Step 1: List all exclusions

```bash
# Config-level exclusions
grep -A 1 "exclude" vitest.*.config.* jest.config.* pyproject.toml .coveragerc

# Inline ignores
grep -rn "v8 ignore\|istanbul ignore\|pragma: no cover\|tarpaulin" src/
```

### Step 2: Verify each justification

For each exclusion, confirm:

- [ ] The category comment is present and accurate
- [ ] The "why untestable" reason is still true
- [ ] The "where tested instead" tier actually has tests for this code
- [ ] No code changes have made the exclusion unnecessary

### Step 3: Check for orphaned exclusions

- [ ] Are there excluded paths that no longer exist? (stale exclusions)
- [ ] Are there new files matching excluded patterns that should have tests?
- [ ] Have any excluded files gained business logic that wasn't there before?

### Step 4: Review inline ignores

- [ ] Can any ignored branches be eliminated by restructuring?
- [ ] Are justifications still accurate?
- [ ] Has the count of inline ignores grown? If so, investigate the pattern

### Step 5: Cross-reference tiers

For every cross-tier exclusion, verify the claim:

```bash
# Example: "src/components/** excluded from integration tests, tested via component tests"
# Verify component tests exist for these files:
ls tests/components/
# Compare against excluded component files to find gaps
```

A cross-tier exclusion without corresponding tests at the claimed tier is a coverage gap hiding behind a comment.
