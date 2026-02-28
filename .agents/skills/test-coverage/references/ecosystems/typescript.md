# TypeScript / JavaScript Coverage Patterns

## Test runners and coverage providers

| Runner | Coverage provider | Config file |
|--------|-------------------|-------------|
| Vitest | v8 (node), Istanbul (browser) | `vitest.*.config.mts` |
| Jest | v8 or Istanbul | `jest.config.ts` |
| Playwright | Istanbul (via fixtures) | `playwright.config.ts` |

## Vitest: Unit config

```typescript
// vitest.unit.config.mts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.unit.spec.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: process.env.CI
        ? ['text', 'html', 'json', 'lcov']
        : ['text-summary', 'html', 'json', 'lcov'],
      reportsDirectory: './coverage/unit',
      include: [
        'src/utilities/**/*.ts',
        'src/domain/**/*.ts',
      ],
      exclude: [
        // Cross-tier: Service layer - requires runtime - tested via integration tests
        'src/domain/**/service.ts',
        // Runtime: Server-only utilities - requires next/headers - tested via E2E
        'src/utilities/auth.ts',
        // Generated: Type definitions - auto-generated, no logic
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
```

## Vitest: Integration config

```typescript
// vitest.int.config.mts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/int/**/*.int.spec.ts'],
    setupFiles: ['tests/setup/node.setup.ts'],
    fileParallelism: false, // databases don't handle concurrent writes
    pool: 'forks',
    poolOptions: { forks: { maxWorkers: 1 } },
    testTimeout: 30_000, // DB init can be slow
    coverage: {
      provider: 'v8',
      reporter: process.env.CI
        ? ['text', 'html', 'json', 'lcov']
        : ['text-summary', 'html', 'json', 'lcov'],
      reportsDirectory: './coverage/int',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Cross-tier: React components - requires browser - component + E2E tests
        'src/components/**',
        // Generated: Database migrations - auto-generated SQL
        'src/migrations/**',
        // Runtime: Server actions - requires Next.js runtime - E2E tests
        'src/actions/**',
        // Config: Framework wiring - tested implicitly via collection tests
        'src/payload.config.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
```

## Vitest: Browser / component config

```typescript
// vitest.browser.config.mts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/components/**/*.browser.spec.tsx'],
    setupFiles: ['tests/setup/browser.setup.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      provider: 'istanbul', // v8 not supported in browser mode
      reporter: ['text-summary', 'html', 'json', 'lcov'],
      reportsDirectory: './coverage/components',
      include: ['src/components/**/*.tsx'],
      exclude: [
        // Async: Server components - cannot render in browser - E2E tests
        '**/ServerComponent.tsx',
        // Upstream: UI library components - tested by library maintainers
        '**/ui/button.tsx',
        '**/ui/input.tsx',
      ],
      thresholds: {
        // Istanbul in browser mode has inaccurate branch/function counting
        // Lines at 100% proves execution; statement/branch pragmatically lower
        statements: 97,
        branches: 88,
        functions: 95,
        lines: 100,
      },
    },
  },
  resolve: {
    alias: {
      // Stub server-side imports in browser context
      '@payload-config': 'tests/setup/stubs/payload-config.ts',
    },
  },
})
```

## Jest equivalent (multi-project)

```typescript
// jest.config.ts
export default {
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.unit.spec.ts'],
      coverageDirectory: './coverage/unit',
      collectCoverageFrom: ['src/utilities/**/*.ts'],
      coverageThreshold: { global: { lines: 100 } },
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/int/**/*.int.spec.ts'],
      coverageDirectory: './coverage/int',
      collectCoverageFrom: ['src/**/*.ts'],
      coveragePathIgnorePatterns: ['/components/', '/migrations/'],
      coverageThreshold: { global: { lines: 100 } },
    },
  ],
}
```

## Package.json scripts

```json
{
  "test:unit": "vitest run --config ./vitest.unit.config.mts",
  "test:unit:watch": "vitest --config ./vitest.unit.config.mts",
  "test:unit:coverage": "vitest run --coverage --config ./vitest.unit.config.mts",
  "test:int": "vitest run --config ./vitest.int.config.mts",
  "test:int:watch": "vitest --config ./vitest.int.config.mts",
  "test:int:coverage": "vitest run --coverage --config ./vitest.int.config.mts",
  "test:components": "vitest run --coverage --config ./vitest.browser.config.mts",
  "test:components:watch": "vitest --config ./vitest.browser.config.mts",
  "test:e2e": "playwright test",
  "test": "pnpm test:unit && pnpm test:int && pnpm test:components && pnpm test:e2e"
}
```

## Integration test setup (Node)

```typescript
// tests/setup/node.setup.ts
import { beforeAll, afterAll } from 'vitest'
import type { Payload } from 'payload'

let payload: Payload

beforeAll(async () => {
  // Remove stale test database
  const dbPath = 'test.db'
  if (existsSync(dbPath)) unlinkSync(dbPath)

  // Initialise Payload with SQLite (fast, isolated, no external deps)
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: await import('@payload-config') })
  globalThis.testPayload = payload
})

afterAll(async () => {
  // Clean up database
  await payload?.db?.destroy?.()
})
```

## Browser test stubs

Create stub modules to prevent browser tests from importing server-only code:

```typescript
// tests/setup/stubs/payload-config.ts
export default {} // Stub — server config not needed in browser tests

// tests/setup/stubs/auth-actions.ts
export const loginAction = async () => ({ success: false })
export const logoutAction = async () => {}
```

## Component mock factories

```typescript
// src/components/mocks.ts — shared between tests and Storybook
export function createMockFilm(overrides = {}) {
  return {
    id: 1,
    title: 'Test Film',
    year: 2024,
    director: 'Test Director',
    slug: 'test-film',
    ...overrides,
  }
}
```
